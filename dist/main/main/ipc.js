"use strict";
/**
 * RhythmDesk IPC Handlers
 * Handles communication between main and renderer processes
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
const types_1 = require("../shared/types");
const configService_1 = __importDefault(require("../core/configService"));
const timerEngine_1 = require("../core/timerEngine");
const officeFocusLockService_1 = require("../core/officeFocusLockService");
const windowManager_1 = require("./windowManager");
const electron_2 = require("electron");
/**
 * Register all IPC handlers
 */
function registerIpcHandlers() {
    const timerEngine = (0, timerEngine_1.getTimerEngine)();
    // Config handlers
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.GET_CONFIG, () => {
        return configService_1.default.getConfig();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.SAVE_CONFIG, (_event, config) => {
        configService_1.default.saveConfig(config);
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.GET_SCHEDULES, () => {
        return configService_1.default.getSchedules();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.SAVE_SCHEDULE, (_event, schedule) => {
        configService_1.default.saveSchedule(schedule);
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DELETE_SCHEDULE, (_event, id) => {
        configService_1.default.deleteSchedule(id);
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.GET_SESSION_STATE, () => {
        return timerEngine.getState();
    });
    // Timer control handlers
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.PAUSE, () => {
        timerEngine.pause();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.RESUME, () => {
        timerEngine.resume();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.PAUSE_FOR_DURATION, (_event, minutes) => {
        timerEngine.pauseForDuration(minutes);
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.POSTPONE, (_event, minutes) => {
        return timerEngine.postpone(minutes);
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.SKIP_PHASE, () => {
        timerEngine.skipPhase();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.COMPLETE_PHASE, () => {
        timerEngine.completePhase();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.RESET_SESSION, () => {
        timerEngine.resetSession();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.RESET_TODAY_COUNTERS, () => {
        timerEngine.resetTodayCounters();
    });
    // Window control handlers
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.OPEN_SETTINGS, () => {
        (0, windowManager_1.showMainWindow)();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.CLOSE_OVERLAY, () => {
        (0, windowManager_1.closeOverlay)();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.MINIMIZE_TO_TRAY, () => {
        (0, windowManager_1.hideMainWindow)();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.QUIT_APP, () => {
        electron_2.app.quit();
    });
    // Office Focus Lock handlers
    const officeFocusLockService = (0, officeFocusLockService_1.getOfficeFocusLockService)();
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.START_OFFICE_FOCUS_LOCK, (_event, label, durationMinutes) => {
        officeFocusLockService.start(label, durationMinutes);
        return officeFocusLockService.getState();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.STOP_OFFICE_FOCUS_LOCK, () => {
        officeFocusLockService.stop();
        return officeFocusLockService.getState();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.GET_OFFICE_FOCUS_LOCK_STATE, () => {
        return officeFocusLockService.getState();
    });
}
//# sourceMappingURL=ipc.js.map