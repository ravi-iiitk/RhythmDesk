/**
 * PostureGuard Shared Types
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
  | 'idle';

// Schedule configuration
export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  activeDays: DayOfWeek[];
  startTime: string; // HH:MM format
  endTime: string;   // HH:MM format, can be next day if < startTime
  
  // Cycle configuration (in minutes/seconds as specified)
  sitMinutes: number;
  sitToStandTransitionSeconds: number;
  standMinutes: number;
  standToSitTransitionSeconds: number;
  
  // Short break configuration
  shortBreakEnabled: boolean;
  shortBreakEveryMinutes: number;
  shortBreakDurationMinutes: number;
  
  // Long break configuration
  longBreakEnabled: boolean;
  longBreakEveryMinutes: number;
  longBreakDurationMinutes: number;
  
  // Strict mode configuration
  strictModeEnabled: boolean;
  allowPostpone: boolean;
  postponeOptionsMinutes: number[];
  maxPostponesPerDay: number;
  lockOverlayInStrictMode: boolean;
  
  // Metadata
  createdAt: number; // timestamp for priority ordering
}

// Current session state - persisted to survive restarts
export interface SessionState {
  activeScheduleId: string | null;
  currentPhase: PhaseType;
  phaseStartedAt: number;        // timestamp when current phase started
  phaseEndsAt: number;           // timestamp when current phase should end
  phaseRemainingMs: number;      // remaining time in current phase (derived from phaseEndsAt)
  phaseTotalMs: number;          // total duration of current phase
  
  // Cumulative active work time (sit + stand only, not transitions/breaks)
  cumulativeWorkTimeMs: number;
  
  // Break tracking based on cumulative work time
  lastShortBreakAtWorkTimeMs: number;
  lastLongBreakAtWorkTimeMs: number;
  
  // Postpone tracking for current day
  postponeCountToday: number;
  postponeResetDate: string; // YYYY-MM-DD format
  
  // Pause state
  isPaused: boolean;
  pausedAt: number | null;
  pauseResumeAt: number | null;  // null = manual resume required
  
  // Postpone state
  isPostponed: boolean;
  postponedUntil: number | null;
  postponedPhase: PhaseType | null; // the phase that was postponed
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
}

// Office Focus Lock state - runtime only, not persisted across restarts
// Manual mode for enforcing fullscreen overlay during work phases
export interface OfficeFocusLockState {
  isActive: boolean;
  label: string;                 // Work label (e.g., "EPAM", "Resy", custom)
  startedAt: number | null;      // timestamp when lock started
  durationMs: number;            // total duration in milliseconds
  remainingMs: number;           // remaining time
}

// Preset work labels for Office Focus Lock
export const OFFICE_FOCUS_LABELS = ['EPAM', 'Resy'] as const;
export type OfficeFocusLabel = typeof OFFICE_FOCUS_LABELS[number] | string;

// Timer tick event sent to renderer
export interface TimerTick {
  scheduleId: string | null;
  scheduleName: string | null;
  currentPhase: PhaseType;
  phaseRemainingMs: number;
  phaseTotalMs: number;
  nextPhase: PhaseType;
  cumulativeWorkTimeMs: number;
  isPaused: boolean;
  isPostponed: boolean;
  postponeCountToday: number;
  maxPostponesPerDay: number;
  canPostpone: boolean;
  postponeOptions: number[];
  isStrictMode: boolean;
  // Office Focus Lock state
  officeFocusLock: OfficeFocusLockState;
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
  
  // Office Focus Lock controls
  START_OFFICE_FOCUS_LOCK: 'officeFocusLock:start',
  STOP_OFFICE_FOCUS_LOCK: 'officeFocusLock:stop',
  GET_OFFICE_FOCUS_LOCK_STATE: 'officeFocusLock:getState',
  
  // Window controls
  OPEN_SETTINGS: 'window:openSettings',
  CLOSE_OVERLAY: 'overlay:close',
  MINIMIZE_TO_TRAY: 'window:minimizeToTray',
  QUIT_APP: 'app:quit',
} as const;

// Default values for new schedules
export const DEFAULT_SCHEDULE: Omit<Schedule, 'id' | 'name' | 'createdAt'> = {
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
export const INITIAL_SESSION_STATE: SessionState = {
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
export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  soundEnabled: true,
  soundVolume: 50,
  darkMode: true,
  startMinimized: false,
  startOnLogin: false,
  showNotifications: true,
};

// Initial Office Focus Lock state (inactive)
export const INITIAL_OFFICE_FOCUS_LOCK_STATE: OfficeFocusLockState = {
  isActive: false,
  label: '',
  startedAt: null,
  durationMs: 0,
  remainingMs: 0,
};

// Office Focus Lock duration presets (in minutes)
export const OFFICE_FOCUS_LOCK_DURATIONS = [30, 60, 90, 120] as const;
