/**
 * RhythmDesk Constants
 */

// Timer tick interval in milliseconds
export const TIMER_TICK_INTERVAL_MS = 1000;

// Minimum time between phase checks to prevent rapid toggling
export const PHASE_CHECK_DEBOUNCE_MS = 500;

// Overlay window dimensions (will be fullscreen, but used for minimum)
export const OVERLAY_MIN_WIDTH = 800;
export const OVERLAY_MIN_HEIGHT = 600;

// Tray icon update interval
export const TRAY_UPDATE_INTERVAL_MS = 1000;

// Config file paths (relative to app data directory)
export const CONFIG_FILENAME = 'config.json';
export const SESSION_FILENAME = 'session.json';

// Phase display names
export const PHASE_DISPLAY_NAMES: Record<string, string> = {
  'sit': 'Sitting Work',
  'stand': 'Standing Work',
  'sit-to-stand-transition': 'Stand Up',
  'stand-to-sit-transition': 'Sit Down',
  'short-break': 'Short Break',
  'long-break': 'Long Break',
  'idle': 'Idle',
};

// Phase colors for UI
export const PHASE_COLORS: Record<string, string> = {
  'sit': '#3b82f6',      // blue
  'stand': '#22c55e',    // green
  'sit-to-stand-transition': '#f59e0b', // amber
  'stand-to-sit-transition': '#f59e0b', // amber
  'short-break': '#8b5cf6', // purple
  'long-break': '#ec4899',  // pink
  'idle': '#6b7280',        // gray
};

// Day of week display
export const DAY_LABELS: Record<string, string> = {
  'mon': 'Monday',
  'tue': 'Tuesday',
  'wed': 'Wednesday',
  'thu': 'Thursday',
  'fri': 'Friday',
  'sat': 'Saturday',
  'sun': 'Sunday',
};

export const DAY_SHORT_LABELS: Record<string, string> = {
  'mon': 'Mon',
  'tue': 'Tue',
  'wed': 'Wed',
  'thu': 'Thu',
  'fri': 'Fri',
  'sat': 'Sat',
  'sun': 'Sun',
};
