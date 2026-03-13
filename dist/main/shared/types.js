"use strict";
/**
 * RhythmDesk Shared Types
 * All data model interfaces used across main and renderer processes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFICE_FOCUS_LOCK_DURATIONS = exports.INITIAL_OFFICE_FOCUS_LOCK_STATE = exports.DEFAULT_GENERAL_SETTINGS = exports.INITIAL_SESSION_STATE = exports.INITIAL_POSTPONE_COUNTS = exports.DEFAULT_SCHEDULE = exports.DEFAULT_LONG_BREAK_CONFIG = exports.DEFAULT_SHORT_BREAK_CONFIG = exports.DEFAULT_TRANSITION_CONFIG = exports.IPC_CHANNELS = exports.DEFAULT_REST_BLOCK_PRESETS = exports.INITIAL_REST_BLOCK_STATE = exports.OFFICE_FOCUS_LABELS = exports.TimerEvent = void 0;
exports.computeFlowConfigHash = computeFlowConfigHash;
/**
 * Compute a hash of flowSteps to detect when flow config changed.
 * Used to determine if active session is stale after schedule edit.
 */
function computeFlowConfigHash(flowSteps) {
    if (!flowSteps || flowSteps.length === 0)
        return '';
    // Create a string representation of the flow order and durations
    // This captures: step order, types, and durations
    return flowSteps.map(s => `${s.type}:${s.durationSeconds}`).join('|');
}
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
// Initial rest block state (inactive)
exports.INITIAL_REST_BLOCK_STATE = {
    isActive: false,
    presetId: null,
    name: '',
    startedAt: null,
    durationMs: 0,
    remainingMs: 0,
    isStrictMode: false,
};
// Default rest block presets
exports.DEFAULT_REST_BLOCK_PRESETS = [
    { id: 'quick-rest', name: 'Quick Rest', durationMinutes: 5, strictMode: false },
    { id: 'meditation', name: 'Meditation', durationMinutes: 10, strictMode: true },
    { id: 'lunch-break', name: 'Lunch Break', durationMinutes: 30, strictMode: false },
    { id: '1-hour', name: '1 Hour', durationMinutes: 60, strictMode: false },
    { id: '2-hours', name: '2 Hours', durationMinutes: 120, strictMode: false },
];
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
    SHUFFLE_FLOW: 'timer:shuffleFlow',
    REVERSE_FLOW: 'timer:reverseFlow',
    // Office Focus Lock controls
    START_OFFICE_FOCUS_LOCK: 'officeFocusLock:start',
    STOP_OFFICE_FOCUS_LOCK: 'officeFocusLock:stop',
    GET_OFFICE_FOCUS_LOCK_STATE: 'officeFocusLock:getState',
    // Rest Block controls
    START_REST_BLOCK: 'restBlock:start',
    STOP_REST_BLOCK: 'restBlock:stop',
    GET_REST_BLOCK_STATE: 'restBlock:getState',
    GET_REST_BLOCK_PRESETS: 'restBlock:getPresets',
    SAVE_REST_BLOCK_PRESET: 'restBlock:savePreset',
    DELETE_REST_BLOCK_PRESET: 'restBlock:deletePreset',
    REST_BLOCK_CHANGED: 'restBlock:changed',
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
    shortBreakCountToday: 0,
    longBreakCountToday: 0,
    breakCountResetDate: new Date().toISOString().split('T')[0],
    interruptedPhase: null,
    interruptedPhaseRemainingMs: 0,
    interruptedFlowIndex: undefined,
    postponeCountsToday: { ...exports.INITIAL_POSTPONE_COUNTS },
    postponeResetDate: new Date().toISOString().split('T')[0],
    isPaused: false,
    pausedAt: null,
    pauseResumeAt: null,
    isPostponed: false,
    postponedUntil: null,
    postponedPhase: null,
    postponedBreakType: null,
    prePostponeWorkPhase: null,
    prePostponeWorkPhaseRemainingMs: 0,
    prePostponeFlowIndex: undefined,
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
    isStrictMode: false,
};
// Office Focus Lock duration presets (in minutes)
exports.OFFICE_FOCUS_LOCK_DURATIONS = [30, 60, 90, 120];
//# sourceMappingURL=types.js.map