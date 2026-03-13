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
        // Initialize and start timer engine
        const timerEngine = (0, timerEngine_1.getTimerEngine)();
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
            // Report tick to watchdog for stall detection
            timerWatchdog.reportTick(tick.phaseRemainingMs);
            // Send tick to all renderer windows
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.TIMER_TICK, tick);
            // Update tray
            (0, tray_1.updateTrayWithTick)(tick);
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
            const prevPolicy = getOverlayPolicyForState(data.prevPhase);
            // Check if RestBlock is active - don't interfere with its overlay
            const restBlockService = (0, restBlockService_1.getRestBlockService)();
            const isRestBlockActive = restBlockService.isActive();
            if (newPolicy.showOverlay) {
                (0, windowManager_1.showOverlay)(newPolicy.strictMode);
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: data.newPhase });
                // NOTE: OverlayWatchdog disabled for regular overlays - it was causing
                // infinite reload loops because it expects heartbeats but doesn't send
                // heartbeat requests. The OverlaySyncService handles rest block monitoring.
            }
            else if (prevPolicy.showOverlay && !isRestBlockActive) {
                // Close overlay when leaving a phase that required it
                // BUT only if no RestBlock is active (RestBlock takes priority)
                (0, windowManager_1.closeOverlay)();
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.HIDE_OVERLAY, {});
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
                (0, windowManager_1.closeOverlay)();
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.HIDE_OVERLAY, {});
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
                (0, windowManager_1.closeOverlay)();
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.HIDE_OVERLAY, {});
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
                (0, windowManager_1.closeOverlay)();
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.HIDE_OVERLAY, {});
            }
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, officeFocusLockService.getState());
        });
        // Initialize Rest Block service and handle its events
        const restBlockService = (0, restBlockService_1.getRestBlockService)();
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
            // Start overlay sync watchdog for rest blocks
            const overlaySyncService = (0, overlaySync_1.getOverlaySyncService)();
            overlaySyncService.start(() => (0, windowManager_1.sendToOverlay)(overlaySync_1.OVERLAY_SYNC_CHANNELS.HEARTBEAT_REQUEST, {}), () => (0, windowManager_1.recoverOverlayIfNeeded)(restState.isStrictMode));
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
        });
        restBlockService.on('stopped', () => {
            (0, soundService_1.playSound)('rest_block_end');
            // When Rest Block stops, resume timer and check if overlay should close
            logger_1.default.info('Main', 'Rest block stopped - resuming timer');
            (0, overlayDebug_1.logRestBlockEnd)('manual', 'user stopped');
            // Stop overlay sync watchdog
            (0, overlaySync_1.getOverlaySyncService)().stop();
            timerEngine.resume();
            const currentPhase = timerEngine.getState().currentPhase;
            const policy = getOverlayPolicyForState(currentPhase);
            if (!policy.showOverlay) {
                (0, windowManager_1.closeOverlay)();
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.HIDE_OVERLAY, {});
            }
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.REST_BLOCK_CHANGED, restBlockService.getState());
        });
        restBlockService.on('expired', () => {
            (0, soundService_1.playSound)('rest_block_end');
            // Rest Block timer expired - resume timer and check overlay
            logger_1.default.info('Main', 'Rest block expired - resuming timer');
            (0, overlayDebug_1.logRestBlockEnd)('expired', 'timer completed');
            // Stop overlay sync watchdog
            (0, overlaySync_1.getOverlaySyncService)().stop();
            timerEngine.resume();
            const currentPhase = timerEngine.getState().currentPhase;
            const policy = getOverlayPolicyForState(currentPhase);
            if (!policy.showOverlay) {
                (0, windowManager_1.closeOverlay)();
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.HIDE_OVERLAY, {});
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
                    const recovered = (0, windowManager_1.recoverOverlayIfNeeded)(restState.isStrictMode);
                    if (recovered) {
                        // Send current state to the new overlay
                        (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
                        (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: 'rest-block', restBlock: restState });
                    }
                }
            }
        }, 10000); // Check every 10 seconds
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
    // Use centralized overlay policy
    const policy = getOverlayPolicyForState(currentPhase);
    // Check if overlay should be showing
    if (policy.showOverlay) {
        const overlay = (0, windowManager_1.getOverlayWindow)();
        if (!overlay || overlay.isDestroyed()) {
            logger_1.default.warn('Main', 'Overlay should be visible but is not - reopening', { phase: currentPhase });
            (0, windowManager_1.showOverlay)(policy.strictMode);
        }
    }
}
// Start the app
initialize();
// Periodic overlay health check (every 2 seconds)
setInterval(ensureOverlayIfRequired, 2000);
//# sourceMappingURL=main.js.map