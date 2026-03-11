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
            // Use centralized overlay policy for decisions
            const newPolicy = getOverlayPolicyForState(data.newPhase);
            const prevPolicy = getOverlayPolicyForState(data.prevPhase);
            // Check if RestBlock is active - don't interfere with its overlay
            const restBlockService = (0, restBlockService_1.getRestBlockService)();
            const isRestBlockActive = restBlockService.isActive();
            if (newPolicy.showOverlay) {
                (0, windowManager_1.showOverlay)(newPolicy.strictMode);
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: data.newPhase });
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
            // Don't close overlay if RestBlock is active
            const restBlockService = (0, restBlockService_1.getRestBlockService)();
            if (!restBlockService.isActive()) {
                (0, windowManager_1.closeOverlay)();
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.HIDE_OVERLAY, {});
            }
        });
        // Initialize Office Focus Lock service and handle its events
        const officeFocusLockService = (0, officeFocusLockService_1.getOfficeFocusLockService)();
        officeFocusLockService.on('started', () => {
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
            // When Rest Block starts, pause the normal timer flow and show overlay
            timerEngine.pause();
            const restState = restBlockService.getState();
            (0, windowManager_1.showOverlay)(restState.isStrictMode);
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: 'rest-block', restBlock: restState });
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.REST_BLOCK_CHANGED, restState);
        });
        restBlockService.on('stopped', () => {
            // When Rest Block stops, resume timer and check if overlay should close
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
            // Rest Block timer expired - resume timer and check overlay
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