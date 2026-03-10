"use strict";
/**
 * RhythmDesk Shared Types
 * All data model interfaces used across main and renderer processes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFICE_FOCUS_LOCK_DURATIONS = exports.INITIAL_OFFICE_FOCUS_LOCK_STATE = exports.DEFAULT_GENERAL_SETTINGS = exports.INITIAL_SESSION_STATE = exports.DEFAULT_SCHEDULE = exports.IPC_CHANNELS = exports.OFFICE_FOCUS_LABELS = void 0;
// Preset work labels for Office Focus Lock
exports.OFFICE_FOCUS_LABELS = ['EPAM', 'Resy'];
// IPC channel names
exports.IPC_CHANNELS = {
    // Main -> Renderer
    TIMER_TICK: 'timer:tick',
    PHASE_CHANGE: 'phase:change',
    SHOW_OVERLAY: 'overlay:show',
    HIDE_OVERLAY: 'overlay:hide',
    CONFIG_UPDATED: 'config:updated',
    OFFICE_FOCUS_LOCK_CHANGED: 'officeFocusLock:changed',
    // Renderer -> Main
    GET_CONFIG: 'config:get',
    SAVE_CONFIG: 'config:save',
    GET_SCHEDULES: 'schedules:get',
    SAVE_SCHEDULE: 'schedule:save',
    DELETE_SCHEDULE: 'schedule:delete',
    GET_SESSION_STATE: 'session:get',
    // Timer controls
    PAUSE: 'timer:pause',
    RESUME: 'timer:resume',
    PAUSE_FOR_DURATION: 'timer:pauseForDuration',
    POSTPONE: 'timer:postpone',
    SKIP_PHASE: 'timer:skipPhase',
    COMPLETE_PHASE: 'timer:completePhase',
    // Office Focus Lock controls
    START_OFFICE_FOCUS_LOCK: 'officeFocusLock:start',
    STOP_OFFICE_FOCUS_LOCK: 'officeFocusLock:stop',
    GET_OFFICE_FOCUS_LOCK_STATE: 'officeFocusLock:getState',
    // Window controls
    OPEN_SETTINGS: 'window:openSettings',
    CLOSE_OVERLAY: 'overlay:close',
    MINIMIZE_TO_TRAY: 'window:minimizeToTray',
    QUIT_APP: 'app:quit',
};
// Default values for new schedules
exports.DEFAULT_SCHEDULE = {
    enabled: true,
    activeDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    startTime: '09:00',
    endTime: '17:00',
    sitMinutes: 12,
    sitToStandTransitionSeconds: 60,
    standMinutes: 8,
    standToSitTransitionSeconds: 60,
    shortBreakEnabled: true,
    shortBreakEveryMinutes: 60,
    shortBreakDurationMinutes: 5,
    longBreakEnabled: true,
    longBreakEveryMinutes: 150,
    longBreakDurationMinutes: 15,
    strictModeEnabled: true,
    allowPostpone: true,
    postponeOptionsMinutes: [2, 5, 10],
    maxPostponesPerDay: 4,
    lockOverlayInStrictMode: true,
};
// Initial session state
exports.INITIAL_SESSION_STATE = {
    activeScheduleId: null,
    currentPhase: 'idle',
    phaseStartedAt: 0,
    phaseEndsAt: 0,
    phaseRemainingMs: 0,
    phaseTotalMs: 0,
    cumulativeWorkTimeMs: 0,
    lastShortBreakAtWorkTimeMs: 0,
    lastLongBreakAtWorkTimeMs: 0,
    postponeCountToday: 0,
    postponeResetDate: new Date().toISOString().split('T')[0],
    isPaused: false,
    pausedAt: null,
    pauseResumeAt: null,
    isPostponed: false,
    postponedUntil: null,
    postponedPhase: null,
};
// Default general settings
exports.DEFAULT_GENERAL_SETTINGS = {
    soundEnabled: true,
    soundVolume: 50,
    darkMode: true,
    startMinimized: false,
    startOnLogin: false,
    showNotifications: true,
    simulateMode: false,
};
// Initial Office Focus Lock state (inactive)
exports.INITIAL_OFFICE_FOCUS_LOCK_STATE = {
    isActive: false,
    label: '',
    startedAt: null,
    durationMs: 0,
    remainingMs: 0,
};
// Office Focus Lock duration presets (in minutes)
exports.OFFICE_FOCUS_LOCK_DURATIONS = [30, 60, 90, 120];
//# sourceMappingURL=types.js.map