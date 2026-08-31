/**
 * RhythmDesk Time Utilities
 */

import { DayOfWeek } from './types';

/**
 * Get current day of week
 */
export function getCurrentDayOfWeek(): DayOfWeek {
  const days: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return days[new Date().getDay()];
}

/**
 * Parse HH:MM time string to minutes since midnight
 */
export function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Get current time as minutes since midnight
 */
export function getCurrentTimeMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Check if current time is within schedule window
 * Handles overnight schedules (e.g., 20:00 - 00:00)
 */
export function isTimeInRange(startTime: string, endTime: string): boolean {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  const current = getCurrentTimeMinutes();
  
  if (end > start) {
    // Normal same-day range (e.g., 09:00 - 17:00)
    return current >= start && current < end;
  } else {
    // Overnight range (e.g., 20:00 - 00:00)
    return current >= start || current < end;
  }
}

/**
 * Format milliseconds to MM:SS or HH:MM:SS
 */
export function formatDuration(ms: number): string {
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
export function formatDurationHuman(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  // Sub-minute durations (e.g. a 30-second transition) would otherwise floor to
  // "0 min", which reads as "no time at all" instead of the actual short duration.
  if (hours === 0 && minutes === 0) {
    const seconds = Math.max(0, Math.round(ms / 1000));
    return `${seconds} sec`;
  }
  
  if (hours > 0 && minutes > 0) {
    return `${hours} hr ${minutes} min`;
  } else if (hours > 0) {
    return `${hours} hr`;
  } else {
    return `${minutes} min`;
  }
}

/**
 * Get today's date as YYYY-MM-DD string
 */
export function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Convert minutes to milliseconds
 */
export function minutesToMs(minutes: number): number {
  return minutes * 60 * 1000;
}

/**
 * Convert seconds to milliseconds
 */
export function secondsToMs(seconds: number): number {
  return seconds * 1000;
}

/**
 * Convert milliseconds to minutes
 */
export function msToMinutes(ms: number): number {
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
export function elapsedSince(startTimestamp: number): number {
  if (startTimestamp <= 0) return 0;
  const now = Date.now();
  return Math.max(0, now - startTimestamp);
}

/**
 * Calculate remaining time until an end timestamp
 * Returns 0 if endTimestamp is 0 or in the past
 */
export function remainingUntil(endTimestamp: number): number {
  if (endTimestamp <= 0) return 0;
  const now = Date.now();
  return Math.max(0, endTimestamp - now);
}

/**
 * Check if a timestamp has passed
 */
export function hasTimePassed(timestamp: number): boolean {
  if (timestamp <= 0) return false;
  return Date.now() >= timestamp;
}

/**
 * Calculate phase end timestamp from start and duration
 */
export function calculatePhaseEnd(startTimestamp: number, durationMs: number): number {
  return startTimestamp + durationMs;
}

/**
 * Get time since last event (for break triggers)
 * Returns time in milliseconds
 */
export function timeSinceEvent(eventTimestamp: number): number {
  if (eventTimestamp <= 0) return Infinity;
  return Math.max(0, Date.now() - eventTimestamp);
}

/**
 * Check if enough time has elapsed for a threshold
 * Used for break triggers based on cumulative work time
 */
export function hasThresholdPassed(
  currentValue: number,
  lastTriggerValue: number,
  threshold: number
): boolean {
  return (currentValue - lastTriggerValue) >= threshold;
}

/**
 * Calculate adjusted phase remaining after pause/resume
 * When resuming from pause, we need to recalculate phaseEndsAt
 */
export function adjustPhaseEndAfterPause(
  pausedAt: number,
  phaseEndsAt: number
): number {
  if (pausedAt <= 0 || phaseEndsAt <= 0) return phaseEndsAt;
  const now = Date.now();
  const pauseDuration = now - pausedAt;
  return phaseEndsAt + pauseDuration;
}
