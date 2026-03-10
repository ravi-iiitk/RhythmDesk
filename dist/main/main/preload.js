"use strict";
/**
 * RhythmDesk Preload Script
 * Exposes safe IPC methods to renderer process
 */
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const types_1 = require("../shared/types");
const api = {
    // Config operations
    getConfig: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.GET_CONFIG),
    saveConfig: (config) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.SAVE_CONFIG, config),
    getSchedules: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.GET_SCHEDULES),
    saveSchedule: (schedule) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.SAVE_SCHEDULE, schedule),
    deleteSchedule: (id) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.DELETE_SCHEDULE, id),
    getSessionState: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.GET_SESSION_STATE),
    // Timer controls
    pause: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.PAUSE),
    resume: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.RESUME),
    pauseForDuration: (minutes) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.PAUSE_FOR_DURATION, minutes),
    postpone: (minutes) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.POSTPONE, minutes),
    skipPhase: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.SKIP_PHASE),
    completePhase: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.COMPLETE_PHASE),
    resetSession: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.RESET_SESSION),
    resetTodayCounters: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.RESET_TODAY_COUNTERS),
    // Office Focus Lock controls
    startOfficeFocusLock: (label, durationMinutes, isStrictMode = false) => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.START_OFFICE_FOCUS_LOCK, label, durationMinutes, isStrictMode),
    stopOfficeFocusLock: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.STOP_OFFICE_FOCUS_LOCK),
    getOfficeFocusLockState: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.GET_OFFICE_FOCUS_LOCK_STATE),
    // Window controls
    openSettings: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.OPEN_SETTINGS),
    closeOverlay: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.CLOSE_OVERLAY),
    minimizeToTray: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.MINIMIZE_TO_TRAY),
    quitApp: () => electron_1.ipcRenderer.invoke(types_1.IPC_CHANNELS.QUIT_APP),
    // Event listeners with cleanup
    onTimerTick: (callback) => {
        const handler = (_event, tick) => callback(tick);
        electron_1.ipcRenderer.on(types_1.IPC_CHANNELS.TIMER_TICK, handler);
        return () => electron_1.ipcRenderer.removeListener(types_1.IPC_CHANNELS.TIMER_TICK, handler);
    },
    onPhaseChange: (callback) => {
        const handler = (_event, data) => callback(data);
        electron_1.ipcRenderer.on(types_1.IPC_CHANNELS.PHASE_CHANGE, handler);
        return () => electron_1.ipcRenderer.removeListener(types_1.IPC_CHANNELS.PHASE_CHANGE, handler);
    },
    onShowOverlay: (callback) => {
        const handler = (_event, data) => callback(data);
        electron_1.ipcRenderer.on(types_1.IPC_CHANNELS.SHOW_OVERLAY, handler);
        return () => electron_1.ipcRenderer.removeListener(types_1.IPC_CHANNELS.SHOW_OVERLAY, handler);
    },
    onHideOverlay: (callback) => {
        const handler = () => callback();
        electron_1.ipcRenderer.on(types_1.IPC_CHANNELS.HIDE_OVERLAY, handler);
        return () => electron_1.ipcRenderer.removeListener(types_1.IPC_CHANNELS.HIDE_OVERLAY, handler);
    },
    onConfigUpdated: (callback) => {
        const handler = (_event, config) => callback(config);
        electron_1.ipcRenderer.on(types_1.IPC_CHANNELS.CONFIG_UPDATED, handler);
        return () => electron_1.ipcRenderer.removeListener(types_1.IPC_CHANNELS.CONFIG_UPDATED, handler);
    },
    onOfficeFocusLockChanged: (callback) => {
        const handler = (_event, state) => callback(state);
        electron_1.ipcRenderer.on(types_1.IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, handler);
        return () => electron_1.ipcRenderer.removeListener(types_1.IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, handler);
    },
};
electron_1.contextBridge.exposeInMainWorld('rhythmDesk', api);
//# sourceMappingURL=preload.js.map