"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const windowManager_1 = require("./windowManager");
const logger_1 = __importDefault(require("../core/logger"));
const tray_1 = require("./tray");
const ipc_1 = require("./ipc");
const timerEngine_1 = require("../core/timerEngine");
const officeFocusLockService_1 = require("../core/officeFocusLockService");
const restBlockService_1 = require("../core/restBlockService");
const types_1 = require("../shared/types");
const configService_1 = __importDefault(require("../core/configService"));
const defaultSchedules_1 = require("./defaultSchedules");
const overlayPolicy_1 = require("../core/overlayPolicy");
const overlayDebug_1 = require("../core/overlayDebug");
const overlaySync_1 = require("../core/overlaySync");
// Phase 5: Production hardening imports
const errorHandler_1 = require("../core/errorHandler");
const shutdown_1 = require("../core/shutdown");
const healthMonitor_1 = require("../core/healthMonitor");
const watchdog_1 = require("../core/watchdog");
const debugMode_1 = require("../core/debugMode");
// Sound service
const soundService_1 = require("../core/soundService");
/**
 * Get overlay policy for current state
 * Centralized decision engine - all overlay logic goes through here
 */
/**
 * Safely close the overlay AND stop the heartbeat watchdog.
 * Every overlay-close path must use this to prevent the watchdog from
 * detecting "missed heartbeats" on a closed overlay and recreating it.
 */
function safeCloseOverlay() {
    const syncService = (0, overlaySync_1.getOverlaySyncService)();
    if (syncService.getState().isOverlayActive) {
        syncService.stop();
    }
    (0, windowManager_1.closeOverlay)();
    (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.HIDE_OVERLAY, {});
}
function getOverlayPolicyForState(phase) {
    const timerEngine = (0, timerEngine_1.getTimerEngine)();
    const officeFocusLockService = (0, officeFocusLockService_1.getOfficeFocusLockService)();
    const schedule = timerEngine.getCurrentSchedule();
    const state = timerEngine.getState();
    const input = {
        phase,
        schedule,
        focusLockActive: officeFocusLockService.isActive(),
        focusLockState: officeFocusLockService.getState(),
        isPaused: state.isPaused,
        isPostponed: state.isPostponed,
        isWaitingForNextActivity: state.isWaitingForNextActivity,
    };
    return (0, overlayPolicy_1.getOverlayPolicy)(input);
}
function initialize() {
    // ========================================
    // PHASE 5: Early initialization (before app ready)
    // ========================================
    // Setup global error handlers FIRST
    (0, errorHandler_1.setupMainProcessErrorHandlers)();
    // Initialize debug mode from environment
    (0, debugMode_1.initDebugMode)();
    // Install shutdown handlers for graceful exit
    (0, shutdown_1.installShutdownHandlers)();
    logger_1.default.info('Main', 'Phase 5 production hardening initialized');
    // Prevent multiple instances
    const gotTheLock = electron_1.app.requestSingleInstanceLock();
    if (!gotTheLock) {
        electron_1.app.quit();
        return;
    }
    electron_1.app.on('second-instance', () => {
        const win = (0, windowManager_1.getMainWindow)();
        if (win) {
            if (win.isMinimized())
                win.restore();
            win.focus();
        }
    });
    // Prevent app from quitting when all windows are closed (tray app behavior)
    electron_1.app.on('window-all-closed', () => {
        // Don't quit - keep running in tray
    });
    // Clean up on quit
    electron_1.app.on('before-quit', () => {
        logger_1.default.info('Main', 'App quitting - flushing session snapshot');
        const timerEngine = (0, timerEngine_1.getTimerEngine)();
        timerEngine.stop();
        // Flush any pending session snapshot before quit
        configService_1.default.flushSessionSnapshot();
    });
    // App ready
    electron_1.app.whenReady().then(() => {
        // Initialize default schedules if none exist
        const schedules = configService_1.default.getSchedules();
        if (schedules.length === 0) {
            (0, defaultSchedules_1.createDefaultSchedules)();
        }
        // Register IPC handlers
        (0, ipc_1.registerIpcHandlers)();
        // Create tray first (app stays running even when window is closed)
        (0, tray_1.createTray)();
        // Create main window
        (0, windowManager_1.createMainWindow)();
        // Start main window health check watchdog
        // This detects zombie states after system suspend/resume
        (0, windowManager_1.startMainWindowHealthCheck)();
        logger_1.default.info('Main', 'Main window health check watchdog started');
        // Initialize and start timer engine
        const timerEngine = (0, timerEngine_1.getTimerEngine)();
        let lastTimerTick = null;
        let lastOverlayUpdateSentAt = 0;
        const sendOverlayResyncSnapshot = (reason) => {
            const restState = (0, restBlockService_1.getRestBlockService)().getState();
            const tick = timerEngine.getLastEmittedTick() || lastTimerTick;
            (0, windowManager_1.sendToOverlay)(overlaySync_1.OVERLAY_SYNC_CHANNELS.RESYNC_DATA, {
                requestedAt: Date.now(),
                tick,
                restBlock: restState,
                overlayStateVersion: restState.startedAt ?? Date.now(),
                reason,
            });
            logger_1.default.info('Main', 'Overlay state resent', {
                reason,
                hasTick: !!tick,
                restBlockActive: restState.isActive,
                restRemainingMs: restState.remainingMs,
            });
        };
        // ========================================
        // PHASE 5: Start watchdogs and health monitor
        // ========================================
        const timerWatchdog = (0, watchdog_1.getTimerWatchdog)();
        const healthMonitor = (0, healthMonitor_1.getHealthMonitor)();
        timerWatchdog.start();
        healthMonitor.start();
        // NOTE: OverlayWatchdog is NOT started here - it was causing infinite reload
        // loops. The OverlaySyncService handles rest block overlay monitoring instead.
        logger_1.default.info('Main', 'Watchdogs and health monitor started');
        // Handle timer events
        timerEngine.on('tick', (tick) => {
            lastTimerTick = tick;
            // Report tick to watchdog for stall detection
            timerWatchdog.reportTick(tick.phaseRemainingMs);
            // Send tick to all renderer windows
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.TIMER_TICK, tick);
            // Update tray
            (0, tray_1.updateTrayWithTick)(tick);
            logger_1.default.debug('Main', 'Authoritative timer tick broadcast', {
                phase: tick.currentPhase,
                phaseRemainingMs: tick.phaseRemainingMs,
            });
        });
        timerEngine.on('phaseChange', (data) => {
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.PHASE_CHANGE, data);
            // Play appropriate sound for the phase change
            if (data.newPhase === 'short-break' || data.newPhase === 'long-break') {
                (0, soundService_1.playSound)('break_start');
            }
            else if (data.newPhase === 'sit-to-stand-transition' || data.newPhase === 'stand-to-sit-transition') {
                (0, soundService_1.playSound)('transition_start');
            }
            else if ((data.prevPhase === 'short-break' || data.prevPhase === 'long-break') &&
                (data.newPhase === 'sit' || data.newPhase === 'stand')) {
                (0, soundService_1.playSound)('break_end');
            }
            // Use centralized overlay policy for decisions
            const newPolicy = getOverlayPolicyForState(data.newPhase);
            // Check if RestBlock is active - don't interfere with its overlay
            const restBlockService = (0, restBlockService_1.getRestBlockService)();
            const isRestBlockActive = restBlockService.isActive();
            if (newPolicy.showOverlay) {
                (0, windowManager_1.showOverlay)(newPolicy.strictMode);
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: data.newPhase });
                // Start overlay heartbeat watchdog for ALL overlay phases (breaks, transitions)
                // This detects frozen overlays during long breaks when screensaver/screen-lock
                // throttles the renderer process. Only start if not already running for a rest block.
                if (!isRestBlockActive && !overlaySyncService.getState().isOverlayActive) {
                    overlaySyncService.start(() => (0, windowManager_1.sendToOverlay)(overlaySync_1.OVERLAY_SYNC_CHANNELS.HEARTBEAT_REQUEST, {}), () => {
                        // CRITICAL: Use CURRENT state, not stale closure values.
                        // Recovery can fire long after the phaseChange event (e.g., after
                        // postpone changed the phase). Using stale values would recreate
                        // an overlay for the wrong phase.
                        const currentPhase = timerEngine.getState().currentPhase;
                        const currentPolicy = getOverlayPolicyForState(currentPhase);
                        if (!currentPolicy.showOverlay) {
                            // Phase no longer needs overlay (e.g., user postponed) — just stop
                            logger_1.default.info('Main', 'Heartbeat recovery skipped — overlay no longer needed', { currentPhase });
                            overlaySyncService.stop();
                            return;
                        }
                        const recovered = (0, windowManager_1.recoverOverlayIfNeeded)(currentPolicy.strictMode, true);
                        if (recovered) {
                            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: currentPhase });
                            logger_1.default.warn('Main', 'Overlay recovered via heartbeat watchdog during phase', {
                                phase: currentPhase,
                            });
                        }
                    });
                }
            }
            else if (!isRestBlockActive) {
                // Close overlay if it's open and new policy doesn't require it.
                // This handles: transition→waiting (overlay was shown for transition,
                // must close), and normal phase→work transitions.
                const overlay = (0, windowManager_1.getOverlayWindow)();
                if (overlay && !overlay.isDestroyed()) {
                    safeCloseOverlay();
                }
            }
        });
        timerEngine.on('scheduleChange', (_schedule) => {
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.CONFIG_UPDATED, configService_1.default.getConfig());
        });
        // Handle postpone - close overlay when user postpones
        timerEngine.on('postponed', () => {
            (0, soundService_1.playSound)('postpone');
            // Don't close overlay if RestBlock is active
            const restBlockService = (0, restBlockService_1.getRestBlockService)();
            if (!restBlockService.isActive()) {
                safeCloseOverlay();
            }
        });
        // Handle session reset
        timerEngine.on('sessionReset', () => {
            (0, soundService_1.playSound)('session_reset');
        });
        // Initialize Office Focus Lock service and handle its events
        const officeFocusLockService = (0, officeFocusLockService_1.getOfficeFocusLockService)();
        officeFocusLockService.on('started', () => {
            (0, soundService_1.playSound)('focus_lock_start');
            // When Office Focus Lock starts, use centralized policy to determine overlay
            const currentPhase = timerEngine.getState().currentPhase;
            const policy = getOverlayPolicyForState(currentPhase);
            if (policy.showOverlay) {
                (0, windowManager_1.showOverlay)(policy.strictMode);
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: currentPhase });
            }
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, officeFocusLockService.getState());
        });
        officeFocusLockService.on('stopped', () => {
            (0, soundService_1.playSound)('focus_lock_end');
            // When Office Focus Lock stops, use centralized policy to determine if overlay should close
            const currentPhase = timerEngine.getState().currentPhase;
            const policy = getOverlayPolicyForState(currentPhase);
            const restBlockService = (0, restBlockService_1.getRestBlockService)();
            // Close overlay if policy says no overlay needed AND no RestBlock is active
            if (!policy.showOverlay && !restBlockService.isActive()) {
                safeCloseOverlay();
            }
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, officeFocusLockService.getState());
        });
        officeFocusLockService.on('expired', () => {
            (0, soundService_1.playSound)('focus_lock_end');
            // Office Focus Lock timer expired - same logic as stopped
            const currentPhase = timerEngine.getState().currentPhase;
            const policy = getOverlayPolicyForState(currentPhase);
            const restBlockService = (0, restBlockService_1.getRestBlockService)();
            if (!policy.showOverlay && !restBlockService.isActive()) {
                safeCloseOverlay();
            }
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, officeFocusLockService.getState());
        });
        // Initialize Rest Block service and handle its events
        const restBlockService = (0, restBlockService_1.getRestBlockService)();
        const overlaySyncService = (0, overlaySync_1.getOverlaySyncService)();
        overlaySyncService.on('heartbeat-missed', (missedCount) => {
            logger_1.default.warn('Main', 'Overlay heartbeat missed during rest block', {
                missedCount,
                restBlockActive: restBlockService.isActive(),
            });
        });
        overlaySyncService.on('overlay-stale', () => {
            logger_1.default.error('Main', 'Overlay marked stale by heartbeat watchdog');
        });
        overlaySyncService.on('overlay-recovered', () => {
            logger_1.default.info('Main', 'Overlay recovered after stale detection');
            sendOverlayResyncSnapshot('overlay-recovered');
        });
        restBlockService.on('started', () => {
            (0, soundService_1.playSound)('rest_block_start');
            // When Rest Block starts, pause the normal timer flow and show overlay
            logger_1.default.info('Main', 'Rest block started - pausing timer and showing overlay');
            const restState = restBlockService.getState();
            (0, overlayDebug_1.logRestBlockStart)(restState.name, restState.durationMs, restState.isStrictMode);
            timerEngine.pause();
            (0, windowManager_1.showOverlay)(restState.isStrictMode);
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: 'rest-block', restBlock: restState });
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
            sendOverlayResyncSnapshot('rest-block-start');
            lastOverlayUpdateSentAt = Date.now();
            // Start overlay sync watchdog for rest blocks
            overlaySyncService.start(() => (0, windowManager_1.sendToOverlay)(overlaySync_1.OVERLAY_SYNC_CHANNELS.HEARTBEAT_REQUEST, {}), () => {
                const recovered = (0, windowManager_1.recoverOverlayIfNeeded)(restState.isStrictMode, true);
                if (recovered) {
                    const currentRestState = restBlockService.getState();
                    (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: 'rest-block', restBlock: currentRestState });
                    (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.REST_BLOCK_CHANGED, currentRestState);
                    sendOverlayResyncSnapshot('heartbeat-recovery');
                    logger_1.default.warn('Main', 'Overlay recovered after missed heartbeats', {
                        restBlockName: currentRestState.name,
                        remainingMs: currentRestState.remainingMs,
                    });
                }
            });
        });
        // CRITICAL: Handle RestBlockService tick events to keep overlay updated
        // This is essential for long rest blocks - without this, the overlay freezes
        restBlockService.on('tick', (restState) => {
            // Log every 10th tick to reduce noise (tick every second)
            if (restState.remainingMs % 10000 < 1000) {
                (0, overlayDebug_1.logRestBlockTick)(restState.name, restState.remainingMs);
            }
            // Send rest block state to overlay on every tick
            // This ensures the overlay countdown stays in sync for long durations
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
            lastOverlayUpdateSentAt = Date.now();
            logger_1.default.debug('Main', 'Rest block overlay update sent', {
                remainingMs: restState.remainingMs,
                lastOverlayUpdateSentAt,
            });
        });
        restBlockService.on('stopped', () => {
            (0, soundService_1.playSound)('rest_block_end');
            // When Rest Block stops, resume timer and check if overlay should close
            logger_1.default.info('Main', 'Rest block stopped - resuming timer');
            (0, overlayDebug_1.logRestBlockEnd)('manual', 'user stopped');
            timerEngine.resume();
            const currentPhase = timerEngine.getState().currentPhase;
            const policy = getOverlayPolicyForState(currentPhase);
            if (!policy.showOverlay) {
                safeCloseOverlay();
            }
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.REST_BLOCK_CHANGED, restBlockService.getState());
        });
        restBlockService.on('expired', () => {
            (0, soundService_1.playSound)('rest_block_end');
            // Rest Block timer expired - resume timer and check overlay
            logger_1.default.info('Main', 'Rest block expired - resuming timer');
            (0, overlayDebug_1.logRestBlockEnd)('expired', 'timer completed');
            timerEngine.resume();
            const currentPhase = timerEngine.getState().currentPhase;
            const policy = getOverlayPolicyForState(currentPhase);
            if (!policy.showOverlay) {
                safeCloseOverlay();
            }
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.REST_BLOCK_CHANGED, restBlockService.getState());
        });
        // Start the timer
        timerEngine.start();
        // WATCHDOG: Periodically check overlay health during rest blocks
        // This ensures long rest blocks don't get stuck due to overlay issues
        setInterval(() => {
            const restBlockService = (0, restBlockService_1.getRestBlockService)();
            if (restBlockService.isActive()) {
                const restState = restBlockService.getState();
                const overlayWindow = (0, windowManager_1.getOverlayWindow)();
                // If rest block is active but overlay is not healthy, recover it
                if (!overlayWindow || overlayWindow.isDestroyed()) {
                    logger_1.default.warn('Main', 'Watchdog: Rest block active but overlay missing - recovering');
                    const recovered = (0, windowManager_1.recoverOverlayIfNeeded)(restState.isStrictMode, true);
                    if (recovered) {
                        // Send current state to the new overlay
                        (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
                        (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: 'rest-block', restBlock: restState });
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
        electron_1.powerMonitor.on('lock-screen', () => {
            (0, windowManager_1.setScreenLocked)(true);
            logger_1.default.info('Main', 'Screen locked - overlay renderer may be throttled');
        });
        electron_1.powerMonitor.on('unlock-screen', () => {
            (0, windowManager_1.setScreenLocked)(false);
            logger_1.default.info('Main', 'Screen unlocked - checking overlay health');
            // Delay recovery slightly to let the display compositor settle
            setTimeout(() => {
                const currentPhase = timerEngine.getState().currentPhase;
                const policy = getOverlayPolicyForState(currentPhase);
                const restBlockActive = (0, restBlockService_1.getRestBlockService)().isActive();
                if (policy.showOverlay || restBlockActive) {
                    const overlay = (0, windowManager_1.getOverlayWindow)();
                    if (!overlay || overlay.isDestroyed()) {
                        // Overlay window was destroyed during lock - recreate
                        logger_1.default.warn('Main', 'Overlay missing after screen unlock - recreating', { currentPhase });
                        const recovered = (0, windowManager_1.recoverOverlayIfNeeded)(policy.strictMode, true);
                        if (recovered) {
                            if (restBlockActive) {
                                const restState = (0, restBlockService_1.getRestBlockService)().getState();
                                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: 'rest-block', restBlock: restState });
                                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
                                sendOverlayResyncSnapshot('screen-unlock-recovery');
                            }
                            else {
                                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: currentPhase });
                            }
                        }
                    }
                    else {
                        // Overlay window exists - force reload content in case renderer was frozen
                        // The 'responsive' event handler may not fire reliably on all Linux WMs
                        logger_1.default.info('Main', 'Overlay exists after unlock - re-asserting and resyncing');
                        try {
                            overlay.setAlwaysOnTop(true, 'screen-saver');
                            overlay.setFullScreen(true);
                            overlay.show();
                            overlay.focus();
                        }
                        catch (e) {
                            logger_1.default.error('Main', 'Failed to re-assert overlay after unlock - recreating', { error: String(e) });
                            (0, windowManager_1.recoverOverlayIfNeeded)(policy.strictMode, true);
                        }
                        // Send fresh state to overlay in case it was stale
                        if (restBlockActive) {
                            const restState = (0, restBlockService_1.getRestBlockService)().getState();
                            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
                            sendOverlayResyncSnapshot('screen-unlock-resync');
                        }
                    }
                }
            }, 1500); // 1.5s delay for compositor to settle
        });
        // Also handle system resume (suspend/hibernate)
        electron_1.powerMonitor.on('resume', () => {
            logger_1.default.info('Main', 'System resumed from suspend - checking overlay');
            // Same recovery logic as unlock, but with longer delay for system wake
            setTimeout(() => {
                const currentPhase = timerEngine.getState().currentPhase;
                const policy = getOverlayPolicyForState(currentPhase);
                const restBlockActive = (0, restBlockService_1.getRestBlockService)().isActive();
                if (policy.showOverlay || restBlockActive) {
                    const overlay = (0, windowManager_1.getOverlayWindow)();
                    if (!overlay || overlay.isDestroyed()) {
                        logger_1.default.warn('Main', 'Overlay missing after system resume - recreating', { currentPhase });
                        const recovered = (0, windowManager_1.recoverOverlayIfNeeded)(policy.strictMode, true);
                        if (recovered) {
                            if (restBlockActive) {
                                const restState = (0, restBlockService_1.getRestBlockService)().getState();
                                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: 'rest-block', restBlock: restState });
                                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
                                sendOverlayResyncSnapshot('system-resume-recovery');
                            }
                            else {
                                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: currentPhase });
                            }
                        }
                    }
                }
            }, 3000); // 3s delay for system to fully wake
        });
        // Handle app activation (macOS specific, but doesn't hurt on Linux)
        electron_1.app.on('activate', () => {
            if (electron_1.BrowserWindow.getAllWindows().length === 0) {
                (0, windowManager_1.createMainWindow)();
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
function ensureOverlayIfRequired() {
    const timerEngine = (0, timerEngine_1.getTimerEngine)();
    const state = timerEngine.getState();
    const currentPhase = state.currentPhase;
    const restBlockActive = (0, restBlockService_1.getRestBlockService)().isActive();
    // Use centralized overlay policy
    const policy = getOverlayPolicyForState(currentPhase);
    // Check if overlay should be showing (for normal phases or rest blocks)
    if (policy.showOverlay || restBlockActive) {
        const overlay = (0, windowManager_1.getOverlayWindow)();
        if (!overlay || overlay.isDestroyed()) {
            logger_1.default.warn('Main', 'Overlay should be visible but is not - reopening', { phase: currentPhase, restBlockActive });
            const strictMode = restBlockActive ? (0, restBlockService_1.getRestBlockService)().getState().isStrictMode : policy.strictMode;
            (0, windowManager_1.showOverlay)(strictMode);
        }
        else {
            // Window exists — check if renderer has crashed (zombie window)
            try {
                if (overlay.webContents.isCrashed()) {
                    logger_1.default.error('Main', 'Overlay renderer crashed (zombie window) - recreating', { phase: currentPhase });
                    const strictMode = restBlockActive ? (0, restBlockService_1.getRestBlockService)().getState().isStrictMode : policy.strictMode;
                    (0, windowManager_1.recoverOverlayIfNeeded)(strictMode, true);
                }
            }
            catch {
                // webContents access failed — window is in a bad state
                logger_1.default.error('Main', 'Overlay webContents inaccessible - recreating');
                const strictMode = restBlockActive ? (0, restBlockService_1.getRestBlockService)().getState().isStrictMode : policy.strictMode;
                (0, windowManager_1.recoverOverlayIfNeeded)(strictMode, true);
            }
        }
    }
}
// Start the app
initialize();
// Periodic overlay health check (every 2 seconds)
setInterval(ensureOverlayIfRequired, 2000);
//# sourceMappingURL=main.js.map