/**
 * RhythmDesk Main Process
 * Entry point for the Electron application
 * 
 * ARCHITECTURE NOTES:
 * - Main process owns all timer state, schedule resolution, phase transitions
 * - Renderer only displays state received via IPC
 * - Overlay decisions go through centralized overlayPolicy module
 * - Focus Lock resets to OFF on restart (not persisted)
 */

import { app, BrowserWindow } from 'electron';
import { createMainWindow, showOverlay, closeOverlay, sendToAll, sendToOverlay, getMainWindow, getOverlayWindow, recoverOverlayIfNeeded } from './windowManager';
import logger from '../core/logger';
import { createTray, updateTrayWithTick } from './tray';
import { registerIpcHandlers } from './ipc';
import { getTimerEngine } from '../core/timerEngine';
import { getOfficeFocusLockService } from '../core/officeFocusLockService';
import { getRestBlockService } from '../core/restBlockService';
import { IPC_CHANNELS, TimerTick, PhaseType } from '../shared/types';
import configService from '../core/configService';
import { createDefaultSchedules } from './defaultSchedules';
import { getOverlayPolicy, OverlayPolicyInput } from '../core/overlayPolicy';
import { logRestBlockStart, logRestBlockTick, logRestBlockEnd } from '../core/overlayDebug';
import { getOverlaySyncService, OVERLAY_SYNC_CHANNELS } from '../core/overlaySync';
// Phase 5: Production hardening imports
import { setupMainProcessErrorHandlers } from '../core/errorHandler';
import { installShutdownHandlers } from '../core/shutdown';
import { getHealthMonitor } from '../core/healthMonitor';
import { getTimerWatchdog } from '../core/watchdog';
import { initDebugMode } from '../core/debugMode';
// Sound service
import { playSound } from '../core/soundService';

/**
 * Get overlay policy for current state
 * Centralized decision engine - all overlay logic goes through here
 */
function getOverlayPolicyForState(phase: PhaseType): ReturnType<typeof getOverlayPolicy> {
  const timerEngine = getTimerEngine();
  const officeFocusLockService = getOfficeFocusLockService();
  const schedule = timerEngine.getCurrentSchedule();
  const state = timerEngine.getState();
  
  const input: OverlayPolicyInput = {
    phase,
    schedule,
    focusLockActive: officeFocusLockService.isActive(),
    focusLockState: officeFocusLockService.getState(),
    isPaused: state.isPaused,
    isPostponed: state.isPostponed,
  };
  
  return getOverlayPolicy(input);
}

function initialize(): void {
  // ========================================
  // PHASE 5: Early initialization (before app ready)
  // ========================================
  
  // Setup global error handlers FIRST
  setupMainProcessErrorHandlers();
  
  // Initialize debug mode from environment
  initDebugMode();
  
  // Install shutdown handlers for graceful exit
  installShutdownHandlers();
  
  logger.info('Main', 'Phase 5 production hardening initialized');
  
  // Prevent multiple instances
  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // Prevent app from quitting when all windows are closed (tray app behavior)
  app.on('window-all-closed', () => {
    // Don't quit - keep running in tray
  });

  // Clean up on quit
  app.on('before-quit', () => {
    logger.info('Main', 'App quitting - flushing session snapshot');
    const timerEngine = getTimerEngine();
    timerEngine.stop();
    // Flush any pending session snapshot before quit
    configService.flushSessionSnapshot();
  });

  // App ready
  app.whenReady().then(() => {
    // Initialize default schedules if none exist
    const schedules = configService.getSchedules();
    if (schedules.length === 0) {
      createDefaultSchedules();
    }

    // Register IPC handlers
    registerIpcHandlers();

    // Create tray first (app stays running even when window is closed)
    createTray();

    // Create main window
    createMainWindow();

    // Initialize and start timer engine
    const timerEngine = getTimerEngine();

    // ========================================
    // PHASE 5: Start watchdogs and health monitor
    // ========================================
    const timerWatchdog = getTimerWatchdog();
    const healthMonitor = getHealthMonitor();
    
    timerWatchdog.start();
    healthMonitor.start();
    
    // NOTE: OverlayWatchdog is NOT started here - it was causing infinite reload
    // loops. The OverlaySyncService handles rest block overlay monitoring instead.
    
    logger.info('Main', 'Watchdogs and health monitor started');
    
    // Handle timer events
    timerEngine.on('tick', (tick: TimerTick) => {
      // Report tick to watchdog for stall detection
      timerWatchdog.reportTick(tick.phaseRemainingMs);
      
      // Send tick to all renderer windows
      sendToAll(IPC_CHANNELS.TIMER_TICK, tick);
      // Update tray
      updateTrayWithTick(tick);
    });

    timerEngine.on('phaseChange', (data: { prevPhase: PhaseType; newPhase: PhaseType }) => {
      sendToAll(IPC_CHANNELS.PHASE_CHANGE, data);
      
      // Play appropriate sound for the phase change
      if (data.newPhase === 'short-break' || data.newPhase === 'long-break') {
        playSound('break_start');
      } else if (data.newPhase === 'sit-to-stand-transition' || data.newPhase === 'stand-to-sit-transition') {
        playSound('transition_start');
      } else if ((data.prevPhase === 'short-break' || data.prevPhase === 'long-break') && 
                 (data.newPhase === 'sit' || data.newPhase === 'stand')) {
        playSound('break_end');
      }

      // Use centralized overlay policy for decisions
      const newPolicy = getOverlayPolicyForState(data.newPhase);
      const prevPolicy = getOverlayPolicyForState(data.prevPhase);

      // Check if RestBlock is active - don't interfere with its overlay
      const restBlockService = getRestBlockService();
      const isRestBlockActive = restBlockService.isActive();

      if (newPolicy.showOverlay) {
        showOverlay(newPolicy.strictMode);
        sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: data.newPhase });
        // NOTE: OverlayWatchdog disabled for regular overlays - it was causing
        // infinite reload loops because it expects heartbeats but doesn't send
        // heartbeat requests. The OverlaySyncService handles rest block monitoring.
      } else if (prevPolicy.showOverlay && !isRestBlockActive) {
        // Close overlay when leaving a phase that required it
        // BUT only if no RestBlock is active (RestBlock takes priority)
        closeOverlay();
        sendToAll(IPC_CHANNELS.HIDE_OVERLAY, {});
      }
    });

    timerEngine.on('scheduleChange', (_schedule: unknown) => {
      sendToAll(IPC_CHANNELS.CONFIG_UPDATED, configService.getConfig());
    });

    // Handle postpone - close overlay when user postpones
    timerEngine.on('postponed', () => {
      playSound('postpone');
      // Don't close overlay if RestBlock is active
      const restBlockService = getRestBlockService();
      if (!restBlockService.isActive()) {
        closeOverlay();
        sendToAll(IPC_CHANNELS.HIDE_OVERLAY, {});
      }
    });
    
    // Handle session reset
    timerEngine.on('sessionReset', () => {
      playSound('session_reset');
    });

    // Initialize Office Focus Lock service and handle its events
    const officeFocusLockService = getOfficeFocusLockService();
    
    officeFocusLockService.on('started', () => {
      playSound('focus_lock_start');
      // When Office Focus Lock starts, use centralized policy to determine overlay
      const currentPhase = timerEngine.getState().currentPhase;
      const policy = getOverlayPolicyForState(currentPhase);
      
      if (policy.showOverlay) {
        showOverlay(policy.strictMode);
        sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: currentPhase });
      }
      sendToAll(IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, officeFocusLockService.getState());
    });

    officeFocusLockService.on('stopped', () => {
      playSound('focus_lock_end');
      // When Office Focus Lock stops, use centralized policy to determine if overlay should close
      const currentPhase = timerEngine.getState().currentPhase;
      const policy = getOverlayPolicyForState(currentPhase);
      const restBlockService = getRestBlockService();
      
      // Close overlay if policy says no overlay needed AND no RestBlock is active
      if (!policy.showOverlay && !restBlockService.isActive()) {
        closeOverlay();
        sendToAll(IPC_CHANNELS.HIDE_OVERLAY, {});
      }
      sendToAll(IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, officeFocusLockService.getState());
    });

    officeFocusLockService.on('expired', () => {
      playSound('focus_lock_end');
      // Office Focus Lock timer expired - same logic as stopped
      const currentPhase = timerEngine.getState().currentPhase;
      const policy = getOverlayPolicyForState(currentPhase);
      const restBlockService = getRestBlockService();
      
      if (!policy.showOverlay && !restBlockService.isActive()) {
        closeOverlay();
        sendToAll(IPC_CHANNELS.HIDE_OVERLAY, {});
      }
      sendToAll(IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, officeFocusLockService.getState());
    });

    // Initialize Rest Block service and handle its events
    const restBlockService = getRestBlockService();
    
    restBlockService.on('started', () => {
      playSound('rest_block_start');
      // When Rest Block starts, pause the normal timer flow and show overlay
      logger.info('Main', 'Rest block started - pausing timer and showing overlay');
      const restState = restBlockService.getState();
      logRestBlockStart(restState.name, restState.durationMs, restState.isStrictMode);
      
      timerEngine.pause();
      showOverlay(restState.isStrictMode);
      sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: 'rest-block', restBlock: restState });
      sendToAll(IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
      
      // Start overlay sync watchdog for rest blocks
      const overlaySyncService = getOverlaySyncService();
      overlaySyncService.start(
        () => sendToOverlay(OVERLAY_SYNC_CHANNELS.HEARTBEAT_REQUEST, {}),
        () => recoverOverlayIfNeeded(restState.isStrictMode)
      );
    });
    
    // CRITICAL: Handle RestBlockService tick events to keep overlay updated
    // This is essential for long rest blocks - without this, the overlay freezes
    restBlockService.on('tick', (restState) => {
      // Log every 10th tick to reduce noise (tick every second)
      if (restState.remainingMs % 10000 < 1000) {
        logRestBlockTick(restState.name, restState.remainingMs);
      }
      // Send rest block state to overlay on every tick
      // This ensures the overlay countdown stays in sync for long durations
      sendToAll(IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
    });

    restBlockService.on('stopped', () => {
      playSound('rest_block_end');
      // When Rest Block stops, resume timer and check if overlay should close
      logger.info('Main', 'Rest block stopped - resuming timer');
      logRestBlockEnd('manual', 'user stopped');
      
      // Stop overlay sync watchdog
      getOverlaySyncService().stop();
      
      timerEngine.resume();
      const currentPhase = timerEngine.getState().currentPhase;
      const policy = getOverlayPolicyForState(currentPhase);
      
      if (!policy.showOverlay) {
        closeOverlay();
        sendToAll(IPC_CHANNELS.HIDE_OVERLAY, {});
      }
      sendToAll(IPC_CHANNELS.REST_BLOCK_CHANGED, restBlockService.getState());
    });

    restBlockService.on('expired', () => {
      playSound('rest_block_end');
      // Rest Block timer expired - resume timer and check overlay
      logger.info('Main', 'Rest block expired - resuming timer');
      logRestBlockEnd('expired', 'timer completed');
      
      // Stop overlay sync watchdog
      getOverlaySyncService().stop();
      
      timerEngine.resume();
      const currentPhase = timerEngine.getState().currentPhase;
      const policy = getOverlayPolicyForState(currentPhase);
      
      if (!policy.showOverlay) {
        closeOverlay();
        sendToAll(IPC_CHANNELS.HIDE_OVERLAY, {});
      }
      sendToAll(IPC_CHANNELS.REST_BLOCK_CHANGED, restBlockService.getState());
    });

    // Start the timer
    timerEngine.start();
    
    // WATCHDOG: Periodically check overlay health during rest blocks
    // This ensures long rest blocks don't get stuck due to overlay issues
    setInterval(() => {
      const restBlockService = getRestBlockService();
      if (restBlockService.isActive()) {
        const restState = restBlockService.getState();
        const overlayWindow = getOverlayWindow();
        
        // If rest block is active but overlay is not healthy, recover it
        if (!overlayWindow || overlayWindow.isDestroyed()) {
          logger.warn('Main', 'Watchdog: Rest block active but overlay missing - recovering');
          const recovered = recoverOverlayIfNeeded(restState.isStrictMode);
          if (recovered) {
            // Send current state to the new overlay
            sendToAll(IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
            sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: 'rest-block', restBlock: restState });
          }
        }
      }
    }, 10000); // Check every 10 seconds

    // Handle app activation (macOS specific, but doesn't hurt on Linux)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
}

// Note: Uncaught exception handlers are now in errorHandler.ts
// setupMainProcessErrorHandlers() installs them with proper failsafe integration

/**
 * Ensure overlay is shown when required
 * Called periodically to auto-reopen accidentally closed overlays
 */
function ensureOverlayIfRequired(): void {
  const timerEngine = getTimerEngine();
  const state = timerEngine.getState();
  const currentPhase = state.currentPhase;
  
  // Use centralized overlay policy
  const policy = getOverlayPolicyForState(currentPhase);
  
  // Check if overlay should be showing
  if (policy.showOverlay) {
    const overlay = getOverlayWindow();
    if (!overlay || overlay.isDestroyed()) {
      logger.warn('Main', 'Overlay should be visible but is not - reopening', { phase: currentPhase });
      showOverlay(policy.strictMode);
    }
  }
}

// Start the app
initialize();

// Periodic overlay health check (every 2 seconds)
setInterval(ensureOverlayIfRequired, 2000);
