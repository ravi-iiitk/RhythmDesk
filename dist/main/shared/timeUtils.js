"use strict";
/**
 * RhythmDesk Time Utilities
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
exports.elapsedSince = elapsedSince;
exports.remainingUntil = remainingUntil;
exports.hasTimePassed = hasTimePassed;
exports.calculatePhaseEnd = calculatePhaseEnd;
exports.timeSinceEvent = timeSinceEvent;
exports.hasThresholdPassed = hasThresholdPassed;
exports.adjustPhaseEndAfterPause = adjustPhaseEndAfterPause;
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
// ============================================================================
// TIMESTAMP-BASED CALCULATIONS
// These functions use timestamps for accurate duration tracking
// They avoid fragile assumptions like relying on tick counts
// ============================================================================
/**
 * Calculate elapsed time from a start timestamp
 * Returns 0 if startTimestamp is 0 or in the future
 */
function elapsedSince(startTimestamp) {
    if (startTimestamp <= 0)
        return 0;
    const now = Date.now();
    return Math.max(0, now - startTimestamp);
}
/**
 * Calculate remaining time until an end timestamp
 * Returns 0 if endTimestamp is 0 or in the past
 */
function remainingUntil(endTimestamp) {
    if (endTimestamp <= 0)
        return 0;
    const now = Date.now();
    return Math.max(0, endTimestamp - now);
}
/**
 * Check if a timestamp has passed
 */
function hasTimePassed(timestamp) {
    if (timestamp <= 0)
        return false;
    return Date.now() >= timestamp;
}
/**
 * Calculate phase end timestamp from start and duration
 */
function calculatePhaseEnd(startTimestamp, durationMs) {
    return startTimestamp + durationMs;
}
/**
 * Get time since last event (for break triggers)
 * Returns time in milliseconds
 */
function timeSinceEvent(eventTimestamp) {
    if (eventTimestamp <= 0)
        return Infinity;
    return Math.max(0, Date.now() - eventTimestamp);
}
/**
 * Check if enough time has elapsed for a threshold
 * Used for break triggers based on cumulative work time
 */
function hasThresholdPassed(currentValue, lastTriggerValue, threshold) {
    return (currentValue - lastTriggerValue) >= threshold;
}
/**
 * Calculate adjusted phase remaining after pause/resume
 * When resuming from pause, we need to recalculate phaseEndsAt
 */
function adjustPhaseEndAfterPause(pausedAt, phaseEndsAt) {
    if (pausedAt <= 0 || phaseEndsAt <= 0)
        return phaseEndsAt;
    const now = Date.now();
    const pauseDuration = now - pausedAt;
    return phaseEndsAt + pauseDuration;
}
//# sourceMappingURL=timeUtils.js.map