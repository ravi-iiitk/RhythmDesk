"use strict";
/**
 * RhythmDesk Main Process
 * Entry point for the Electron application
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
const types_1 = require("../shared/types");
const configService_1 = __importDefault(require("../core/configService"));
const defaultSchedules_1 = require("./defaultSchedules");
/**
 * Check if a phase is a work phase (sit or stand)
 */
function isWorkPhase(phase) {
    return phase === 'sit' || phase === 'stand';
}
/**
 * Check if a phase is a break/transition phase (always requires overlay)
 */
function isBreakOrTransitionPhase(phase) {
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
function shouldShowOverlayForPhase(phase) {
    // Breaks and transitions always require overlay
    if (isBreakOrTransitionPhase(phase)) {
        return true;
    }
    // Work phases only require overlay if Office Focus Lock is active
    if (isWorkPhase(phase)) {
        const officeFocusLockService = (0, officeFocusLockService_1.getOfficeFocusLockService)();
        return officeFocusLockService.isActive();
    }
    return false;
}
function initialize() {
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
        const timerEngine = (0, timerEngine_1.getTimerEngine)();
        timerEngine.stop();
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
        // Handle timer events
        timerEngine.on('tick', (tick) => {
            // Send tick to all renderer windows
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.TIMER_TICK, tick);
            // Update tray
            (0, tray_1.updateTrayWithTick)(tick);
        });
        timerEngine.on('phaseChange', (data) => {
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.PHASE_CHANGE, data);
            // Determine if overlay should be shown based on phase and Focus Mode
            const shouldShowOverlay = shouldShowOverlayForPhase(data.newPhase);
            const wasShowingOverlay = shouldShowOverlayForPhase(data.prevPhase);
            if (shouldShowOverlay) {
                const schedule = timerEngine.getCurrentSchedule();
                const strictMode = schedule?.strictModeEnabled || false;
                (0, windowManager_1.showOverlay)(strictMode);
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: data.newPhase });
            }
            else if (wasShowingOverlay) {
                // Close overlay when leaving a phase that required it
                (0, windowManager_1.closeOverlay)();
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.HIDE_OVERLAY, {});
            }
        });
        timerEngine.on('scheduleChange', (_schedule) => {
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.CONFIG_UPDATED, configService_1.default.getConfig());
        });
        // Handle postpone - close overlay when user postpones
        timerEngine.on('postponed', () => {
            (0, windowManager_1.closeOverlay)();
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.HIDE_OVERLAY, {});
        });
        // Initialize Office Focus Lock service and handle its events
        const officeFocusLockService = (0, officeFocusLockService_1.getOfficeFocusLockService)();
        officeFocusLockService.on('started', () => {
            // When Office Focus Lock starts, show overlay if in work phase
            const currentPhase = timerEngine.getState().currentPhase;
            if (isWorkPhase(currentPhase)) {
                const schedule = timerEngine.getCurrentSchedule();
                const strictMode = schedule?.strictModeEnabled || false;
                (0, windowManager_1.showOverlay)(strictMode);
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: currentPhase });
            }
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, officeFocusLockService.getState());
        });
        officeFocusLockService.on('stopped', () => {
            // When Office Focus Lock stops, close overlay if in work phase
            const currentPhase = timerEngine.getState().currentPhase;
            if (isWorkPhase(currentPhase)) {
                (0, windowManager_1.closeOverlay)();
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.HIDE_OVERLAY, {});
            }
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, officeFocusLockService.getState());
        });
        officeFocusLockService.on('expired', () => {
            // Office Focus Lock timer expired - same as stopped
            const currentPhase = timerEngine.getState().currentPhase;
            if (isWorkPhase(currentPhase)) {
                (0, windowManager_1.closeOverlay)();
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.HIDE_OVERLAY, {});
            }
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, officeFocusLockService.getState());
        });
        // Start the timer
        timerEngine.start();
        // Handle app activation (macOS specific, but doesn't hurt on Linux)
        electron_1.app.on('activate', () => {
            if (electron_1.BrowserWindow.getAllWindows().length === 0) {
                (0, windowManager_1.createMainWindow)();
            }
        });
    });
}
// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger_1.default.error('Main', 'Uncaught exception', { message: error.message, stack: error.stack });
    console.error('Uncaught exception:', error);
});
process.on('unhandledRejection', (reason, promise) => {
    logger_1.default.error('Main', 'Unhandled rejection', { reason });
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
/**
 * Ensure overlay is shown when required
 * Called periodically to auto-reopen accidentally closed overlays
 */
function ensureOverlayIfRequired() {
    const timerEngine = (0, timerEngine_1.getTimerEngine)();
    const state = timerEngine.getState();
    const currentPhase = state.currentPhase;
    // Skip if paused or postponed
    if (state.isPaused || state.isPostponed)
        return;
    // Check if overlay should be showing
    if (shouldShowOverlayForPhase(currentPhase)) {
        const overlay = (0, windowManager_1.getOverlayWindow)();
        if (!overlay || overlay.isDestroyed()) {
            logger_1.default.warn('Main', 'Overlay should be visible but is not - reopening', { phase: currentPhase });
            const schedule = timerEngine.getCurrentSchedule();
            const strictMode = schedule?.strictModeEnabled || false;
            (0, windowManager_1.showOverlay)(strictMode);
        }
    }
}
// Start the app
initialize();
// Periodic overlay health check (every 2 seconds)
setInterval(ensureOverlayIfRequired, 2000);
//# sourceMappingURL=main.js.map