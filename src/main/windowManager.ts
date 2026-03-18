/**
 * RhythmDesk Window Manager
 * Manages main settings window and overlay windows
 * 
 * MULTI-MONITOR POLICY:
 * TODO: Future enhancement - support multi-monitor setups
 * Current behavior: Overlay appears on primary monitor only
 * Future options:
 *   - Show overlay on all monitors
 *   - Show overlay on monitor where user is working
 *   - Allow user to select which monitor(s) for overlay
 * Implementation notes:
 *   - Use screen.getAllDisplays() to get all monitors
 *   - Create separate overlay window per display if needed
 *   - Track which display the main window is on
 */

import { BrowserWindow, screen, app } from 'electron';
import * as path from 'path';
import logger from '../core/logger';
import { logOverlayShow, logOverlayHide, logOverlayCrash, logOverlayRecovered, logOverlayEvent } from '../core/overlayDebug';

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let currentOverlayStrictMode: boolean = false;
let isQuitting: boolean = false;
let lastBlurFocusTime: number = 0;
const BLUR_FOCUS_DEBOUNCE_MS = 500; // Prevent focus fights

/**
 * Set quitting flag - call before app.quit()
 */
export function setQuitting(value: boolean): void {
  isQuitting = value;
}

function isDev(): boolean {
  return process.env.NODE_ENV === 'development' || !app.isPackaged;
}

/**
 * Get the app icon path for BrowserWindow (launcher/taskbar icon)
 * Uses 256x256 PNG for best Linux compatibility
 * 
 * NOTE: This is separate from tray icon - tray uses its own icon handling
 */
function getAppIconPath(): string {
  if (isDev()) {
    // Development: relative to compiled main.js in dist/main/main/
    return path.join(__dirname, '../../../resources/icons/256x256.png');
  }
  // Production: relative to app.asar resources
  return path.join(process.resourcesPath, 'resources/icons/256x256.png');
}

/**
 * Create the main settings window
 */
export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    title: 'RhythmDesk',
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    backgroundColor: '#1a1a2e',
  });

  logger.info('WindowManager', 'Main window created');

  // Store reference to webContents for crash handling
  const mainWebContents = mainWindow.webContents;

  mainWebContents.on('did-finish-load', () => {
    logger.info('WindowManager', 'Main window renderer loaded');
  });

  // CRITICAL: Handle renderer process crash - reload the window
  mainWebContents.on('crashed', (_event, killed) => {
    logger.error('WindowManager', 'Main window renderer crashed', { killed });
    reloadMainWindow('crashed');
  });

  // Handle render process gone (more detailed than crashed)
  mainWebContents.on('render-process-gone', (_event, details) => {
    logger.error('WindowManager', 'Main window render process gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
    // Only reload if not killed intentionally
    if (details.reason !== 'killed' && details.reason !== 'clean-exit') {
      reloadMainWindow(`render-process-gone:${details.reason}`);
    }
  });

  // Handle unresponsive renderer - common after system resume
  mainWindow.on('unresponsive', () => {
    logger.warn('WindowManager', 'Main window became unresponsive - will reload');
    reloadMainWindow('unresponsive');
  });

  // Handle when window becomes responsive again
  mainWindow.on('responsive', () => {
    logger.info('WindowManager', 'Main window became responsive again');
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    // If quitting, allow close; otherwise minimize to tray
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Load the app
  if (isDev()) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  return mainWindow;
}

/**
 * Reload the main window after crash or unresponsive state
 * This preserves the window but reloads the renderer content
 */
function reloadMainWindow(reason: string): void {
  logger.warn('WindowManager', 'Reloading main window', { reason });
  
  if (!mainWindow || mainWindow.isDestroyed()) {
    logger.info('WindowManager', 'Main window destroyed, recreating');
    createMainWindow();
    return;
  }

  try {
    // Try to reload the existing window
    if (isDev()) {
      mainWindow.loadURL('http://localhost:5173');
    } else {
      mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
    }
    logger.info('WindowManager', 'Main window reloaded successfully', { reason });
  } catch (err) {
    logger.error('WindowManager', 'Failed to reload main window, recreating', { 
      reason, 
      error: String(err) 
    });
    // If reload fails, destroy and recreate
    mainWindow.destroy();
    mainWindow = null;
    createMainWindow();
  }
}

// Main window health check state
let mainWindowHealthCheckPending = false;
let mainWindowHealthCheckTimeout: ReturnType<typeof setTimeout> | null = null;
let mainWindowMissedHealthChecks = 0;
const MAIN_WINDOW_HEALTH_CHECK_TIMEOUT_MS = 5000; // 5 seconds to respond
const MAIN_WINDOW_MAX_MISSED_HEALTH_CHECKS = 2; // Reload after 2 missed checks

/**
 * Start periodic health checks for the main window
 * Detects zombie states where renderer is alive but not functional
 */
export function startMainWindowHealthCheck(): void {
  // Check every 30 seconds when window is visible
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) return; // Only check visible windows
    
    // Don't send another check if one is already pending
    if (mainWindowHealthCheckPending) {
      mainWindowMissedHealthChecks++;
      logger.warn('WindowManager', 'Main window health check still pending', {
        missedChecks: mainWindowMissedHealthChecks,
      });
      
      if (mainWindowMissedHealthChecks >= MAIN_WINDOW_MAX_MISSED_HEALTH_CHECKS) {
        logger.error('WindowManager', 'Main window failed health checks - reloading');
        mainWindowHealthCheckPending = false;
        mainWindowMissedHealthChecks = 0;
        if (mainWindowHealthCheckTimeout) {
          clearTimeout(mainWindowHealthCheckTimeout);
          mainWindowHealthCheckTimeout = null;
        }
        reloadMainWindow('health-check-failed');
      }
      return;
    }
    
    // Send health check request
    mainWindowHealthCheckPending = true;
    mainWindow.webContents.send('main-window:health-check');
    
    // Set timeout for response
    mainWindowHealthCheckTimeout = setTimeout(() => {
      if (mainWindowHealthCheckPending) {
        mainWindowMissedHealthChecks++;
        logger.warn('WindowManager', 'Main window health check timeout', {
          missedChecks: mainWindowMissedHealthChecks,
        });
        mainWindowHealthCheckPending = false;
        
        if (mainWindowMissedHealthChecks >= MAIN_WINDOW_MAX_MISSED_HEALTH_CHECKS) {
          logger.error('WindowManager', 'Main window failed health checks - reloading');
          mainWindowMissedHealthChecks = 0;
          reloadMainWindow('health-check-timeout');
        }
      }
    }, MAIN_WINDOW_HEALTH_CHECK_TIMEOUT_MS);
  }, 30000); // Check every 30 seconds
}

/**
 * Handle health check response from main window renderer
 */
export function onMainWindowHealthCheckResponse(): void {
  if (mainWindowHealthCheckPending) {
    mainWindowHealthCheckPending = false;
    mainWindowMissedHealthChecks = 0;
    if (mainWindowHealthCheckTimeout) {
      clearTimeout(mainWindowHealthCheckTimeout);
      mainWindowHealthCheckTimeout = null;
    }
    logger.debug('WindowManager', 'Main window health check OK');
  }
}

/**
 * Create fullscreen overlay window
 * Designed for Linux - stays on top and covers the screen
 * 
 * LINUX STRICT MODE BEHAVIOR:
 * - Uses kiosk mode for maximum blocking
 * - setAlwaysOnTop with 'screen-saver' level (highest)
 * - Visible on all workspaces
 * - Blocks close/minimize in strict mode
 * - Note: Some Linux WMs may still allow Alt+Tab; this is a WM limitation
 */
export function createOverlayWindow(strictMode: boolean = false): BrowserWindow {
  // If overlay exists with different strict mode, destroy and recreate
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (currentOverlayStrictMode !== strictMode) {
      overlayWindow.destroy();
      overlayWindow = null;
    } else {
      overlayWindow.focus();
      return overlayWindow;
    }
  }

  currentOverlayStrictMode = strictMode;
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size; // Use full size, not workArea

  overlayWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    fullscreen: true,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: !strictMode,
    maximizable: false,
    closable: !strictMode,
    focusable: true,
    // Kiosk mode for strict - provides strongest blocking on Linux
    kiosk: strictMode,
    title: 'RhythmDesk Overlay',
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    backgroundColor: '#1a1a2e',
  });

  logger.info('WindowManager', 'Overlay window created', { strictMode, width, height });
  logOverlayEvent({ event: 'overlay-resync', reason: 'window-created', strictMode });

  const overlayWebContents = overlayWindow.webContents;
  overlayWebContents.on('did-finish-load', () => {
    logger.info('WindowManager', 'Overlay renderer loaded');
  });

  overlayWebContents.on('render-process-gone', (_event, details) => {
    logOverlayCrash(`render-process-gone:${details.reason}`);
    logger.error('WindowManager', 'Overlay render process gone', {
      reason: details.reason,
      exitCode: details.exitCode,
    });
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.destroy();
      overlayWindow = null;
    }
  });

  // Linux-specific: strongest always-on-top level
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setFullScreenable(true);
  overlayWindow.setFullScreen(true);

  // In strict mode, prevent window from being closed via window manager
  if (strictMode) {
    overlayWindow.on('close', (event) => {
      // Prevent closing in strict mode - can only be closed programmatically
      event.preventDefault();
    });

    // Re-focus if somehow loses focus in strict mode (with debounce to prevent fights)
    overlayWindow.on('blur', () => {
      if (overlayWindow && !overlayWindow.isDestroyed() && currentOverlayStrictMode) {
        const now = Date.now();
        // Debounce to prevent rapid focus fights that could freeze the system
        if (now - lastBlurFocusTime < BLUR_FOCUS_DEBOUNCE_MS) {
          return;
        }
        lastBlurFocusTime = now;
        
        setTimeout(() => {
          if (overlayWindow && !overlayWindow.isDestroyed() && currentOverlayStrictMode) {
            overlayWindow.focus();
          }
        }, 200);
      }
    });
  }
  
  // Handle webContents crash - recover the overlay
  overlayWebContents.on('crashed', () => {
    logOverlayCrash('webContents crashed');
    logger.error('WindowManager', 'Overlay webContents crashed - will recover');
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.destroy();
      overlayWindow = null;
    }
  });
  
  // Handle unresponsive renderer
  overlayWindow.on('unresponsive', () => {
    logOverlayEvent({ event: 'overlay-unresponsive', reason: 'BrowserWindow unresponsive event' });
    logOverlayCrash('renderer unresponsive');
    logger.error('WindowManager', 'Overlay became unresponsive - destroying');
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.destroy();
      overlayWindow = null;
    }
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    currentOverlayStrictMode = false;
  });

  // Load overlay view
  if (isDev()) {
    overlayWindow.loadURL('http://localhost:5173/#/overlay');
  } else {
    overlayWindow.loadFile(path.join(__dirname, '../../renderer/index.html'), {
      hash: '/overlay',
    });
  }

  overlayWindow.focus();

  return overlayWindow;
}

/**
 * Show overlay window
 * Always recreates if strict mode changed to ensure correct behavior
 */
export function showOverlay(strictMode: boolean = false): void {
  logOverlayShow('requested', strictMode);
  
  if (!overlayWindow || overlayWindow.isDestroyed() || currentOverlayStrictMode !== strictMode) {
    createOverlayWindow(strictMode);
  } else {
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setFullScreen(true);
    if (strictMode) {
      overlayWindow.setKiosk(true);
    }
    overlayWindow.show();
    overlayWindow.focus();
    logger.info('WindowManager', 'Overlay window shown', { strictMode });
  }
}

/**
 * Hide overlay window
 */
export function hideOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    logger.info('WindowManager', 'Overlay window hidden');
    overlayWindow.hide();
  }
}

/**
 * Close overlay window
 * In strict mode, this should only be called when phase completes
 */
export function closeOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    logOverlayHide('close requested');
    // Remove close prevention handler for strict mode
    overlayWindow.removeAllListeners('close');
    overlayWindow.destroy();
    overlayWindow = null;
    currentOverlayStrictMode = false;
  }
}

/**
 * Check if overlay is currently in strict mode
 */
export function isOverlayStrict(): boolean {
  return currentOverlayStrictMode;
}

/**
 * Get main window instance
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/**
 * Get overlay window instance
 */
export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow;
}

/**
 * Check if overlay window is healthy (exists and responsive)
 * Returns true if overlay is healthy, false if it needs recreation
 */
export function isOverlayHealthy(): boolean {
  if (!overlayWindow) return false;
  if (overlayWindow.isDestroyed()) return false;
  
  // Check if webContents is still valid
  try {
    const webContents = overlayWindow.webContents;
    if (!webContents || webContents.isDestroyed()) return false;
    
    // Check if not crashed
    if (webContents.isCrashed()) {
      logger.error('WindowManager', 'Overlay webContents has crashed');
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error('WindowManager', 'Error checking overlay health', { error });
    return false;
  }
}

/**
 * Recover overlay window if it's unhealthy
 * Used by watchdog to ensure overlay stays alive during long rest blocks
 */
export function recoverOverlayIfNeeded(strictMode: boolean, forceRecreate: boolean = false): boolean {
  if (!forceRecreate && isOverlayHealthy()) {
    return false; // No recovery needed
  }
  
  logger.warn('WindowManager', 'Recovering overlay window', { strictMode, forceRecreate, wasHealthy: isOverlayHealthy() });
  logOverlayEvent({ event: 'overlay-reload', reason: forceRecreate ? 'forced-recreate' : 'unhealthy-window' });
  logOverlayRecovered();
  
  // Clean up old window if it exists
  if (overlayWindow) {
    try {
      overlayWindow.removeAllListeners('close');
      overlayWindow.destroy();
    } catch (e) {
      // Ignore cleanup errors
    }
    overlayWindow = null;
  }
  
  // Create new overlay
  createOverlayWindow(strictMode);
  return true; // Recovery was performed
}

/**
 * Show main window
 */
export function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

/**
 * Hide main window to tray
 */
export function hideMainWindow(): void {
  mainWindow?.hide();
}

/**
 * Send message to overlay window
 */
export function sendToOverlay(channel: string, data?: any): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send(channel, data);
  }
}

/**
 * Send message to main window
 */
export function sendToMain(channel: string, data?: any): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

/**
 * Send message to all windows
 */
export function sendToAll(channel: string, data?: any): void {
  sendToMain(channel, data);
  sendToOverlay(channel, data);
}
