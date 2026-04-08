/**
 * RhythmDesk Default Schedules
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
    priority: 1,
    sitMinutes: 12,
    standMinutes: 8,
    transitions: {
      sitToStand: {
        durationSeconds: 60,
        strictModeEnabled: true,
        allowPostpone: true,
        allowPause: true,
        postponeOptionsMinutes: [2, 5, 10],
        maxPostponesPerDay: 4,
      },
      standToSit: {
        durationSeconds: 60,
        strictModeEnabled: true,
        allowPostpone: true,
        allowPause: true,
        postponeOptionsMinutes: [2, 5, 10],
        maxPostponesPerDay: 4,
      },
    },
    shortBreak: {
      enabled: true,
      everyMinutes: 60,
      durationMinutes: 5,
      strictModeEnabled: true,
      allowPostpone: true,
      postponeOptionsMinutes: [2, 5, 10],
      maxPostponesPerDay: 4,
    },
    longBreak: {
      enabled: true,
      everyMinutes: 150,
      durationMinutes: 15,
      strictModeEnabled: true,
      allowPostpone: true,
      postponeOptionsMinutes: [2, 5, 10],
      maxPostponesPerDay: 2,
    },
    createdAt: Date.now(),
  };

  const resyNight: Schedule = {
    id: uuidv4(),
    name: 'Resy Night',
    enabled: true,
    activeDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    startTime: '20:00',
    endTime: '00:00',
    priority: 0,
    sitMinutes: 10,
    standMinutes: 10,
    transitions: {
      sitToStand: {
        durationSeconds: 60,
        strictModeEnabled: true,
        allowPostpone: true,
        allowPause: true,
        postponeOptionsMinutes: [2, 5, 10],
        maxPostponesPerDay: 3,
      },
      standToSit: {
        durationSeconds: 60,
        strictModeEnabled: true,
        allowPostpone: true,
        allowPause: true,
        postponeOptionsMinutes: [2, 5, 10],
        maxPostponesPerDay: 3,
      },
    },
    shortBreak: {
      enabled: true,
      everyMinutes: 50,
      durationMinutes: 5,
      strictModeEnabled: true,
      allowPostpone: true,
      postponeOptionsMinutes: [2, 5, 10],
      maxPostponesPerDay: 3,
    },
    longBreak: {
      enabled: true,
      everyMinutes: 120,
      durationMinutes: 12,
      strictModeEnabled: true,
      allowPostpone: true,
      postponeOptionsMinutes: [2, 5, 10],
      maxPostponesPerDay: 2,
    },
    createdAt: Date.now() + 1,
  };

  configService.saveSchedule(epamDay);
  configService.saveSchedule(resyNight);
}
