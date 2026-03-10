"use strict";
/**
 * RhythmDesk Constants
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAY_SHORT_LABELS = exports.DAY_LABELS = exports.PHASE_COLORS = exports.PHASE_DISPLAY_NAMES = exports.SESSION_FILENAME = exports.CONFIG_FILENAME = exports.TRAY_UPDATE_INTERVAL_MS = exports.OVERLAY_MIN_HEIGHT = exports.OVERLAY_MIN_WIDTH = exports.PHASE_CHECK_DEBOUNCE_MS = exports.SIMULATE_MODE_SPEED = exports.TIMER_TICK_INTERVAL_MS = void 0;
// Timer tick interval in milliseconds
exports.TIMER_TICK_INTERVAL_MS = 1000;
// Simulate mode speed multiplier (1 minute real = 2 seconds simulated)
exports.SIMULATE_MODE_SPEED = 30; // 30x speed (1 min = 2 sec)
// Minimum time between phase checks to prevent rapid toggling
exports.PHASE_CHECK_DEBOUNCE_MS = 500;
// Overlay window dimensions (will be fullscreen, but used for minimum)
exports.OVERLAY_MIN_WIDTH = 800;
exports.OVERLAY_MIN_HEIGHT = 600;
// Tray icon update interval
exports.TRAY_UPDATE_INTERVAL_MS = 1000;
// Config file paths (relative to app data directory)
exports.CONFIG_FILENAME = 'config.json';
exports.SESSION_FILENAME = 'session.json';
// Phase display names
exports.PHASE_DISPLAY_NAMES = {
    'sit': 'Sitting Work',
    'stand': 'Standing Work',
    'sit-to-stand-transition': 'Stand Up',
    'stand-to-sit-transition': 'Sit Down',
    'short-break': 'Short Break',
    'long-break': 'Long Break',
    'idle': 'Idle',
};
// Phase colors for UI
exports.PHASE_COLORS = {
    'sit': '#3b82f6', // blue
    'stand': '#22c55e', // green
    'sit-to-stand-transition': '#f59e0b', // amber
    'stand-to-sit-transition': '#f59e0b', // amber
    'short-break': '#8b5cf6', // purple
    'long-break': '#ec4899', // pink
    'idle': '#6b7280', // gray
};
// Day of week display
exports.DAY_LABELS = {
    'mon': 'Monday',
    'tue': 'Tuesday',
    'wed': 'Wednesday',
    'thu': 'Thursday',
    'fri': 'Friday',
    'sat': 'Saturday',
    'sun': 'Sunday',
};
exports.DAY_SHORT_LABELS = {
    'mon': 'Mon',
    'tue': 'Tue',
    'wed': 'Wed',
    'thu': 'Thu',
    'fri': 'Fri',
    'sat': 'Sat',
    'sun': 'Sun',
};
//# sourceMappingURL=constants.js.map