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

import { app, BrowserWindow, powerMonitor, globalShortcut, session } from 'electron';
import { createMainWindow, showOverlay, closeOverlay, sendToAll, sendToOverlay, getMainWindow, getOverlayWindow, recoverOverlayIfNeeded, startMainWindowHealthCheck, setScreenLocked, showAndFocusMainWindow } from './windowManager';
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
import { playSound, getSoundService } from '../core/soundService';
// Idle detection
import { getIdleDetector } from '../core/idleDetector';
import { isBreakPhase } from '../core/transitions';
// Autostart
import { syncLoginItemWithSettings } from './autostart';
// Focus Sessions
import { getFocusSessionService } from '../core/focusSessionService';
import { enterFocusLockdown, exitFocusLockdown, isFocusLockdownActive, setShortcutRestoreCallback } from './focusLockdown';
import { FocusSession } from '../shared/types';
import { isPauseReminderShowing, setPauseReminderShowing, clearPauseReminderFlag } from './pauseReminderState';
// Activity log
import {
  logPhaseStarted,
  logPhaseCompleted,
  logSessionReset,
  logScheduleStarted,
  logScheduleStopped,
  logFocusLockStarted,
  logFocusLockEnded,
  logRestBlockStarted,
  logRestBlockEnded,
  pruneActivityLog,
} from '../core/activityLogService';

/**
 * Get overlay policy for current state
 * Centralized decision engine - all overlay logic goes through here
 */

/**
 * Safely close the overlay AND stop the heartbeat watchdog.
 * Every overlay-close path must use this to prevent the watchdog from
 * detecting "missed heartbeats" on a closed overlay and recreating it.
 */
function safeCloseOverlay(): void {
  const syncService = getOverlaySyncService();
  if (syncService.getState().isOverlayActive) {
    syncService.stop();
  }
  closeOverlay();
  sendToAll(IPC_CHANNELS.HIDE_OVERLAY, {});
  // Clear pause reminder flag when overlay closes
  clearPauseReminderFlag();
}

function getOverlayPolicyForState(phase: PhaseType): ReturnType<typeof getOverlayPolicy> {
  const timerEngine = getTimerEngine();
  const officeFocusLockService = getOfficeFocusLockService();
  const schedule = timerEngine.getCurrentSchedule();
  const state = timerEngine.getState();
  
  // Get current flow step for custom step overlay/pause/strict flags
  const currentFlowStep = schedule?.mode === 'flow-based' && schedule.flowSteps
    && state.currentFlowStepIndex !== undefined
    ? schedule.flowSteps[state.currentFlowStepIndex]
    : undefined;
  
  const input: OverlayPolicyInput = {
    phase,
    schedule,
    focusLockActive: officeFocusLockService.isActive(),
    focusLockState: officeFocusLockService.getState(),
    isPaused: state.isPaused,
    isPostponed: state.isPostponed,
    isWaitingForNextActivity: state.isWaitingForNextActivity,
    currentFlowStep,
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

  // Clean up on quit — but block during focus lockdown
  app.on('before-quit', (event) => {
    if (isFocusLockdownActive()) {
      logger.warn('Main', 'before-quit blocked — focus session is active');
      event.preventDefault();
      return;
    }
    logger.info('Main', 'App quitting - flushing session snapshot');
    const timerEngine = getTimerEngine();
    timerEngine.stop();
    // Flush any pending session snapshot before quit
    configService.flushSessionSnapshot();
    // Unregister all global shortcuts
    globalShortcut.unregisterAll();
  });

  // App ready
  app.whenReady().then(() => {
    // Grant microphone permission for voice commands (Web Speech API)
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      if (permission === 'media') {
        callback(true);
      } else {
        callback(false);
      }
    });
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
      if (permission === 'media') return true;
      return false;
    });

    // Initialize default schedules if none exist
    const schedules = configService.getSchedules();
    if (schedules.length === 0) {
      createDefaultSchedules();
    }

    // Register IPC handlers
    registerIpcHandlers();

    // Sync autostart .desktop file with saved setting
    const startupSettings = configService.getGeneralSettings();
    syncLoginItemWithSettings(startupSettings.startOnLogin ?? false);

    // Create tray first (app stays running even when window is closed)
    createTray();

    // Create main window
    createMainWindow();
    
    // Register global shortcut to bring main window to front
    const shortcutRegistered = globalShortcut.register('Super+Shift+R', () => {
      logger.info('Main', 'Global shortcut triggered: Super+Shift+R');
      showAndFocusMainWindow();
    });
    
    if (shortcutRegistered) {
      logger.info('Main', 'Global shortcut registered: Super+Shift+R (bring app to front)');
    } else {
      logger.warn('Main', 'Failed to register global shortcut: Super+Shift+R');
    }

    // Register global shortcut for ad-hoc break (Super+Shift+B)
    const breakShortcutRegistered = globalShortcut.register('Super+Shift+B', () => {
      logger.info('Main', 'Global shortcut triggered: Super+Shift+B (ad-hoc break)');
      const timerEng = getTimerEngine();
      const state = timerEng.getState();
      // Only start break if in work phase
      if (state.currentPhase === 'sit' || state.currentPhase === 'stand') {
        // Use short break duration from current schedule (default 5 min)
        const schedule = timerEng.getCurrentSchedule();
        const shortBreakDuration = schedule?.shortBreak?.durationMinutes ?? 5;
        timerEng.startAdHocBreak(shortBreakDuration);
      }
    });

    if (breakShortcutRegistered) {
      logger.info('Main', 'Global shortcut registered: Super+Shift+B (ad-hoc break)');
    } else {
      logger.warn('Main', 'Failed to register global shortcut: Super+Shift+B');
    }

    // CRITICAL: Register global EMERGENCY KILL shortcut (Super+Shift+Q)
    // This works at the OS level regardless of overlay/renderer state.
    // If the overlay is frozen/crashed/unresponsive, this is the user's escape hatch.
    const killShortcutRegistered = globalShortcut.register('Super+Shift+Q', () => {
      logger.warn('Main', '🚨 EMERGENCY KILL shortcut triggered: Super+Shift+Q');
      // 1. Force-close any overlay (bypasses strict mode, close prevention, everything)
      safeCloseOverlay();
      // 2. Pause the timer to prevent overlay from immediately reopening
      const timerEng = getTimerEngine();
      if (!timerEng.getState().isPaused) {
        timerEng.pause();
      }
      // 3. Stop any active rest block
      const restBlock = getRestBlockService();
      if (restBlock.isActive()) {
        restBlock.stop();
      }
      // 4. Clear water reminder if active
      if (timerEng.isWaterReminderActive()) {
        timerEng.dismissWaterReminder();
      }
      // 5. Show notification to user that emergency kill succeeded
      const { Notification } = require('electron');
      new Notification({
        title: 'RhythmDesk — Emergency Kill',
        body: 'Overlay force-closed. Schedule paused. Use Super+Shift+R to reopen the app.',
      }).show();
      logger.warn('Main', '🚨 Emergency kill complete — overlay destroyed, timer paused');
    });

    if (killShortcutRegistered) {
      logger.info('Main', 'Global shortcut registered: Super+Shift+Q (emergency kill overlay)');
    } else {
      logger.warn('Main', 'Failed to register global shortcut: Super+Shift+Q');
    }

    // Also register Super+Shift+Escape as backup emergency kill
    // (in case Super+Shift+Q conflicts with another app)
    const killShortcut2Registered = globalShortcut.register('Super+Shift+Escape', () => {
      logger.warn('Main', '🚨 EMERGENCY KILL shortcut triggered: Super+Shift+Escape');
      safeCloseOverlay();
      const timerEng = getTimerEngine();
      if (!timerEng.getState().isPaused) {
        timerEng.pause();
      }
      const restBlock = getRestBlockService();
      if (restBlock.isActive()) {
        restBlock.stop();
      }
      if (timerEng.isWaterReminderActive()) {
        timerEng.dismissWaterReminder();
      }
      const { Notification } = require('electron');
      new Notification({
        title: 'RhythmDesk — Emergency Kill',
        body: 'Overlay force-closed. Schedule paused.',
      }).show();
      logger.warn('Main', '🚨 Emergency kill complete (via Super+Shift+Escape)');
    });

    if (killShortcut2Registered) {
      logger.info('Main', 'Global shortcut registered: Super+Shift+Escape (emergency kill backup)');
    } else {
      logger.warn('Main', 'Failed to register global shortcut: Super+Shift+Escape');
    }
    
    // Tell focusLockdown how to re-register our global shortcuts after a session ends.
    // enterFocusLockdown unregisters Super+Shift+Q/B/R; this callback restores them.
    setShortcutRestoreCallback(() => {
      // Re-register only if not already registered (avoids double-registration errors)
      if (!globalShortcut.isRegistered('Super+Shift+Q')) {
        globalShortcut.register('Super+Shift+Q', () => {
          const timerEng = getTimerEngine();
          safeCloseOverlay();
          if (!timerEng.getState().isPaused) timerEng.pause();
          const rb = getRestBlockService();
          if (rb.isActive()) rb.stop();
          if (timerEng.isWaterReminderActive()) timerEng.dismissWaterReminder();
        });
      }
      if (!globalShortcut.isRegistered('Super+Shift+B')) {
        globalShortcut.register('Super+Shift+B', () => {
          const timerEng = getTimerEngine();
          const st = timerEng.getState();
          if (st.currentPhase === 'sit' || st.currentPhase === 'stand') {
            const sched = timerEng.getCurrentSchedule();
            timerEng.startAdHocBreak(sched?.shortBreak?.durationMinutes ?? 5);
          }
        });
      }
      if (!globalShortcut.isRegistered('Super+Shift+R')) {
        globalShortcut.register('Super+Shift+R', () => showAndFocusMainWindow());
      }
      if (!globalShortcut.isRegistered('Super+Shift+Escape')) {
        globalShortcut.register('Super+Shift+Escape', () => {
          const timerEng = getTimerEngine();
          safeCloseOverlay();
          if (!timerEng.getState().isPaused) timerEng.pause();
          const rb = getRestBlockService();
          if (rb.isActive()) rb.stop();
          if (timerEng.isWaterReminderActive()) timerEng.dismissWaterReminder();
        });
      }
    });

    // Start main window health check watchdog
    // This detects zombie states after system suspend/resume
    startMainWindowHealthCheck();
    logger.info('Main', 'Main window health check watchdog started');

    // Initialize sound service before wiring timer events
    getSoundService().initialize();

    // Initialize and start timer engine
    const timerEngine = getTimerEngine();
    let lastTimerTick: TimerTick | null = null;
    let lastOverlayUpdateSentAt = 0;

    const sendOverlayResyncSnapshot = (reason: string): void => {
      const restState = getRestBlockService().getState();
      const tick = timerEngine.getLastEmittedTick() || lastTimerTick;
      const state = timerEngine.getState();

      // Include pause reminder data if timer is paused and pause reminder is showing
      const pauseReminder = (state.isPaused && isPauseReminderShowing() && state.pausedAt)
        ? { pausedForMs: Date.now() - state.pausedAt, pausedAt: state.pausedAt }
        : null;

      sendToOverlay(OVERLAY_SYNC_CHANNELS.RESYNC_DATA, {
        requestedAt: Date.now(),
        tick,
        restBlock: restState,
        overlayStateVersion: restState.startedAt ?? Date.now(),
        reason,
        pauseReminder,
      });

      logger.info('Main', 'Overlay state resent', {
        reason,
        hasTick: !!tick,
        restBlockActive: restState.isActive,
        restRemainingMs: restState.remainingMs,
      });
    };

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
    
    // Declare overlaySyncService here (before any event handler closures that reference it)
    // to avoid a Temporal Dead Zone hazard if timerEngine emits events before line 647.
    const overlaySyncService = getOverlaySyncService();

    // Handle timer events
    timerEngine.on('tick', (tick: TimerTick) => {
      lastTimerTick = tick;
      // Report tick to watchdog for stall detection
      timerWatchdog.reportTick(tick.phaseRemainingMs);
      
      // Check focus session on every tick (1 s) for precise start/end detection
      getFocusSessionService().check(timerEngine.getCurrentSchedule(), Date.now());

      // Send tick to all renderer windows
      sendToAll(IPC_CHANNELS.TIMER_TICK, tick);
      // Update tray
      updateTrayWithTick(tick);

      logger.debug('Main', 'Authoritative timer tick broadcast', {
        phase: tick.currentPhase,
        phaseRemainingMs: tick.phaseRemainingMs,
      });
    });

    timerEngine.on('phaseChange', (data: { prevPhase: PhaseType; newPhase: PhaseType }) => {
      sendToAll(IPC_CHANNELS.PHASE_CHANGE, data);
      
      // Activity log: log phase completion and new phase start
      const scheduleName = timerEngine.getState().activeScheduleId ? 
        (timerEngine as any).currentSchedule?.name : undefined;
      if (data.prevPhase !== 'idle') {
        logPhaseCompleted(data.prevPhase, undefined, scheduleName);
      }
      if (data.newPhase !== 'idle') {
        const state = timerEngine.getState();
        logPhaseStarted(data.newPhase, scheduleName, state.phaseTotalMs);
      }

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

      // Check if RestBlock is active - don't interfere with its overlay
      const restBlockService = getRestBlockService();
      const isRestBlockActive = restBlockService.isActive();

      if (newPolicy.showOverlay) {
        // CRITICAL: Dismiss water reminder if active before showing a new overlay.
        // Otherwise its 2-minute auto-dismiss timeout will fire later and close
        // the break overlay, leaving a blank/frozen screen when health check reopens it.
        if (timerEngine.isWaterReminderActive()) {
          timerEngine.dismissWaterReminder();
        }
        
        showOverlay(newPolicy.strictMode);
        sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: data.newPhase });
        
        // CRITICAL FIX: Send tick to overlay after delay to ensure React has mounted.
        // In dev mode, did-finish-load fires when HTML loads but before Vite's JS bundle
        // executes. The first regular tick (sent immediately) arrives before React registers
        // its onTimerTick listener and is lost. This delayed send ensures overlay gets data.
        setTimeout(() => {
          const latestTick = timerEngine.getLastEmittedTick();
          if (latestTick) {
            sendToOverlay(IPC_CHANNELS.TIMER_TICK, latestTick);
          }
        }, 500);
        setTimeout(() => {
          const latestTick = timerEngine.getLastEmittedTick();
          if (latestTick) {
            sendToOverlay(IPC_CHANNELS.TIMER_TICK, latestTick);
          }
        }, 1500);

        // Start overlay heartbeat watchdog ONLY for long phases (breaks).
        // DO NOT start for transitions — they are too short (30s) and the watchdog's
        // grace period (8s) + detection time (10s) causes false-positive "stale" detection
        // that destroys and recreates the overlay mid-transition, making it look frozen.
        const isLongPhase = data.newPhase === 'short-break' || data.newPhase === 'long-break' || data.newPhase === 'custom';
        if (isLongPhase && !isRestBlockActive && !overlaySyncService.getState().isOverlayActive) {
          overlaySyncService.start(
            () => sendToOverlay(OVERLAY_SYNC_CHANNELS.HEARTBEAT_REQUEST, {}),
            () => {
              // CRITICAL: Use CURRENT state, not stale closure values.
              const currentPhase = timerEngine.getState().currentPhase;
              const currentPolicy = getOverlayPolicyForState(currentPhase);
              if (!currentPolicy.showOverlay) {
                logger.info('Main', 'Heartbeat recovery skipped — overlay no longer needed', { currentPhase });
                overlaySyncService.stop();
                return;
              }
              const recovered = recoverOverlayIfNeeded(currentPolicy.strictMode, true);
              if (recovered) {
                sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: currentPhase });
                logger.warn('Main', 'Overlay recovered via heartbeat watchdog during phase', {
                  phase: currentPhase,
                });
              }
            }
          );
        }
      } else if (!isRestBlockActive) {
        // Close overlay if it's open and new policy doesn't require it.
        // This handles: transition→waiting (overlay was shown for transition,
        // must close), and normal phase→work transitions.
        const overlay = getOverlayWindow();
        if (overlay && !overlay.isDestroyed()) {
          safeCloseOverlay();
        }
      }
    });

    timerEngine.on('scheduleChange', (_schedule: unknown) => {
      sendToAll(IPC_CHANNELS.CONFIG_UPDATED, configService.getConfig());
      // Activity log: track schedule activation/deactivation
      const schedule = timerEngine.getCurrentSchedule();
      if (schedule) {
        logScheduleStarted(schedule.name);
      } else {
        logScheduleStopped();
      }
      // If the schedule changed (or was deactivated), re-evaluate focus session immediately.
      // This handles: schedule deactivated, schedule switched, schedule deleted.
      getFocusSessionService().check(schedule, Date.now());
    });

    // Handle postpone - close overlay when user postpones
    timerEngine.on('postponed', () => {
      playSound('postpone');
      // Don't close overlay if RestBlock is active
      const restBlockService = getRestBlockService();
      if (!restBlockService.isActive()) {
        safeCloseOverlay();
      }
    });
    
    // Handle session reset
    timerEngine.on('sessionReset', () => {
      playSound('session_reset');
      logSessionReset((timerEngine as any).currentSchedule?.name);
    });

    // Handle pause reminder - show overlay every 5 min when paused
    timerEngine.on('pauseReminder', (data: { pausedForMs: number; pausedAt: number }) => {
      logger.info('Main', 'Showing pause reminder overlay', { pausedForMs: data.pausedForMs });
      setPauseReminderShowing(true);
      showOverlay(false); // Non-strict, dismissible overlay
      // Send SHOW_PAUSE_REMINDER immediately AND after load to win the race
      // against the tick resync that would cause the renderer to see isPaused
      // and render a blank/work overlay instead of the pause reminder.
      const overlay = getOverlayWindow();
      if (overlay && !overlay.isDestroyed()) {
        const webContents = overlay.webContents;
        const sendEvent = () => {
          sendToAll(IPC_CHANNELS.SHOW_PAUSE_REMINDER, data);
        };
        // Send immediately (in case overlay is already loaded)
        sendEvent();
        // Also send after load completes (in case overlay was just created)
        if (webContents.isLoading()) {
          webContents.once('did-finish-load', sendEvent);
        }
      }
    });

    // Handle water reminder - show hydration overlay every N minutes
    // CRITICAL: Use NON-strict mode (false) — water reminder must NEVER lock the user out.
    // Strict/kiosk mode prevents closing and refocuses on blur, which causes a frozen
    // fullscreen overlay if the React component fails to render the dismiss button.
    timerEngine.on('waterReminder', (data: { triggeredAt: number }) => {
      logger.info('Main', 'Showing water reminder overlay (non-strict)');
      showOverlay(false); // NON-strict — user can always escape
      
      // Wait for overlay to fully load before sending the event.
      // The old 500ms delay was a race condition — overlay might not be loaded yet.
      const overlay = getOverlayWindow();
      if (overlay && !overlay.isDestroyed()) {
        const webContents = overlay.webContents;
        const sendEvent = () => {
          sendToAll(IPC_CHANNELS.SHOW_WATER_REMINDER, data);
        };
        // If already loaded, send immediately; otherwise wait for load
        if (!webContents.isLoading()) {
          sendEvent();
        } else {
          webContents.once('did-finish-load', sendEvent);
        }
      }
      
      // Safety net: auto-dismiss water reminder after 2 minutes if user doesn't interact
      // This prevents any scenario where the overlay gets stuck
      setTimeout(() => {
        if (timerEngine.isWaterReminderActive()) {
          logger.warn('Main', 'Water reminder auto-dismissed after 2 minute timeout');
          timerEngine.dismissWaterReminder();
          // Only close overlay if no break/transition phase or pause reminder needs it.
          // This prevents accidentally closing a break overlay that replaced the water one,
          // or a pause reminder overlay that's coexisting with the water reminder.
          const currentPhase = timerEngine.getState().currentPhase;
          const policy = getOverlayPolicyForState(currentPhase);
          if (!policy.showOverlay && !isPauseReminderShowing()) {
            safeCloseOverlay();
          }
        }
      }, 120000);
    });

    // ========================================
    // System Idle Detection
    // ========================================
    const idleDetector = getIdleDetector();
    let idleAutoPaused = false; // Track if WE paused it (vs user manually paused)

    const initIdleDetection = () => {
      const settings = configService.getGeneralSettings();
      if (settings.autoIdlePause) {
        if (!idleDetector.isRunning()) {
          idleDetector.start(settings.idleThresholdMinutes ?? 3);
        } else {
          idleDetector.setThreshold(settings.idleThresholdMinutes ?? 3);
        }
      } else {
        idleDetector.stop();
        idleAutoPaused = false;
      }
    };

    // Initialize on startup
    initIdleDetection();

    // Re-initialize when config changes (schedule or settings saved)
    timerEngine.on('scheduleChange', () => {
      initIdleDetection();
    });
    timerEngine.on('configSaved', () => {
      initIdleDetection();
    });

    idleDetector.on('idle', () => {
      const state = timerEngine.getState();
      const restBlockActive = getRestBlockService().isActive();
      const breakActive = isBreakPhase(state.currentPhase);
      // Don't auto-pause during breaks or rest blocks (user is intentionally away)
      if (!state.isPaused && state.currentPhase !== 'idle' && !restBlockActive && !breakActive) {
        logger.info('Main', 'System idle detected - auto-pausing schedule');
        timerEngine.pause();
        idleAutoPaused = true;
        // Don't show pause overlay immediately — let timerEngine's 5-minute
        // pause reminder interval handle it. The overlay will appear after
        // the configured reminder interval (5 min by default).
      }
    });

    idleDetector.on('active', () => {
      if (idleAutoPaused) {
        // DESIGN: Do NOT auto-resume when system becomes active again.
        // The user should see the pause overlay and choose to resume manually.
        // This prevents the unwanted transition overlay that appeared when
        // auto-resume triggered a phase change right after system wake.
        logger.info('Main', 'System activity detected after idle auto-pause - keeping schedule paused (user must resume manually)');
        idleAutoPaused = false;
        // Pause overlay is already showing from idle event — keep it open.
      }
    });

    // Initialize Office Focus Lock service and handle its events
    const officeFocusLockService = getOfficeFocusLockService();
    
    officeFocusLockService.on('started', () => {
      playSound('focus_lock_start');
      const lockState = officeFocusLockService.getState();
      logFocusLockStarted(lockState.label, lockState.durationMs);
      // When Office Focus Lock starts, use centralized policy to determine overlay
      const currentPhase = timerEngine.getState().currentPhase;
      const policy = getOverlayPolicyForState(currentPhase);
      
      if (policy.showOverlay) {
        showOverlay(policy.strictMode);
        sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: currentPhase });
      }
      sendToAll(IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, lockState);
    });

    officeFocusLockService.on('stopped', () => {
      playSound('focus_lock_end');
      logFocusLockEnded();
      // When Office Focus Lock stops, use centralized policy to determine if overlay should close
      const currentPhase = timerEngine.getState().currentPhase;
      const policy = getOverlayPolicyForState(currentPhase);
      const restBlockService = getRestBlockService();
      
      // Close overlay if policy says no overlay needed AND no RestBlock is active
      if (!policy.showOverlay && !restBlockService.isActive()) {
        safeCloseOverlay();
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
        safeCloseOverlay();
      }
      sendToAll(IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, officeFocusLockService.getState());
    });

    // Initialize Rest Block service and handle its events
    const restBlockService = getRestBlockService();

    overlaySyncService.on('heartbeat-missed', (missedCount: number) => {
      logger.warn('Main', 'Overlay heartbeat missed during rest block', {
        missedCount,
        restBlockActive: restBlockService.isActive(),
      });
    });

    overlaySyncService.on('overlay-stale', () => {
      logger.error('Main', 'Overlay marked stale by heartbeat watchdog');
    });

    overlaySyncService.on('overlay-recovered', () => {
      logger.info('Main', 'Overlay recovered after stale detection');
      sendOverlayResyncSnapshot('overlay-recovered');
    });
    
    restBlockService.on('started', () => {
      playSound('rest_block_start');
      // When Rest Block starts, pause the normal timer flow and show overlay
      logger.info('Main', 'Rest block started - pausing timer and showing overlay');
      const restState = restBlockService.getState();
      logRestBlockStart(restState.name, restState.durationMs, restState.isStrictMode);
      logRestBlockStarted(restState.name, restState.durationMs);
      
      timerEngine.pause();
      showOverlay(restState.isStrictMode);
      sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: 'rest-block', restBlock: restState });
      sendToAll(IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
      sendOverlayResyncSnapshot('rest-block-start');
      lastOverlayUpdateSentAt = Date.now();
      
      // Start overlay sync watchdog for rest blocks
      overlaySyncService.start(
        () => sendToOverlay(OVERLAY_SYNC_CHANNELS.HEARTBEAT_REQUEST, {}),
        () => {
          const recovered = recoverOverlayIfNeeded(restState.isStrictMode, true);
          if (recovered) {
            const currentRestState = restBlockService.getState();
            sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: 'rest-block', restBlock: currentRestState });
            sendToAll(IPC_CHANNELS.REST_BLOCK_CHANGED, currentRestState);
            sendOverlayResyncSnapshot('heartbeat-recovery');
            logger.warn('Main', 'Overlay recovered after missed heartbeats', {
              restBlockName: currentRestState.name,
              remainingMs: currentRestState.remainingMs,
            });
          }
        }
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
      lastOverlayUpdateSentAt = Date.now();

      logger.debug('Main', 'Rest block overlay update sent', {
        remainingMs: restState.remainingMs,
        lastOverlayUpdateSentAt,
      });
    });

    restBlockService.on('stopped', () => {
      playSound('rest_block_end');
      // When Rest Block stops, resume timer and check if overlay should close
      logger.info('Main', 'Rest block stopped - resuming timer');
      logRestBlockEnd('manual', 'user stopped');
      logRestBlockEnded('Rest Block', undefined);
      
      timerEngine.resume();
      const currentPhase = timerEngine.getState().currentPhase;
      const policy = getOverlayPolicyForState(currentPhase);
      
      if (!policy.showOverlay) {
        safeCloseOverlay();
      }
      sendToAll(IPC_CHANNELS.REST_BLOCK_CHANGED, restBlockService.getState());
    });

    restBlockService.on('expired', () => {
      playSound('rest_block_end');
      // Rest Block timer expired - resume timer and check overlay
      logger.info('Main', 'Rest block expired - resuming timer');
      logRestBlockEnd('expired', 'timer completed');
      logRestBlockEnded('Rest Block', undefined);
      
      timerEngine.resume();
      const currentPhase = timerEngine.getState().currentPhase;
      const policy = getOverlayPolicyForState(currentPhase);
      
      if (!policy.showOverlay) {
        safeCloseOverlay();
      }
      sendToAll(IPC_CHANNELS.REST_BLOCK_CHANGED, restBlockService.getState());
    });

    // Prune old activity log entries on startup
    const retentionDays = configService.getConfig()?.generalSettings?.logRetentionDays ?? 30;
    pruneActivityLog(retentionDays);

    // ========================================
    // FOCUS SESSION: Restore lockdown on startup
    // If the app was restarted (e.g. after kill-9) while a focus session was
    // active, immediately re-enter lockdown before the user can interact.
    // ========================================
    const focusSessionService = getFocusSessionService();
    const persistedState = timerEngine.getState();
    const now = Date.now();
    if (
      persistedState.isFocusSessionActive &&
      persistedState.focusSessionEndsAt !== null &&
      persistedState.focusSessionEndsAt > now
    ) {
      const mainWin = getMainWindow();
      if (mainWin) {
        logger.info('Main', 'Restoring focus lockdown from persisted state', {
          endsAt: new Date(persistedState.focusSessionEndsAt).toISOString(),
        });
        enterFocusLockdown(mainWin);
        // Schedule the auto-exit at the persisted end time
        const msRemaining = persistedState.focusSessionEndsAt - now;
        setTimeout(() => {
          const win = getMainWindow();
          if (win && isFocusLockdownActive()) {
            logger.info('Main', 'Focus session time elapsed after restart — releasing lockdown');
            exitFocusLockdown(win);
            timerEngine.clearFocusSessionState();
            sendToAll(IPC_CHANNELS.FOCUS_SESSION_CHANGED, { isActive: false, activeSession: null });
          }
        }, msRemaining);
      }
    } else if (persistedState.isFocusSessionActive) {
      timerEngine.clearFocusSessionState();
    }

    // Wire focus session start/end events
    focusSessionService.on('started', (session: FocusSession, endsAtMs: number) => {
      const mainWin = getMainWindow();
      if (!mainWin) return;
      enterFocusLockdown(mainWin);
      timerEngine.setFocusSessionState(session.id, endsAtMs);
      sendToAll(IPC_CHANNELS.FOCUS_SESSION_CHANGED, {
        isActive: true,
        activeSession: session,
        endsAtMs,
      });
      logger.info('Main', 'Focus session lockdown started', { name: session.name });
    });

    focusSessionService.on('ended', (session: FocusSession) => {
      const mainWin = getMainWindow();
      if (mainWin && isFocusLockdownActive()) {
        exitFocusLockdown(mainWin);
      }
      timerEngine.clearFocusSessionState();
      sendToAll(IPC_CHANNELS.FOCUS_SESSION_CHANGED, {
        isActive: false,
        activeSession: null,
        endedSession: session,
      });
      logger.info('Main', 'Focus session lockdown ended', { name: session.name });
    });

    // Periodic focus session check (every 30 s) — also runs on tick for precision
    setInterval(() => {
      const schedule = timerEngine.getCurrentSchedule();
      focusSessionService.check(schedule, Date.now());
    }, 30_000);

    // Start the timer
    timerEngine.start();

    // Activity log: record the initial state so the log isn't empty on first launch
    const initialSchedule = timerEngine.getCurrentSchedule();
    const initialState = timerEngine.getState();
    if (initialSchedule && initialState.currentPhase !== 'idle') {
      logScheduleStarted(initialSchedule.name);
      logPhaseStarted(initialState.currentPhase, initialSchedule.name, initialState.phaseTotalMs);
    }
    
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
          const recovered = recoverOverlayIfNeeded(restState.isStrictMode, true);
          if (recovered) {
            // Send current state to the new overlay
            sendToAll(IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
            sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: 'rest-block', restBlock: restState });
            sendOverlayResyncSnapshot('overlay-window-missing-watchdog');
          }
        }
      }
    }, 10000); // Check every 10 seconds

    // ========================================
    // FIX: Screen-lock/unlock overlay recovery
    // On Linux, screen-lock can freeze Chromium renderer processes.
    // When the screen unlocks, we must verify the overlay is healthy
    // and force-recover it if the renderer was killed or frozen.
    // ========================================
    powerMonitor.on('lock-screen', () => {
      setScreenLocked(true);
      logger.info('Main', 'Screen locked - overlay renderer may be throttled');
    });
    
    powerMonitor.on('unlock-screen', () => {
      setScreenLocked(false);
      logger.info('Main', 'Screen unlocked - checking overlay health');
      
      // Delay recovery slightly to let the display compositor settle
      setTimeout(() => {
        const currentPhase = timerEngine.getState().currentPhase;
        const policy = getOverlayPolicyForState(currentPhase);
        const restBlockActive = getRestBlockService().isActive();
        
        if (policy.showOverlay || restBlockActive) {
          const overlay = getOverlayWindow();
          
          if (!overlay || overlay.isDestroyed()) {
            // Overlay window was destroyed during lock - recreate
            logger.warn('Main', 'Overlay missing after screen unlock - recreating', { currentPhase });
            const recovered = recoverOverlayIfNeeded(policy.strictMode, true);
            if (recovered) {
              if (restBlockActive) {
                const restState = getRestBlockService().getState();
                sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: 'rest-block', restBlock: restState });
                sendToAll(IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
                sendOverlayResyncSnapshot('screen-unlock-recovery');
              } else {
                sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: currentPhase });
              }
            }
          } else {
            // Overlay window exists - force reload content in case renderer was frozen
            // The 'responsive' event handler may not fire reliably on all Linux WMs
            logger.info('Main', 'Overlay exists after unlock - re-asserting and resyncing');
            try {
              overlay.setAlwaysOnTop(true, 'screen-saver');
              overlay.setFullScreen(true);
              overlay.show();
              overlay.focus();
            } catch (e) {
              logger.error('Main', 'Failed to re-assert overlay after unlock - recreating', { error: String(e) });
              recoverOverlayIfNeeded(policy.strictMode, true);
            }
            
            // Send fresh state to overlay in case it was stale during screen lock
            if (restBlockActive) {
              const restState = getRestBlockService().getState();
              sendToAll(IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
            }
            // Always resync - critical for transitions that expired during lock
            sendOverlayResyncSnapshot('screen-unlock-resync');
          }
        }
      }, 1500); // 1.5s delay for compositor to settle
    });
    
    // Also handle system resume (suspend/hibernate)
    powerMonitor.on('resume', () => {
      logger.info('Main', 'System resumed from suspend - checking overlay');
      // If the system was suspended while we had an idle auto-pause pending,
      // clear it so we don't fire a stale auto-resume after a long sleep.
      if (idleAutoPaused) {
        logger.info('Main', 'Clearing stale idleAutoPaused flag on system resume');
        idleAutoPaused = false;
      }
      // Same recovery logic as unlock, but with longer delay for system wake
      setTimeout(() => {
        const state = timerEngine.getState();
        const currentPhase = state.currentPhase;
        const policy = getOverlayPolicyForState(currentPhase);
        const restBlockActive = getRestBlockService().isActive();
        
        // Clear stale pause reminder flag if timer is no longer paused
        if (!state.isPaused && isPauseReminderShowing()) {
          logger.info('Main', 'Clearing stale pause reminder flag on system resume (timer not paused)');
          clearPauseReminderFlag();
        }
        
        // CRITICAL: If timer is paused and we were showing pause reminder, restore it
        // The overlay policy returns showOverlay=false when paused, but we need to
        // preserve the pause reminder overlay so user sees "Schedule is Paused" on wake.
        if (state.isPaused && isPauseReminderShowing()) {
          logger.info('Main', 'System resume while paused with pause reminder - restoring pause overlay');
          const pausedAt = state.pausedAt ?? Date.now();
          showOverlay(false); // Non-strict
          const overlay = getOverlayWindow();
          if (overlay && !overlay.isDestroyed()) {
            const sendPause = () => sendToAll(IPC_CHANNELS.SHOW_PAUSE_REMINDER, { 
              pausedForMs: Date.now() - pausedAt, 
              pausedAt 
            });
            // Send immediately AND after load to win the race
            sendPause();
            if (overlay.webContents.isLoading()) {
              overlay.webContents.once('did-finish-load', sendPause);
            }
          }
          return; // Don't run normal overlay recovery — pause reminder takes priority
        }
        
        if (policy.showOverlay || restBlockActive) {
          const overlay = getOverlayWindow();
          if (!overlay || overlay.isDestroyed()) {
            logger.warn('Main', 'Overlay missing after system resume - recreating', { currentPhase });
            const recovered = recoverOverlayIfNeeded(policy.strictMode, true);
            if (recovered) {
              if (restBlockActive) {
                const restState = getRestBlockService().getState();
                sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: 'rest-block', restBlock: restState });
                sendToAll(IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
                sendOverlayResyncSnapshot('system-resume-recovery');
              } else {
                sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: currentPhase });
              }
            }
          } else {
            // Overlay exists - re-assert and resync in case renderer was throttled during suspend
            logger.info('Main', 'Overlay exists after resume - re-asserting and resyncing');
            try {
              overlay.setAlwaysOnTop(true, 'screen-saver');
              overlay.setFullScreen(true);
              overlay.show();
              overlay.focus();
            } catch (e) {
              logger.error('Main', 'Failed to re-assert overlay after resume - recreating', { error: String(e) });
              recoverOverlayIfNeeded(policy.strictMode, true);
            }
            
            // Send fresh state to overlay
            if (restBlockActive) {
              const restState = getRestBlockService().getState();
              sendToAll(IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
            }
            // Always resync - critical for transitions that expired during suspend
            sendOverlayResyncSnapshot('system-resume-resync');
          }
        }
      }, 3000); // 3s delay for system to fully wake
    });

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
  const restBlockActive = getRestBlockService().isActive();
  
  // Use centralized overlay policy
  const policy = getOverlayPolicyForState(currentPhase);
  
  // If paused with pause reminder showing but overlay is gone, recreate it
  if (state.isPaused && isPauseReminderShowing()) {
    const overlay = getOverlayWindow();
    if (!overlay || overlay.isDestroyed()) {
      logger.warn('Main', 'Pause reminder overlay missing - recreating');
      const pausedAt = state.pausedAt ?? Date.now();
      showOverlay(false);
      const newOverlay = getOverlayWindow();
      if (newOverlay && !newOverlay.isDestroyed()) {
        const sendPause = () => sendToAll(IPC_CHANNELS.SHOW_PAUSE_REMINDER, { 
          pausedForMs: Date.now() - pausedAt, pausedAt 
        });
        sendPause();
        if (newOverlay.webContents.isLoading()) {
          newOverlay.webContents.once('did-finish-load', sendPause);
        }
      }
    }
    return; // Don't run normal overlay check when pause reminder is active
  }
  
  // Check if overlay should be showing (for normal phases or rest blocks)
  if (policy.showOverlay || restBlockActive) {
    const overlay = getOverlayWindow();
    if (!overlay || overlay.isDestroyed()) {
      logger.warn('Main', 'Overlay should be visible but is not - reopening', { phase: currentPhase, restBlockActive });
      const strictMode = restBlockActive ? getRestBlockService().getState().isStrictMode : policy.strictMode;
      showOverlay(strictMode);
    } else {
      // Window exists — check if renderer has crashed (zombie window)
      try {
        if (overlay.webContents.isCrashed()) {
          logger.error('Main', 'Overlay renderer crashed (zombie window) - recreating', { phase: currentPhase });
          const strictMode = restBlockActive ? getRestBlockService().getState().isStrictMode : policy.strictMode;
          recoverOverlayIfNeeded(strictMode, true);
        }
      } catch {
        // webContents access failed — window is in a bad state
        logger.error('Main', 'Overlay webContents inaccessible - recreating');
        const strictMode = restBlockActive ? getRestBlockService().getState().isStrictMode : policy.strictMode;
        recoverOverlayIfNeeded(strictMode, true);
      }
    }
  } else {
    // CRITICAL FIX: Overlay should NOT be showing — close any stale/orphan overlay.
    // This prevents blank frozen overlays after system suspend/resume, Chromium crashes,
    // or race conditions where the overlay was opened but never properly closed.
    const overlay = getOverlayWindow();
    if (overlay && !overlay.isDestroyed()) {
      const waterActive = timerEngine.isWaterReminderActive();
      // Only close if no water reminder is active (water reminder uses non-strict overlay)
      if (!waterActive && !isPauseReminderShowing()) {
        logger.warn('Main', 'Stale overlay detected - closing (no policy requires it)', {
          phase: currentPhase,
          isPaused: state.isPaused,
          restBlockActive,
        });
        safeCloseOverlay();
      }
    }
  }
}

// Start the app
initialize();

// Periodic overlay health check (every 2 seconds)
setInterval(ensureOverlayIfRequired, 2000);
