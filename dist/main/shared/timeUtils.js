"use strict";
/**
 * PostureGuard Time Utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentDayOfWeek = getCurrentDayOfWeek;
exports.parseTimeToMinutes = parseTimeToMinutes;
exports.getCurrentTimeMinutes = getCurrentTimeMinutes;
exports.isTimeInRange = isTimeInRange;
exports.formatDuration = formatDuration;
exports.formatDurationHuman = formatDurationHuman;
exports.getTodayDateString = getTodayDateString;
exports.minutesToMs = minutesToMs;
exports.secondsToMs = secondsToMs;
exports.msToMinutes = msToMinutes;
/**
 * Get current day of week
 */
function getCurrentDayOfWeek() {
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return days[new Date().getDay()];
}
/**
 * Parse HH:MM time string to minutes since midnight
 */
function parseTimeToMinutes(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}
/**
 * Get current time as minutes since midnight
 */
function getCurrentTimeMinutes() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
}
/**
 * Check if current time is within schedule window
 * Handles overnight schedules (e.g., 20:00 - 00:00)
 */
function isTimeInRange(startTime, endTime) {
    const start = parseTimeToMinutes(startTime);
    const end = parseTimeToMinutes(endTime);
    const current = getCurrentTimeMinutes();
    if (end > start) {
        // Normal same-day range (e.g., 09:00 - 17:00)
        return current >= start && current < end;
    }
    else {
        // Overnight range (e.g., 20:00 - 00:00)
        return current >= start || current < end;
    }
}
/**
 * Format milliseconds to MM:SS or HH:MM:SS
 */
function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
/**
 * Format milliseconds to human readable string (e.g., "5 min", "1 hr 30 min")
 */
function formatDurationHuman(ms) {
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0 && minutes > 0) {
        return `${hours} hr ${minutes} min`;
    }
    else if (hours > 0) {
        return `${hours} hr`;
    }
    else {
        return `${minutes} min`;
    }
}
/**
 * Get today's date as YYYY-MM-DD string
 */
function getTodayDateString() {
    return new Date().toISOString().split('T')[0];
}
/**
 * Convert minutes to milliseconds
 */
function minutesToMs(minutes) {
    return minutes * 60 * 1000;
}
/**
 * Convert seconds to milliseconds
 */
function secondsToMs(seconds) {
    return seconds * 1000;
}
/**
 * Convert milliseconds to minutes
 */
function msToMinutes(ms) {
    return ms / 60000;
}
//# sourceMappingURL=timeUtils.js.map