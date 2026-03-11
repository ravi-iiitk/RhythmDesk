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
import { createMainWindow, showOverlay, closeOverlay, sendToAll, getMainWindow, getOverlayWindow } from './windowManager';
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
    const timerEngine = getTimerEngine();
    timerEngine.stop();
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

    // Handle timer events
    timerEngine.on('tick', (tick: TimerTick) => {
      // Send tick to all renderer windows
      sendToAll(IPC_CHANNELS.TIMER_TICK, tick);
      // Update tray
      updateTrayWithTick(tick);
    });

    timerEngine.on('phaseChange', (data: { prevPhase: PhaseType; newPhase: PhaseType }) => {
      sendToAll(IPC_CHANNELS.PHASE_CHANGE, data);

      // Use centralized overlay policy for decisions
      const newPolicy = getOverlayPolicyForState(data.newPhase);
      const prevPolicy = getOverlayPolicyForState(data.prevPhase);

      // Check if RestBlock is active - don't interfere with its overlay
      const restBlockService = getRestBlockService();
      const isRestBlockActive = restBlockService.isActive();

      if (newPolicy.showOverlay) {
        showOverlay(newPolicy.strictMode);
        sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: data.newPhase });
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
      // Don't close overlay if RestBlock is active
      const restBlockService = getRestBlockService();
      if (!restBlockService.isActive()) {
        closeOverlay();
        sendToAll(IPC_CHANNELS.HIDE_OVERLAY, {});
      }
    });

    // Initialize Office Focus Lock service and handle its events
    const officeFocusLockService = getOfficeFocusLockService();
    
    officeFocusLockService.on('started', () => {
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
      // When Rest Block starts, pause the normal timer flow and show overlay
      timerEngine.pause();
      const restState = restBlockService.getState();
      showOverlay(restState.isStrictMode);
      sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: 'rest-block', restBlock: restState });
      sendToAll(IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
    });

    restBlockService.on('stopped', () => {
      // When Rest Block stops, resume timer and check if overlay should close
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
      // Rest Block timer expired - resume timer and check overlay
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

    // Handle app activation (macOS specific, but doesn't hurt on Linux)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
}

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('Main', 'Uncaught exception', { message: error.message, stack: error.stack });
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.error('Main', 'Unhandled rejection', { reason });
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

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
