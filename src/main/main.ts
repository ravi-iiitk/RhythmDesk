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

import { app, BrowserWindow, powerMonitor, globalShortcut } from 'electron';
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
// Autostart
import { syncLoginItemWithSettings } from './autostart';

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

  // Clean up on quit
  app.on('before-quit', () => {
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

      sendToOverlay(OVERLAY_SYNC_CHANNELS.RESYNC_DATA, {
        requestedAt: Date.now(),
        tick,
        restBlock: restState,
        overlayStateVersion: restState.startedAt ?? Date.now(),
        reason,
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
    
    // Handle timer events
    timerEngine.on('tick', (tick: TimerTick) => {
      lastTimerTick = tick;
      // Report tick to watchdog for stall detection
      timerWatchdog.reportTick(tick.phaseRemainingMs);
      
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
        showOverlay(newPolicy.strictMode);
        sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: data.newPhase });
        
        // Start overlay heartbeat watchdog for ALL overlay phases (breaks, transitions)
        // This detects frozen overlays during long breaks when screensaver/screen-lock
        // throttles the renderer process. Only start if not already running for a rest block.
        if (!isRestBlockActive && !overlaySyncService.getState().isOverlayActive) {
          overlaySyncService.start(
            () => sendToOverlay(OVERLAY_SYNC_CHANNELS.HEARTBEAT_REQUEST, {}),
            () => {
              // CRITICAL: Use CURRENT state, not stale closure values.
              // Recovery can fire long after the phaseChange event (e.g., after
              // postpone changed the phase). Using stale values would recreate
              // an overlay for the wrong phase.
              const currentPhase = timerEngine.getState().currentPhase;
              const currentPolicy = getOverlayPolicyForState(currentPhase);
              if (!currentPolicy.showOverlay) {
                // Phase no longer needs overlay (e.g., user postponed) — just stop
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
    });

    // Handle pause reminder - show overlay every 5 min when paused
    timerEngine.on('pauseReminder', (data: { pausedForMs: number; pausedAt: number }) => {
      logger.info('Main', 'Showing pause reminder overlay', { pausedForMs: data.pausedForMs });
      showOverlay(false); // Non-strict, dismissible overlay
      // Wait for overlay to fully load before sending the event
      const overlay = getOverlayWindow();
      if (overlay && !overlay.isDestroyed()) {
        const webContents = overlay.webContents;
        const sendEvent = () => {
          sendToAll(IPC_CHANNELS.SHOW_PAUSE_REMINDER, data);
        };
        if (!webContents.isLoading()) {
          sendEvent();
        } else {
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
          safeCloseOverlay();
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
      // Don't auto-pause during rest blocks (user is on a manual break)
      if (!state.isPaused && state.currentPhase !== 'idle' && !restBlockActive) {
        logger.info('Main', 'System idle detected - auto-pausing schedule');
        timerEngine.pause();
        idleAutoPaused = true;
      }
    });

    idleDetector.on('active', () => {
      if (idleAutoPaused) {
        logger.info('Main', 'System activity resumed - auto-resuming schedule');
        timerEngine.resume();
        idleAutoPaused = false;
        // After auto-resume, reopen overlay if current phase needs it (e.g. break)
        const resumedPhase = timerEngine.getState().currentPhase;
        const policy = getOverlayPolicyForState(resumedPhase);
        if (policy.showOverlay) {
          showOverlay(policy.strictMode);
          sendToAll(IPC_CHANNELS.SHOW_OVERLAY, { phase: resumedPhase });
        } else {
          // Close any open overlay (e.g. pause reminder)
          const overlay = getOverlayWindow();
          if (overlay && !overlay.isDestroyed()) {
            safeCloseOverlay();
          }
        }
      }
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
    const overlaySyncService = getOverlaySyncService();

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
      
      timerEngine.resume();
      const currentPhase = timerEngine.getState().currentPhase;
      const policy = getOverlayPolicyForState(currentPhase);
      
      if (!policy.showOverlay) {
        safeCloseOverlay();
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
      // Same recovery logic as unlock, but with longer delay for system wake
      setTimeout(() => {
        const currentPhase = timerEngine.getState().currentPhase;
        const policy = getOverlayPolicyForState(currentPhase);
        const restBlockActive = getRestBlockService().isActive();
        
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
  }
}

// Start the app
initialize();

// Periodic overlay health check (every 2 seconds)
setInterval(ensureOverlayIfRequired, 2000);
