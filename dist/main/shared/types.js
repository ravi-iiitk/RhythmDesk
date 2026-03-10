"use strict";
/**
 * RhythmDesk Shared Types
 * All data model interfaces used across main and renderer processes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFICE_FOCUS_LOCK_DURATIONS = exports.INITIAL_OFFICE_FOCUS_LOCK_STATE = exports.DEFAULT_GENERAL_SETTINGS = exports.INITIAL_SESSION_STATE = exports.INITIAL_POSTPONE_COUNTS = exports.DEFAULT_SCHEDULE = exports.DEFAULT_LONG_BREAK_CONFIG = exports.DEFAULT_SHORT_BREAK_CONFIG = exports.DEFAULT_TRANSITION_CONFIG = exports.IPC_CHANNELS = exports.OFFICE_FOCUS_LABELS = exports.TimerEvent = void 0;
// Timer engine events
var TimerEvent;
(function (TimerEvent) {
    TimerEvent["PHASE_COMPLETED"] = "phase:completed";
    TimerEvent["SHORT_BREAK_DUE"] = "break:short:due";
    TimerEvent["LONG_BREAK_DUE"] = "break:long:due";
    TimerEvent["POSTPONE_REQUESTED"] = "postpone:requested";
    TimerEvent["POSTPONE_ENDED"] = "postpone:ended";
    TimerEvent["PAUSE_STARTED"] = "pause:started";
    TimerEvent["PAUSE_ENDED"] = "pause:ended";
    TimerEvent["SCHEDULE_ACTIVATED"] = "schedule:activated";
    TimerEvent["SCHEDULE_DEACTIVATED"] = "schedule:deactivated";
    TimerEvent["FOCUS_LOCK_STARTED"] = "focusLock:started";
    TimerEvent["FOCUS_LOCK_STOPPED"] = "focusLock:stopped";
})(TimerEvent || (exports.TimerEvent = TimerEvent = {}));
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
    RESET_SESSION: 'timer:resetSession',
    RESET_TODAY_COUNTERS: 'timer:resetTodayCounters',
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
// Default transition config
exports.DEFAULT_TRANSITION_CONFIG = {
    durationSeconds: 60,
    strictModeEnabled: true,
    allowPostpone: true,
    postponeOptionsMinutes: [2, 5, 10],
    maxPostponesPerDay: 4,
};
// Default break config
exports.DEFAULT_SHORT_BREAK_CONFIG = {
    enabled: true,
    everyMinutes: 60,
    durationMinutes: 5,
    strictModeEnabled: true,
    allowPostpone: true,
    postponeOptionsMinutes: [2, 5, 10],
    maxPostponesPerDay: 4,
};
exports.DEFAULT_LONG_BREAK_CONFIG = {
    enabled: true,
    everyMinutes: 150,
    durationMinutes: 15,
    strictModeEnabled: true,
    allowPostpone: true,
    postponeOptionsMinutes: [2, 5, 10],
    maxPostponesPerDay: 2,
};
// Default values for new schedules
exports.DEFAULT_SCHEDULE = {
    enabled: true,
    activeDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    startTime: '09:00',
    endTime: '17:00',
    priority: 0,
    sitMinutes: 12,
    standMinutes: 8,
    transitions: {
        sitToStand: { ...exports.DEFAULT_TRANSITION_CONFIG },
        standToSit: { ...exports.DEFAULT_TRANSITION_CONFIG },
    },
    shortBreak: { ...exports.DEFAULT_SHORT_BREAK_CONFIG },
    longBreak: { ...exports.DEFAULT_LONG_BREAK_CONFIG },
    // Legacy fields - required for ScheduleForm compatibility
    // These are synced to per-break configs on save
    sitToStandTransitionSeconds: exports.DEFAULT_TRANSITION_CONFIG.durationSeconds,
    standToSitTransitionSeconds: exports.DEFAULT_TRANSITION_CONFIG.durationSeconds,
    shortBreakEnabled: exports.DEFAULT_SHORT_BREAK_CONFIG.enabled,
    shortBreakEveryMinutes: exports.DEFAULT_SHORT_BREAK_CONFIG.everyMinutes,
    shortBreakDurationMinutes: exports.DEFAULT_SHORT_BREAK_CONFIG.durationMinutes,
    longBreakEnabled: exports.DEFAULT_LONG_BREAK_CONFIG.enabled,
    longBreakEveryMinutes: exports.DEFAULT_LONG_BREAK_CONFIG.everyMinutes,
    longBreakDurationMinutes: exports.DEFAULT_LONG_BREAK_CONFIG.durationMinutes,
    strictModeEnabled: true,
    allowPostpone: true,
    postponeOptionsMinutes: [2, 5, 10],
    maxPostponesPerDay: 4,
};
// Initial postpone counts
exports.INITIAL_POSTPONE_COUNTS = {
    sitToStandTransition: 0,
    standToSitTransition: 0,
    shortBreak: 0,
    longBreak: 0,
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
    interruptedPhase: null,
    interruptedPhaseRemainingMs: 0,
    postponeCountsToday: { ...exports.INITIAL_POSTPONE_COUNTS },
    postponeResetDate: new Date().toISOString().split('T')[0],
    isPaused: false,
    pausedAt: null,
    pauseResumeAt: null,
    isPostponed: false,
    postponedUntil: null,
    postponedPhase: null,
    postponedBreakType: null,
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