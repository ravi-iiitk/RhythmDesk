/**
 * PostureGuard Default Schedules
 * Creates sample schedules for first-time setup
 */

import { v4 as uuidv4 } from 'uuid';
import { Schedule } from '../shared/types';
import configService from '../core/configService';

/**
 * Create default sample schedules
 */
export function createDefaultSchedules(): void {
  const epamDay: Schedule = {
    id: uuidv4(),
    name: 'EPAM Day',
    enabled: true,
    activeDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    startTime: '08:00',
    endTime: '16:00',
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
    createdAt: Date.now(),
  };

  const resyNight: Schedule = {
    id: uuidv4(),
    name: 'Resy Night',
    enabled: true,
    activeDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    startTime: '20:00',
    endTime: '00:00',
    sitMinutes: 10,
    sitToStandTransitionSeconds: 60,
    standMinutes: 10,
    standToSitTransitionSeconds: 60,
    shortBreakEnabled: true,
    shortBreakEveryMinutes: 50,
    shortBreakDurationMinutes: 5,
    longBreakEnabled: true,
    longBreakEveryMinutes: 120,
    longBreakDurationMinutes: 12,
    strictModeEnabled: true,
    allowPostpone: true,
    postponeOptionsMinutes: [2, 5, 10],
    maxPostponesPerDay: 3,
    lockOverlayInStrictMode: true,
    createdAt: Date.now() + 1, // +1 to ensure EPAM Day has priority
  };

  configService.saveSchedule(epamDay);
  configService.saveSchedule(resyNight);
}
