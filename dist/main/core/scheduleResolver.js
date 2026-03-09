"use strict";
/**
 * PostureGuard Schedule Resolver
 * Determines which schedule should be active based on current time and day
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isScheduleActiveNow = isScheduleActiveNow;
exports.resolveActiveSchedule = resolveActiveSchedule;
exports.getSchedulesActiveAt = getSchedulesActiveAt;
exports.schedulesOverlap = schedulesOverlap;
exports.getNextScheduleStart = getNextScheduleStart;
const timeUtils_1 = require("../shared/timeUtils");
/**
 * Check if a schedule should be active right now
 */
function isScheduleActiveNow(schedule) {
    if (!schedule.enabled) {
        return false;
    }
    const currentDay = (0, timeUtils_1.getCurrentDayOfWeek)();
    if (!schedule.activeDays.includes(currentDay)) {
        return false;
    }
    return (0, timeUtils_1.isTimeInRange)(schedule.startTime, schedule.endTime);
}
/**
 * Resolve which schedule should be active
 * Priority: earliest created active schedule wins if multiple overlap
 */
function resolveActiveSchedule(schedules) {
    const activeSchedules = schedules
        .filter(isScheduleActiveNow)
        .sort((a, b) => a.createdAt - b.createdAt);
    return activeSchedules.length > 0 ? activeSchedules[0] : null;
}
/**
 * Get all schedules that would be active at a given time/day
 * Useful for detecting conflicts in UI
 */
function getSchedulesActiveAt(schedules, day, timeMinutes) {
    return schedules.filter((schedule) => {
        if (!schedule.enabled)
            return false;
        if (!schedule.activeDays.includes(day))
            return false;
        const startMinutes = parseTimeToMinutes(schedule.startTime);
        const endMinutes = parseTimeToMinutes(schedule.endTime);
        if (endMinutes > startMinutes) {
            // Same day range
            return timeMinutes >= startMinutes && timeMinutes < endMinutes;
        }
        else {
            // Overnight range
            return timeMinutes >= startMinutes || timeMinutes < endMinutes;
        }
    });
}
/**
 * Parse HH:MM to minutes (duplicated here to avoid circular deps)
 */
function parseTimeToMinutes(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}
/**
 * Check if two schedules have overlapping time windows on any shared day
 */
function schedulesOverlap(a, b) {
    const sharedDays = a.activeDays.filter((day) => b.activeDays.includes(day));
    if (sharedDays.length === 0)
        return false;
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
function getNextScheduleStart(schedule) {
    if (!schedule.enabled)
        return null;
    const now = new Date();
    const currentDay = (0, timeUtils_1.getCurrentDayOfWeek)();
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
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
//# sourceMappingURL=scheduleResolver.js.map