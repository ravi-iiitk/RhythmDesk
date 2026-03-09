/**
 * RhythmDesk Schedule Resolver
 * Determines which schedule should be active based on current time and day
 */

import { Schedule, DayOfWeek } from '../shared/types';
import { getCurrentDayOfWeek, isTimeInRange } from '../shared/timeUtils';

/**
 * Check if a schedule should be active right now
 */
export function isScheduleActiveNow(schedule: Schedule): boolean {
  if (!schedule.enabled) {
    return false;
  }

  const currentDay = getCurrentDayOfWeek();
  if (!schedule.activeDays.includes(currentDay)) {
    return false;
  }

  return isTimeInRange(schedule.startTime, schedule.endTime);
}

/**
 * Resolve which schedule should be active
 * Priority: earliest created active schedule wins if multiple overlap
 */
export function resolveActiveSchedule(schedules: Schedule[]): Schedule | null {
  const activeSchedules = schedules
    .filter(isScheduleActiveNow)
    .sort((a, b) => a.createdAt - b.createdAt);

  return activeSchedules.length > 0 ? activeSchedules[0] : null;
}

/**
 * Get all schedules that would be active at a given time/day
 * Useful for detecting conflicts in UI
 */
export function getSchedulesActiveAt(
  schedules: Schedule[],
  day: DayOfWeek,
  timeMinutes: number
): Schedule[] {
  return schedules.filter((schedule) => {
    if (!schedule.enabled) return false;
    if (!schedule.activeDays.includes(day)) return false;

    const startMinutes = parseTimeToMinutes(schedule.startTime);
    const endMinutes = parseTimeToMinutes(schedule.endTime);

    if (endMinutes > startMinutes) {
      // Same day range
      return timeMinutes >= startMinutes && timeMinutes < endMinutes;
    } else {
      // Overnight range
      return timeMinutes >= startMinutes || timeMinutes < endMinutes;
    }
  });
}

/**
 * Parse HH:MM to minutes (duplicated here to avoid circular deps)
 */
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Check if two schedules have overlapping time windows on any shared day
 */
export function schedulesOverlap(a: Schedule, b: Schedule): boolean {
  const sharedDays = a.activeDays.filter((day) => b.activeDays.includes(day));
  if (sharedDays.length === 0) return false;

  const aStart = parseTimeToMinutes(a.startTime);
  const aEnd = parseTimeToMinutes(a.endTime);
  const bStart = parseTimeToMinutes(b.startTime);
  const bEnd = parseTimeToMinutes(b.endTime);

  // Normalize overnight schedules
  const aRanges = aEnd > aStart 
    ? [[aStart, aEnd]] 
    : [[aStart, 24 * 60], [0, aEnd]];
  const bRanges = bEnd > bStart 
    ? [[bStart, bEnd]] 
    : [[bStart, 24 * 60], [0, bEnd]];

  // Check if any ranges overlap
  for (const aRange of aRanges) {
    for (const bRange of bRanges) {
      if (aRange[0] < bRange[1] && bRange[0] < aRange[1]) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get the next scheduled start time for a schedule
 * Returns null if schedule is not enabled or has no upcoming active times
 */
export function getNextScheduleStart(schedule: Schedule): Date | null {
  if (!schedule.enabled) return null;

  const now = new Date();
  const currentDay = getCurrentDayOfWeek();
  const days: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const currentDayIndex = days.indexOf(currentDay);

  const [startHours, startMinutes] = schedule.startTime.split(':').map(Number);

  // Check next 7 days
  for (let offset = 0; offset < 7; offset++) {
    const checkDayIndex = (currentDayIndex + offset) % 7;
    const checkDay = days[checkDayIndex];

    if (schedule.activeDays.includes(checkDay)) {
      const nextStart = new Date(now);
      nextStart.setDate(now.getDate() + offset);
      nextStart.setHours(startHours, startMinutes, 0, 0);

      if (nextStart > now) {
        return nextStart;
      }
    }
  }

  return null;
}
