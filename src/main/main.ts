/**
 * RhythmDesk Main Process
 * Entry point for the Electron application
 */

import { app, BrowserWindow } from 'electron';
import { createMainWindow, showOverlay, closeOverlay, sendToAll, getMainWindow, getOverlayWindow } from './windowManager';
import logger from '../core/logger';
import { createTray, updateTrayWithTick } from './tray';
import { registerIpcHandlers } from './ipc';
import { getTimerEngine } from '../core/timerEngine';
import { getOfficeFocusLockService } from '../core/officeFocusLockService';
import { IPC_CHANNELS, TimerTick, PhaseType } from '../shared/types';
import configService from '../core/configService';
import { createDefaultSchedules } from './defaultSchedules';

/**
 * Check if a phase is a work phase (sit or stand)
 */
function isWorkPhase(phase: PhaseType): boolean {
  return phase === 'sit' || phase === 'stand';
}

/**
 * Check if a phase is a break/transition phase (always requires overlay)
 */
function isBreakOrTransitionPhase(phase: PhaseType): boolean {
  return [
    'sit-to-stand-transition',
    'stand-to-sit-transition',
    'short-break',
    'long-break',
  ].includes(phase);
}

/**
 * Determine if overlay should be shown for a given phase
 * Rules:
 * - Breaks and transitions: ALWAYS show overlay
 * - Work phases (sit/stand): ONLY if Office Focus Lock is active
 */
function shouldShowOverlayForPhase(phase: PhaseType): boolean {
  // Breaks and transitions always require overlay
  if (isBreakOrTransitionPhase(phase)) {
    return true;
  }
  
  // Work phases only require overlay if Office Focus Lock is active
  if (isWorkPhase(phase)) {
    const officeFocusLockService = getOfficeFocusLockService();
    return officeFocusLockService.isActive();
  }
  
  return false;
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

      // Determine if overlay should be shown based on phase and Focus Mode
      const shouldShowOverlay = shouldShowOverlayForPhase(data.newPhase);
      const wasShowingOverlay = shouldShowOverlayForPhase(data.prevPhase);

      if (shouldShowOverlay) {
        const schedule = timerEngine.getCurrentSchedule();
        const strictMode = schedule?.strictModeEnabled || false;
        showOverlay(strictMode);
        sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: data.newPhase });
      } else if (wasShowingOverlay) {
        // Close overlay when leaving a phase that required it
        closeOverlay();
        sendToAll(IPC_CHANNELS.HIDE_OVERLAY, {});
      }
    });

    timerEngine.on('scheduleChange', (_schedule: unknown) => {
      sendToAll(IPC_CHANNELS.CONFIG_UPDATED, configService.getConfig());
    });

    // Handle postpone - close overlay when user postpones
    timerEngine.on('postponed', () => {
      closeOverlay();
      sendToAll(IPC_CHANNELS.HIDE_OVERLAY, {});
    });

    // Initialize Office Focus Lock service and handle its events
    const officeFocusLockService = getOfficeFocusLockService();
    
    officeFocusLockService.on('started', () => {
      // When Office Focus Lock starts, show overlay if in work phase
      const currentPhase = timerEngine.getState().currentPhase;
      if (isWorkPhase(currentPhase)) {
        const schedule = timerEngine.getCurrentSchedule();
        const strictMode = schedule?.strictModeEnabled || false;
        showOverlay(strictMode);
        sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: currentPhase });
      }
      sendToAll(IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, officeFocusLockService.getState());
    });

    officeFocusLockService.on('stopped', () => {
      // When Office Focus Lock stops, close overlay if in work phase
      const currentPhase = timerEngine.getState().currentPhase;
      if (isWorkPhase(currentPhase)) {
        closeOverlay();
        sendToAll(IPC_CHANNELS.HIDE_OVERLAY, {});
      }
      sendToAll(IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, officeFocusLockService.getState());
    });

    officeFocusLockService.on('expired', () => {
      // Office Focus Lock timer expired - same as stopped
      const currentPhase = timerEngine.getState().currentPhase;
      if (isWorkPhase(currentPhase)) {
        closeOverlay();
        sendToAll(IPC_CHANNELS.HIDE_OVERLAY, {});
      }
      sendToAll(IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, officeFocusLockService.getState());
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
  
  // Skip if paused or postponed
  if (state.isPaused || state.isPostponed) return;
  
  // Check if overlay should be showing
  if (shouldShowOverlayForPhase(currentPhase)) {
    const overlay = getOverlayWindow();
    if (!overlay || overlay.isDestroyed()) {
      logger.warn('Main', 'Overlay should be visible but is not - reopening', { phase: currentPhase });
      const schedule = timerEngine.getCurrentSchedule();
      const strictMode = schedule?.strictModeEnabled || false;
      showOverlay(strictMode);
    }
  }
}

// Start the app
initialize();

// Periodic overlay health check (every 2 seconds)
setInterval(ensureOverlayIfRequired, 2000);
