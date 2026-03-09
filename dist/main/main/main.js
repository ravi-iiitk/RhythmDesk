"use strict";
/**
 * PostureGuard Main Process
 * Entry point for the Electron application
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const windowManager_1 = require("./windowManager");
const tray_1 = require("./tray");
const ipc_1 = require("./ipc");
const timerEngine_1 = require("../core/timerEngine");
const types_1 = require("../shared/types");
const configService_1 = __importDefault(require("../core/configService"));
const defaultSchedules_1 = require("./defaultSchedules");
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
            // Show overlay for transitions and breaks
            const phasesRequiringOverlay = [
                'sit-to-stand-transition',
                'stand-to-sit-transition',
                'short-break',
                'long-break',
            ];
            if (phasesRequiringOverlay.includes(data.newPhase)) {
                const schedule = timerEngine.getCurrentSchedule();
                const strictMode = schedule?.strictModeEnabled || false;
                (0, windowManager_1.showOverlay)(strictMode);
                (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.SHOW_OVERLAY, { phase: data.newPhase });
            }
        });
        timerEngine.on('scheduleChange', (_schedule) => {
            (0, windowManager_1.sendToAll)(types_1.IPC_CHANNELS.CONFIG_UPDATED, configService_1.default.getConfig());
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
    console.error('Uncaught exception:', error);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
// Start the app
initialize();
//# sourceMappingURL=main.js.map