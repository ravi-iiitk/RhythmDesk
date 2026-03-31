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
const restBlockService_1 = require("../core/restBlockService");
const windowManager_1 = require("./windowManager");
const electron_2 = require("electron");
const overlaySync_1 = require("../core/overlaySync");
const watchdog_1 = require("../core/watchdog");
const logger_1 = __importDefault(require("../core/logger"));
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
        // Notify timer engine if this is the active schedule
        timerEngine.onScheduleUpdated(schedule);
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
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.SHUFFLE_FLOW, () => {
        return timerEngine.shuffleFlow();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.REVERSE_FLOW, () => {
        return timerEngine.reverseFlow();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.TRIGGER_PENDING_BREAK_NOW, () => {
        return timerEngine.triggerPendingBreakNow();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.START_NEXT_ACTIVITY, () => {
        return timerEngine.startNextActivity();
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
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.START_OFFICE_FOCUS_LOCK, (_event, label, durationMinutes, isStrictMode = false) => {
        officeFocusLockService.start(label, durationMinutes, isStrictMode);
        return officeFocusLockService.getState();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.STOP_OFFICE_FOCUS_LOCK, () => {
        officeFocusLockService.stop();
        return officeFocusLockService.getState();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.GET_OFFICE_FOCUS_LOCK_STATE, () => {
        return officeFocusLockService.getState();
    });
    // Rest Block handlers
    const restBlockService = (0, restBlockService_1.getRestBlockService)();
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.START_REST_BLOCK, (_event, name, durationMinutes, isStrictMode = false, presetId = null) => {
        restBlockService.start(name, durationMinutes, isStrictMode, presetId);
        return restBlockService.getState();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.STOP_REST_BLOCK, () => {
        const stopped = restBlockService.stop();
        return { stopped, state: restBlockService.getState() };
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.GET_REST_BLOCK_STATE, () => {
        return restBlockService.getState();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.GET_REST_BLOCK_PRESETS, () => {
        return restBlockService.getPresets();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.SAVE_REST_BLOCK_PRESET, (_event, preset) => {
        restBlockService.savePreset(preset);
        return restBlockService.getPresets();
    });
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DELETE_REST_BLOCK_PRESET, (_event, presetId) => {
        const deleted = restBlockService.deletePreset(presetId);
        return { deleted, presets: restBlockService.getPresets() };
    });
    // Phase 2: Overlay sync heartbeat handler
    // Report to BOTH watchdog systems to keep them in sync
    electron_1.ipcMain.on(overlaySync_1.OVERLAY_SYNC_CHANNELS.HEARTBEAT_RESPONSE, () => {
        logger_1.default.debug('IPC', '[OVERLAY_SYNC] heartbeat response received');
        (0, overlaySync_1.getOverlaySyncService)().onHeartbeatResponse();
        (0, watchdog_1.getOverlayWatchdog)().reportHeartbeat();
    });
    electron_1.ipcMain.on(overlaySync_1.OVERLAY_SYNC_CHANNELS.RESYNC_REQUEST, (event) => {
        logger_1.default.warn('IPC', '[OVERLAY_SYNC] resync requested by overlay renderer');
        (0, overlaySync_1.getOverlaySyncService)().requestResync();
        const latestTick = timerEngine.getLastEmittedTick();
        const restBlock = restBlockService.getState();
        const tick = latestTick
            ? { ...latestTick, restBlock }
            : null;
        event.sender.send(overlaySync_1.OVERLAY_SYNC_CHANNELS.RESYNC_DATA, {
            requestedAt: Date.now(),
            tick,
            restBlock,
            overlayStateVersion: restBlock.startedAt ?? Date.now(),
        });
        logger_1.default.info('IPC', '[OVERLAY_SYNC] resync data sent to overlay', {
            hasTick: !!tick,
            restBlockActive: restBlock.isActive,
            currentPhase: tick?.currentPhase,
            remainingMs: restBlock.remainingMs,
        });
        (0, overlaySync_1.getOverlaySyncService)().confirmResync();
    });
    // Main window health check response handler
    electron_1.ipcMain.on('main-window:health-check-response', () => {
        (0, windowManager_1.onMainWindowHealthCheckResponse)();
    });
    // Dev mode: Clear all data (config + session)
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.DEV_CLEAR_ALL_DATA, () => {
        if (process.env.NODE_ENV !== 'development') {
            return { success: false, message: 'Only available in dev mode' };
        }
        const { configStore, sessionSnapshot } = require('../core/configService');
        configStore.clear();
        sessionSnapshot.clearSnapshot();
        // Reset timer engine state
        timerEngine.resetSession();
        return { success: true, message: 'All data cleared. Restart app for full reset.' };
    });
}
//# sourceMappingURL=ipc.js.map