/**
 * RhythmDesk Safe Shutdown - Phase 5 Stability Lockdown
 * 
 * Handles graceful application shutdown.
 * 
 * SHUTDOWN SEQUENCE:
 * 1. Stop timer engine
 * 2. Flush pending session snapshot
 * 3. Ensure snapshot persisted
 * 4. Close overlay safely
 * 5. Exit application
 * 
 * HANDLES SIGNALS:
 * - SIGINT (Ctrl+C)
 * - SIGTERM (kill)
 * - app.quit()
 */

import { app, BrowserWindow } from 'electron';
import logger from './logger';
import { trace } from './traceLogger';
import { getHealthMonitor } from './healthMonitor';

// ============================================================
// SHUTDOWN STATE
// ============================================================

interface ShutdownState {
  isShuttingDown: boolean;
  shutdownStartTime: number | null;
  shutdownReason: string | null;
  snapshotFlushed: boolean;
  timerStopped: boolean;
  overlaysClosed: boolean;
}

const shutdownState: ShutdownState = {
  isShuttingDown: false,
  shutdownStartTime: null,
  shutdownReason: null,
  snapshotFlushed: false,
  timerStopped: false,
  overlaysClosed: false,
};

// Maximum time to wait for graceful shutdown
const SHUTDOWN_TIMEOUT_MS = 5000;

// ============================================================
// SHUTDOWN HANDLERS
// ============================================================

/**
 * Initiate graceful shutdown
 */
export async function initiateShutdown(reason: string = 'user_request'): Promise<void> {
  // Prevent duplicate shutdown
  if (shutdownState.isShuttingDown) {
    logger.warn('Shutdown', 'Shutdown already in progress');
    return;
  }
  
  shutdownState.isShuttingDown = true;
  shutdownState.shutdownStartTime = Date.now();
  shutdownState.shutdownReason = reason;
  
  logger.info('Shutdown', 'Initiating graceful shutdown', { reason });
  trace.recovery('shutdown', { reason });
  
  try {
    // Set timeout for forced exit
    const forceExitTimeout = setTimeout(() => {
      logger.error('Shutdown', 'Forced exit due to timeout');
      app.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    
    // Step 1: Stop health monitor
    await stopHealthMonitor();
    
    // Step 2: Stop timer engine
    await stopTimerEngine();
    shutdownState.timerStopped = true;
    
    // Step 3: Flush session snapshot
    await flushSessionSnapshot();
    shutdownState.snapshotFlushed = true;
    
    // Step 4: Close overlay windows
    await closeOverlayWindows();
    shutdownState.overlaysClosed = true;
    
    // Clear timeout
    clearTimeout(forceExitTimeout);
    
    // Log completion
    const duration = Date.now() - (shutdownState.shutdownStartTime || 0);
    logger.info('Shutdown', 'Graceful shutdown complete', { duration });
    
    // Exit
    app.exit(0);
  } catch (error) {
    logger.error('Shutdown', 'Error during shutdown', {
      error: error instanceof Error ? error.message : String(error),
    });
    
    // Force exit
    app.exit(1);
  }
}

/**
 * Stop health monitor
 */
async function stopHealthMonitor(): Promise<void> {
  try {
    const healthMonitor = getHealthMonitor();
    healthMonitor.stop();
    logger.debug('Shutdown', 'Health monitor stopped');
  } catch (error) {
    logger.warn('Shutdown', 'Failed to stop health monitor', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Stop timer engine
 */
async function stopTimerEngine(): Promise<void> {
  try {
    // Dynamic import to avoid circular dependencies
    const { getTimerEngine } = await import('./timerEngine');
    const timerEngine = getTimerEngine();
    timerEngine.stop();
    logger.debug('Shutdown', 'Timer engine stopped');
  } catch (error) {
    logger.warn('Shutdown', 'Failed to stop timer engine', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Flush session snapshot
 */
async function flushSessionSnapshot(): Promise<void> {
  try {
    // Dynamic import to avoid circular dependencies
    const configService = (await import('./configService')).default;
    configService.flushSessionSnapshot();
    logger.debug('Shutdown', 'Session snapshot flushed');
  } catch (error) {
    logger.warn('Shutdown', 'Failed to flush session snapshot', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Close overlay windows
 */
async function closeOverlayWindows(): Promise<void> {
  try {
    const windows = BrowserWindow.getAllWindows();
    
    for (const window of windows) {
      // Check if this is an overlay window (typically frameless, fullscreen)
      if (window.isFullScreen() || !window.isClosable()) {
        // Force close
        window.setClosable(true);
        window.close();
      }
    }
    
    logger.debug('Shutdown', 'Overlay windows closed');
  } catch (error) {
    logger.warn('Shutdown', 'Failed to close overlay windows', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ============================================================
// SIGNAL HANDLERS
// ============================================================

let signalHandlersInstalled = false;

/**
 * Install signal handlers for graceful shutdown
 */
export function installShutdownHandlers(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  
  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', () => {
    logger.info('Shutdown', 'Received SIGINT');
    initiateShutdown('SIGINT');
  });
  
  // Handle SIGTERM
  process.on('SIGTERM', () => {
    logger.info('Shutdown', 'Received SIGTERM');
    initiateShutdown('SIGTERM');
  });
  
  // Handle app quit event
  app.on('before-quit', (event) => {
    if (!shutdownState.isShuttingDown) {
      event.preventDefault();
      initiateShutdown('app_quit');
    }
  });
  
  // Handle window-all-closed
  app.on('window-all-closed', () => {
    // On macOS, apps typically stay open until explicitly quit
    if (process.platform !== 'darwin') {
      initiateShutdown('windows_closed');
    }
  });
  
  logger.info('Shutdown', 'Shutdown handlers installed');
}

// ============================================================
// STATE ACCESS
// ============================================================

/**
 * Check if shutdown is in progress
 */
export function isShuttingDown(): boolean {
  return shutdownState.isShuttingDown;
}

/**
 * Get shutdown state
 */
export function getShutdownState(): ShutdownState {
  return { ...shutdownState };
}
