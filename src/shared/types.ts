/**
 * RhythmDesk Shared Types
 * All data model interfaces used across main and renderer processes
 */

// Days of the week
export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

// Phase types in the work cycle
export type PhaseType = 
  | 'sit'
  | 'stand'
  | 'sit-to-stand-transition'
  | 'stand-to-sit-transition'
  | 'short-break'
  | 'long-break'
  | 'custom'
  | 'idle';

// Break/transition types for per-break configuration
export type BreakType = 'sitToStandTransition' | 'standToSitTransition' | 'shortBreak' | 'longBreak';

// Schedule mode: rule-based (existing) or flow-based (new)
export type ScheduleMode = 'rule-based' | 'flow-based';

/**
 * Focus Session — a time-bounded strict-focus block within a schedule.
 * While active the app takes over the screen: fullscreen, always-on-top,
 * no close, no Alt-Tab. Normal breaks still run inside the session.
 */
export interface FocusSession {
  id: string;
  name: string;
  startTime: string;    // "HH:MM" 24-hour format
  endTime: string;      // "HH:MM" 24-hour format
  daysOfWeek: number[]; // 0=Sun … 6=Sat; empty array = every day
  enabled: boolean;
}

// Flow step types (subset of PhaseType, excluding idle and long-break which remains rule-based)
export type FlowStepType = 
  | 'sit'
  | 'stand'
  | 'sit-to-stand-transition'
  | 'stand-to-sit-transition'
  | 'short-break'
  | 'custom';

// A single step in a flow-based schedule
export interface FlowStep {
  id: string;
  type: FlowStepType;
  durationSeconds: number;
  label?: string; // Optional custom label for this step
  // Custom step overlay behavior (used when type === 'custom', optional override for built-in types)
  showOverlay?: boolean;       // If true, shows fullscreen overlay during this step (like transitions)
  allowPause?: boolean;        // If true, shows pause button on overlay to pause countdown
  color?: string;              // Custom color for overlay UI (hex, e.g. '#f59e0b')
  message?: string;            // Custom message shown on overlay screen
  strictMode?: boolean;        // If true, user cannot dismiss overlay early
  countsAsWork?: boolean;      // If true, counts toward cumulative work time (default: false for custom)
}

/**
 * Compute a hash of flowSteps to detect when flow config changed.
 * Used to determine if active session is stale after schedule edit.
 */
export function computeFlowConfigHash(flowSteps: FlowStep[] | undefined): string {
  if (!flowSteps || flowSteps.length === 0) return '';
  // Create a string representation of the flow order, durations, and custom step flags
  return flowSteps.map(s => {
    let hash = `${s.type}:${s.durationSeconds}`;
    if (s.type === 'custom') {
      hash += `:o${s.showOverlay ? 1 : 0}:p${s.allowPause ? 1 : 0}:s${s.strictMode ? 1 : 0}:w${s.countsAsWork ? 1 : 0}`;
    }
    return hash;
  }).join('|');
}

// Timer engine events
export enum TimerEvent {
  PHASE_COMPLETED = 'phase:completed',
  SHORT_BREAK_DUE = 'break:short:due',
  LONG_BREAK_DUE = 'break:long:due',
  POSTPONE_REQUESTED = 'postpone:requested',
  POSTPONE_ENDED = 'postpone:ended',
  PAUSE_STARTED = 'pause:started',
  PAUSE_ENDED = 'pause:ended',
  SCHEDULE_ACTIVATED = 'schedule:activated',
  SCHEDULE_DEACTIVATED = 'schedule:deactivated',
  FOCUS_LOCK_STARTED = 'focusLock:started',
  FOCUS_LOCK_STOPPED = 'focusLock:stopped',
}

// Per-break/transition configuration
export interface TransitionConfig {
  durationSeconds: number;
  strictModeEnabled: boolean;
  allowPostpone: boolean;
  allowPause: boolean;             // If true, shows pause button on transition overlay
  postponeOptionsMinutes: number[];
  maxPostponesPerDay: number;
}

export interface BreakConfig {
  enabled: boolean;
  everyMinutes: number;
  durationMinutes: number;
  strictModeEnabled: boolean;
  allowPostpone: boolean;
  postponeOptionsMinutes: number[];
  maxPostponesPerDay: number;
  maxSkipsPerDay?: number;
}

// Schedule configuration
export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  activeDays: DayOfWeek[];
  startTime: string; // HH:MM format
  endTime: string;   // HH:MM format, can be next day if < startTime
  priority: number;  // Higher = more important (tiebreaker if schedules overlap)
  
  // Schedule mode: 'rule-based' (default/legacy) or 'flow-based' (new)
  mode?: ScheduleMode;
  
  // Flow-based mode: ordered list of steps to cycle through
  // Only used when mode === 'flow-based'
  flowSteps?: FlowStep[];
  
  // Cumulative work time settings (for long break triggers)
  // Controls whether these phases count toward cumulative work time
  transitionsCountAsCumulativeWork?: boolean;  // default: true
  shortBreaksCountAsCumulativeWork?: boolean;  // default: true

  // Minimum work-time gap required between a short break and a long break (in either order).
  // Prevents two breaks firing back-to-back in flow-based schedules:
  // - If a long break is due but a short break just happened within this gap, the long break is deferred.
  // - If the flow reaches a short-break step but a long break just happened within this gap, the short break step is skipped.
  // 0 or undefined = disabled (no suppression).
  minBreakGapMinutes?: number;
  
  // Work phase durations (used in rule-based mode)
  sitMinutes: number;
  standMinutes: number;
  
  // Per-break/transition configuration
  transitions: {
    sitToStand: TransitionConfig;
    standToSit: TransitionConfig;
  };
  shortBreak: BreakConfig;
  longBreak: BreakConfig;
  
  // Legacy fields (kept for migration, will be removed in future)
  // @deprecated Use transitions.sitToStand.durationSeconds
  sitToStandTransitionSeconds?: number;
  // @deprecated Use transitions.standToSit.durationSeconds
  standToSitTransitionSeconds?: number;
  // @deprecated Use shortBreak.enabled
  shortBreakEnabled?: boolean;
  // @deprecated Use shortBreak.everyMinutes
  shortBreakEveryMinutes?: number;
  // @deprecated Use shortBreak.durationMinutes
  shortBreakDurationMinutes?: number;
  // @deprecated Use longBreak.enabled
  longBreakEnabled?: boolean;
  // @deprecated Use longBreak.everyMinutes
  longBreakEveryMinutes?: number;
  // @deprecated Use longBreak.durationMinutes
  longBreakDurationMinutes?: number;
  // @deprecated Use per-break strictModeEnabled
  strictModeEnabled?: boolean;
  // Prevent skipping to next activity (separate from strict mode which prevents early dismiss)
  noSkipEnabled?: boolean;
  // If false, timer pauses after each phase ends and waits for user to manually start the next activity
  // Default: true (auto-start next activity as before)
  autoStartNextActivity?: boolean;
  // @deprecated Use per-break allowPostpone
  allowPostpone?: boolean;
  // @deprecated Use per-break postponeOptionsMinutes
  postponeOptionsMinutes?: number[];
  // @deprecated Use per-break maxPostponesPerDay
  maxPostponesPerDay?: number;
  // @deprecated Use shortBreak/longBreak maxSkipsPerDay
  maxSkipsPerDay?: number;
  // @deprecated
  lockOverlayInStrictMode?: boolean;
  
  // Focus Sessions — strict-focus time blocks that run inside this schedule
  focusSessions?: FocusSession[];
  
  // Metadata
  createdAt: number;
}

// Per-break-type postpone counters
export interface PostponeCountsToday {
  sitToStandTransition: number;
  standToSitTransition: number;
  shortBreak: number;
  longBreak: number;
}

// Per-break-type skip counters (active breaks only)
export interface BreakSkipCountsToday {
  shortBreak: number;
  longBreak: number;
}

/**
 * Current session state - persisted to survive restarts
 * 
 * SESSION STATE INVARIANTS:
 * 
 * 1. PHASE-MODE CONSISTENCY:
 *    - If schedule mode is 'flow-based', currentFlowStepIndex MUST be valid (0 to flowSteps.length-1)
 *    - If schedule mode is 'rule-based', currentFlowStepIndex MUST be undefined
 * 
 * 2. FLOW INDEX-PHASE CONSISTENCY:
 *    - In flow mode, currentPhase SHOULD match flowSteps[currentFlowStepIndex].type
 *    - EXCEPTION: during long-break (rule-based interrupt), phase won't match index
 * 
 * 3. POSTPONE STATE CONSISTENCY:
 *    - If isPostponed is true: postponedPhase MUST be a break phase, currentPhase SHOULD be work phase
 *    - If isPostponed is false: postponedPhase MUST be null, postponedUntil MUST be null
 * 
 * 4. PAUSE STATE CONSISTENCY:
 *    - If isPaused is true: pausedAt MUST be set
 *    - If isPaused is false: pausedAt MUST be null, pauseResumeAt MUST be null
 * 
 * 5. TIMESTAMP CONSISTENCY:
 *    - phaseEndsAt should be > phaseStartedAt (unless idle)
 *    - phaseRemainingMs should be <= phaseTotalMs
 * 
 * 6. RESET PRODUCES CLEAN STATE:
 *    - After reset: currentPhase is first work phase (sit or stand)
 *    - After reset: all postpone/pause/interrupted state is cleared
 *    - After reset: cumulative work time is 0
 * 
 * 7. CURRENT/NEXT/THEN DERIVATION:
 *    - next and then are ALWAYS derived, never stored
 *    - In flow mode: next = flowSteps[(currentFlowStepIndex + 1) % length].type
 */
export interface SessionState {
  activeScheduleId: string | null;
  currentPhase: PhaseType;
  phaseStartedAt: number;        // timestamp when current phase started
  phaseEndsAt: number;           // timestamp when current phase should end
  phaseRemainingMs: number;      // remaining time in current phase (derived from phaseEndsAt)
  phaseTotalMs: number;          // total duration of current phase
  phaseOriginalDurationMs: number; // original configured duration (never mutated by extend/prepone)
  
  // Flow-based mode: current step index in flowSteps array
  currentFlowStepIndex?: number;
  
  // Hash of flowSteps config to detect when flow was edited
  // When this doesn't match the current schedule's flow, session is stale
  flowConfigHash?: string;
  
  // Cumulative active work time (sit + stand only, not transitions/breaks)
  cumulativeWorkTimeMs: number;
  
  // Break tracking based on cumulative work time
  lastShortBreakAtWorkTimeMs: number;
  lastLongBreakAtWorkTimeMs: number;
  
  // Break counts for today
  shortBreakCountToday: number;
  longBreakCountToday: number;
  breakCountResetDate: string; // YYYY-MM-DD format
  
  // Interrupted phase tracking (for short break resume)
  interruptedPhase: PhaseType | null;
  interruptedPhaseRemainingMs: number;
  interruptedFlowIndex: number | undefined; // Flow index when break interrupted work
  
  // Per-break-type postpone tracking
  postponeCountsToday: PostponeCountsToday;
  postponeResetDate: string; // YYYY-MM-DD format

  // Per-break-type skip tracking (for active break skip limits)
  breakSkipCountsToday?: BreakSkipCountsToday;
  
  // Legacy single counter (for migration)
  // @deprecated Use postponeCountsToday
  postponeCountToday?: number;
  
  // Waiting-for-user state: set when autoStartNextActivity=false and a phase just ended
  // Timer holds here until user clicks "Start [Next Activity]"
  isWaitingForNextActivity: boolean;
  waitingNextPhase: PhaseType | null; // the phase ready to start when user confirms

  // Pause state
  isPaused: boolean;
  pausedAt: number | null;
  pauseResumeAt: number | null;  // null = manual resume required
  
  // Postpone state - IMPORTANT: When a break is postponed, work continues!
  // The break is marked as pending, NOT as the current phase.
  // pendingBreakType holds the break that will trigger when postponedUntil is reached.
  // currentPhase should be the work phase (sit/stand), NOT the break.
  isPostponed: boolean;
  postponedUntil: number | null;
  postponedPhase: PhaseType | null; // the break phase that was postponed (pending)
  postponedBreakType: BreakType | null; // which break type was postponed
  
  // Work phase that was interrupted when break became due
  // Used to restore work after postponed break completes
  prePostponeWorkPhase: PhaseType | null;
  prePostponeWorkPhaseRemainingMs: number;
  prePostponeFlowIndex: number | undefined; // Flow index to restore after postpone

  // Focus Session lockdown state (persisted so app re-locks after restart/kill)
  isFocusSessionActive: boolean;
  activeFocusSessionId: string | null;
  focusSessionEndsAt: number | null; // Unix ms when session ends; null = not active
}

// App configuration
export interface AppConfig {
  schedules: Schedule[];
  generalSettings: GeneralSettings;
  sessionState: SessionState;
}

// General app settings
export interface GeneralSettings {
  soundEnabled: boolean;
  soundVolume: number; // 0-100
  darkMode: boolean;
  startMinimized: boolean;
  startOnLogin: boolean;
  showNotifications: boolean;
  simulateMode: boolean;      // Speed up timers for testing (1 min = 2 sec)
  autoIdlePause: boolean;     // Auto-pause schedule when system is idle
  idleThresholdMinutes: number; // Minutes of idle before auto-pause (default: 3)
  waterReminderEnabled: boolean;  // Show water reminder overlay
  waterReminderIntervalMinutes: number; // Minutes between water reminders (default: 10)
  breakExtendMinutes: number; // Minutes to extend a break by (default: 2) - deprecated, use extendOptions
  extendOptions: number[]; // Array of extend duration options in minutes (default: [2, 5, 10])
  preponeOptions: number[]; // Array of prepone (reduce) duration options in minutes (default: [1, 2, 5])
  openaiApiKey: string; // OpenAI API key for voice commands (Whisper STT)
  voiceMode: 'off' | 'local' | 'cloud'; // Voice command backend: off, local whisper.cpp, or cloud Whisper API
  logRetentionDays: number; // How many days to keep activity log entries (default: 30)
}

// Activity Log - user-facing event log for tracking work sessions
export type ActivityLogEventType =
  | 'schedule_started'
  | 'schedule_stopped'
  | 'phase_started'
  | 'phase_completed'
  | 'break_started'
  | 'break_completed'
  | 'break_skipped'
  | 'break_postponed'
  | 'session_reset'
  | 'session_paused'
  | 'session_resumed'
  | 'flow_shuffled'
  | 'flow_reversed'
  | 'flow_order_applied'
  | 'focus_lock_started'
  | 'focus_lock_ended'
  | 'rest_block_started'
  | 'rest_block_ended';

export interface ActivityLogEntry {
  id: string;
  timestamp: number;       // Unix ms
  event: ActivityLogEventType;
  title: string;           // Human-readable title (e.g. "Sit Phase Started")
  description?: string;    // Optional details
  phase?: PhaseType;       // Related phase
  scheduleName?: string;   // Which schedule was active
  durationMs?: number;     // Duration of the completed event (if applicable)
  metadata?: Record<string, unknown>; // Extra data for detail view
}

// Office Focus Lock state - runtime only, not persisted across restarts
// Manual mode for enforcing fullscreen overlay during work phases
export interface OfficeFocusLockState {
  isActive: boolean;
  label: string;                 // Work label (e.g., "Deep Work", "Client Call", custom)
  startedAt: number | null;      // timestamp when lock started
  durationMs: number;            // total duration in milliseconds
  remainingMs: number;           // remaining time
  isStrictMode: boolean;         // if true, cannot stop focus mode early
}

// Preset work labels for Office Focus Lock
export const OFFICE_FOCUS_LABELS = ['Deep Work', 'Meeting', 'Client Call', 'Research'] as const;
export type OfficeFocusLabel = typeof OFFICE_FOCUS_LABELS[number] | string;

// Rest Block - saved preset for manual rest/break blocks
export interface RestBlockPreset {
  id: string;
  name: string;                  // Display name (e.g., "Quick Rest", "Meditation", "Lunch")
  durationMinutes: number;       // Duration in minutes
  strictMode: boolean;           // If true, cannot end early
}

// Rest Block runtime state - when a rest block is active
export interface RestBlockState {
  isActive: boolean;
  presetId: string | null;       // ID of the preset being used (null if custom)
  name: string;                  // Name of current rest block
  startedAt: number | null;      // timestamp when started
  durationMs: number;            // total duration in milliseconds
  remainingMs: number;           // remaining time
  isStrictMode: boolean;         // if true, cannot stop early
}

// Initial rest block state (inactive)
export const INITIAL_REST_BLOCK_STATE: RestBlockState = {
  isActive: false,
  presetId: null,
  name: '',
  startedAt: null,
  durationMs: 0,
  remainingMs: 0,
  isStrictMode: false,
};

// Default rest block presets
export const DEFAULT_REST_BLOCK_PRESETS: RestBlockPreset[] = [
  { id: 'bio-break', name: 'Bio Break', durationMinutes: 2, strictMode: false },
  { id: 'quick-rest', name: 'Quick Rest', durationMinutes: 5, strictMode: false },
  { id: 'dinner', name: 'Dinner', durationMinutes: 30, strictMode: false },
  { id: 'lunch-break', name: 'Lunch Break', durationMinutes: 60, strictMode: false },
  { id: '2-hours', name: '2 Hours', durationMinutes: 120, strictMode: false },
];

// Break progress information
export interface BreakProgress {
  // Short break progress
  shortBreakEnabled: boolean;
  shortBreakEveryMinutes: number;
  shortBreakDurationMinutes: number;
  workTimeSinceShortBreakMs: number;     // time worked since last short break
  msUntilNextShortBreak: number;         // ms until next short break triggers
  shortBreakProgress: number;            // 0-1 progress toward next short break
  
  // Long break progress
  longBreakEnabled: boolean;
  longBreakEveryMinutes: number;
  longBreakDurationMinutes: number;
  workTimeSinceLongBreakMs: number;      // time worked since last long break
  msUntilNextLongBreak: number;          // ms until next long break triggers
  longBreakProgress: number;             // 0-1 progress toward next long break
  
  // Next break info (which comes first)
  nextBreakType: 'short-break' | 'long-break' | null;
  nextBreakInMs: number;                 // ms until next break (whichever is sooner)
  
  // Break counts for today
  shortBreakCountToday: number;          // number of short breaks taken today
  longBreakCountToday: number;           // number of long breaks taken today
}

// Configured phase durations from active schedule
export interface ConfiguredDurations {
  sitMinutes: number;
  standMinutes: number;
  sitToStandTransitionSeconds: number;
  standToSitTransitionSeconds: number;
  shortBreakDurationMinutes: number;
  longBreakDurationMinutes: number;
}

// Timer tick event sent to renderer
export interface TimerTick {
  scheduleId: string | null;
  scheduleName: string | null;
  scheduleMode: ScheduleMode | null;
  currentPhase: PhaseType;
  // Custom display labels for phases (uses custom label if defined, else default)
  currentPhaseLabel: string;
  nextPhaseLabel: string;
  thenPhaseLabel: string;
  phaseRemainingMs: number;
  phaseTotalMs: number;
  phaseOriginalDurationMs: number; // original configured duration (unmodified by extend/prepone)
  nextPhase: PhaseType;
  nextPhaseDurationMs: number;
  thenPhase: PhaseType;
  thenPhaseDurationMs: number;
  cumulativeWorkTimeMs: number;
  isPaused: boolean;
  isWaitingForNextActivity: boolean;   // true when autoStartNextActivity=false and phase just ended
  waitingNextPhase: PhaseType | null;  // the phase queued to start
  isPostponed: boolean;
  // Pending break info (when isPostponed is true, work continues but break is pending)
  pendingBreakPhase: PhaseType | null;
  pendingBreakInMs: number; // ms until pending break triggers
  // Flow-based schedule: true if flow config changed since session started
  // User should reset session to apply new flow order
  isFlowStale: boolean;
  postponeCountToday: number;
  maxPostponesPerDay: number;
  canPostpone: boolean;
  postponeOptions: number[];
  isStrictMode: boolean;
  // No skip mode - prevents skipping to next activity
  noSkipEnabled: boolean;
  // Break skip tracking (active short/long breaks)
  breakSkipCountToday?: number;
  maxBreakSkipsPerDay?: number;
  canSkipCurrentBreak?: boolean;
  // Office Focus Lock state
  officeFocusLock: OfficeFocusLockState;
  // Rest Block state
  restBlock: RestBlockState;
  // Break progress information
  breakProgress: BreakProgress;
  // Configured durations from active schedule
  configuredDurations: ConfiguredDurations;
  // Custom flow step metadata (populated when current step has custom properties)
  currentStepShowOverlay?: boolean;   // Whether current step forces overlay
  currentStepAllowPause?: boolean;    // Whether pause button should show on overlay
  currentStepColor?: string;          // Custom color for overlay UI
  currentStepMessage?: string;        // Custom message for overlay
  currentStepStrictMode?: boolean;    // Custom strict mode override
  // Phase 1.5: Debug snapshot for dev mode dashboard panel
  debugSnapshot?: {
    currentFlowStepIndex: number | undefined;
    validationStatus: 'ok' | 'warning' | 'error';
    flowStepsCount: number;
  };
  // Water reminder state - allows overlay to restore state after recreation
  waterReminderActive?: boolean;
}

// IPC channel names
export const IPC_CHANNELS = {
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
  APPLY_FLOW_ORDER: 'timer:applyFlowOrder',
  TRIGGER_PENDING_BREAK_NOW: 'timer:triggerPendingBreakNow',
  START_NEXT_ACTIVITY: 'timer:startNextActivity',
  RESTART_CURRENT_ACTIVITY: 'timer:restartCurrentActivity',
  EXTEND_BREAK: 'timer:extendBreak',
  PREPONE_PHASE: 'timer:preponePhase',
  RESET_PHASE_DURATION: 'timer:resetPhaseDuration',
  START_AD_HOC_BREAK: 'timer:startAdHocBreak',
  
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
  
  // Pause reminder
  SHOW_PAUSE_REMINDER: 'overlay:showPauseReminder',
  DISMISS_PAUSE_REMINDER: 'overlay:dismissPauseReminder',
  
  // Water reminder
  SHOW_WATER_REMINDER: 'overlay:showWaterReminder',
  DISMISS_WATER_REMINDER: 'overlay:dismissWaterReminder',
  
  // Window controls
  OPEN_SETTINGS: 'window:openSettings',
  CLOSE_OVERLAY: 'overlay:close',
  MINIMIZE_TO_TRAY: 'window:minimizeToTray',
  QUIT_APP: 'app:quit',
  
  // Sound management
  GET_AVAILABLE_SOUNDS: 'sound:getAvailable',
  PLAY_TEST_SOUND: 'sound:playTest',
  
  // Voice commands
  VOICE_TRANSCRIBE: 'voice:transcribe',
  VOICE_TRANSCRIBE_LOCAL: 'voice:transcribeLocal',
  
  // Activity Log
  GET_ACTIVITY_LOG: 'activityLog:get',
  CLEAR_ACTIVITY_LOG: 'activityLog:clear',
  
  // Focus Session
  FOCUS_SESSION_CHANGED: 'focusSession:changed',
  GET_FOCUS_SESSION_STATE: 'focusSession:getState',
  
  // Dev mode only
  DEV_CLEAR_ALL_DATA: 'dev:clearAllData',
} as const;

// Default transition config
export const DEFAULT_TRANSITION_CONFIG: TransitionConfig = {
  durationSeconds: 60,
  strictModeEnabled: false,
  allowPostpone: true,
  allowPause: true,
  postponeOptionsMinutes: [2, 5, 10],
  maxPostponesPerDay: 4,
};

// Default break config
export const DEFAULT_SHORT_BREAK_CONFIG: BreakConfig = {
  enabled: true,
  everyMinutes: 60,
  durationMinutes: 5,
  strictModeEnabled: true,
  allowPostpone: true,
  postponeOptionsMinutes: [2, 5, 10],
  maxPostponesPerDay: 4,
  maxSkipsPerDay: 2,
};

export const DEFAULT_LONG_BREAK_CONFIG: BreakConfig = {
  enabled: true,
  everyMinutes: 150,
  durationMinutes: 15,
  strictModeEnabled: true,
  allowPostpone: true,
  postponeOptionsMinutes: [2, 5, 10],
  maxPostponesPerDay: 2,
  maxSkipsPerDay: 1,
};

// Default values for new schedules
export const DEFAULT_SCHEDULE: Omit<Schedule, 'id' | 'name' | 'createdAt'> = {
  enabled: true,
  activeDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  startTime: '09:00',
  endTime: '17:00',
  priority: 0,
  sitMinutes: 12,
  standMinutes: 8,
  transitions: {
    sitToStand: { ...DEFAULT_TRANSITION_CONFIG },
    standToSit: { ...DEFAULT_TRANSITION_CONFIG },
  },
  shortBreak: { ...DEFAULT_SHORT_BREAK_CONFIG },
  longBreak: { ...DEFAULT_LONG_BREAK_CONFIG },
  // Legacy fields - required for ScheduleForm compatibility
  // These are synced to per-break configs on save
  sitToStandTransitionSeconds: DEFAULT_TRANSITION_CONFIG.durationSeconds,
  standToSitTransitionSeconds: DEFAULT_TRANSITION_CONFIG.durationSeconds,
  shortBreakEnabled: DEFAULT_SHORT_BREAK_CONFIG.enabled,
  shortBreakEveryMinutes: DEFAULT_SHORT_BREAK_CONFIG.everyMinutes,
  shortBreakDurationMinutes: DEFAULT_SHORT_BREAK_CONFIG.durationMinutes,
  longBreakEnabled: DEFAULT_LONG_BREAK_CONFIG.enabled,
  longBreakEveryMinutes: DEFAULT_LONG_BREAK_CONFIG.everyMinutes,
  longBreakDurationMinutes: DEFAULT_LONG_BREAK_CONFIG.durationMinutes,
  strictModeEnabled: true,
  noSkipEnabled: false,
  autoStartNextActivity: true,
  allowPostpone: true,
  postponeOptionsMinutes: [2, 5, 10],
  maxPostponesPerDay: 4,
  minBreakGapMinutes: 0,
};

// Initial postpone counts
export const INITIAL_POSTPONE_COUNTS: PostponeCountsToday = {
  sitToStandTransition: 0,
  standToSitTransition: 0,
  shortBreak: 0,
  longBreak: 0,
};

export const INITIAL_BREAK_SKIP_COUNTS: BreakSkipCountsToday = {
  shortBreak: 0,
  longBreak: 0,
};

// Initial session state
export const INITIAL_SESSION_STATE: SessionState = {
  activeScheduleId: null,
  currentPhase: 'idle',
  phaseStartedAt: 0,
  phaseEndsAt: 0,
  phaseRemainingMs: 0,
  phaseTotalMs: 0,
  phaseOriginalDurationMs: 0,
  cumulativeWorkTimeMs: 0,
  lastShortBreakAtWorkTimeMs: 0,
  lastLongBreakAtWorkTimeMs: 0,
  shortBreakCountToday: 0,
  longBreakCountToday: 0,
  breakCountResetDate: new Date().toISOString().split('T')[0],
  interruptedPhase: null,
  interruptedPhaseRemainingMs: 0,
  interruptedFlowIndex: undefined,
  postponeCountsToday: { ...INITIAL_POSTPONE_COUNTS },
  postponeResetDate: new Date().toISOString().split('T')[0],
  breakSkipCountsToday: { ...INITIAL_BREAK_SKIP_COUNTS },
  isWaitingForNextActivity: false,
  waitingNextPhase: null,
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
  isFocusSessionActive: false,
  activeFocusSessionId: null,
  focusSessionEndsAt: null,
};

// Default general settings
export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  soundEnabled: true,
  soundVolume: 50,
  darkMode: true,
  startMinimized: false,
  startOnLogin: false,
  showNotifications: true,
  simulateMode: false,
  autoIdlePause: false,
  idleThresholdMinutes: 3,
  waterReminderEnabled: false,
  waterReminderIntervalMinutes: 10,
  breakExtendMinutes: 2,
  extendOptions: [2, 5, 10],
  preponeOptions: [1, 2, 5],
  openaiApiKey: '',
  voiceMode: 'off' as const,
  logRetentionDays: 30,
};

// Initial Office Focus Lock state (inactive)
export const INITIAL_OFFICE_FOCUS_LOCK_STATE: OfficeFocusLockState = {
  isActive: false,
  label: '',
  startedAt: null,
  durationMs: 0,
  remainingMs: 0,
  isStrictMode: false,
};

// Office Focus Lock duration presets (in minutes)
export const OFFICE_FOCUS_LOCK_DURATIONS = [30, 60, 90, 120] as const;
