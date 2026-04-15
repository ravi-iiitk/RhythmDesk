/**
 * RhythmDesk Default Schedules
 * Creates sample schedules for first-time setup
 */

import { v4 as uuidv4 } from 'uuid';
import { Schedule } from '../shared/types';
import configService from '../core/configService';

/**
 * Create default sample schedules
 * One rule-based example and one flow-based example
 */
export function createDefaultSchedules(): void {
  // Example 1: Rule-based schedule for typical work day
  const weekdayWork: Schedule = {
    id: uuidv4(),
    name: 'Weekday Work (Example)',
    enabled: false, // Disabled by default so users can customize first
    activeDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    startTime: '09:00',
    endTime: '17:00',
    priority: 1,
    mode: 'rule-based',
    sitMinutes: 25,
    standMinutes: 10,
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
      strictModeEnabled: false,
      allowPostpone: true,
      postponeOptionsMinutes: [2, 5, 10],
      maxPostponesPerDay: 4,
    },
    longBreak: {
      enabled: true,
      everyMinutes: 120,
      durationMinutes: 15,
      strictModeEnabled: false,
      allowPostpone: true,
      postponeOptionsMinutes: [5, 10, 15],
      maxPostponesPerDay: 2,
    },
    createdAt: Date.now(),
  };

  // Example 2: Flow-based schedule for focused work sessions
  const focusSession: Schedule = {
    id: uuidv4(),
    name: 'Focus Session (Example)',
    enabled: false, // Disabled by default
    activeDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    startTime: '10:00',
    endTime: '18:00',
    priority: 0,
    mode: 'flow-based',
    // Flow-based: explicit step sequence (sitMinutes/standMinutes not used but required by type)
    sitMinutes: 25,
    standMinutes: 15,
    flowSteps: [
      { id: uuidv4(), type: 'sit', durationSeconds: 25 * 60 },
      { id: uuidv4(), type: 'sit-to-stand-transition', durationSeconds: 60 },
      { id: uuidv4(), type: 'stand', durationSeconds: 15 * 60 },
      { id: uuidv4(), type: 'stand-to-sit-transition', durationSeconds: 60 },
      { id: uuidv4(), type: 'short-break', durationSeconds: 5 * 60 },
    ],
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
      enabled: false, // Flow-based uses flowSteps for breaks
      everyMinutes: 60,
      durationMinutes: 5,
      strictModeEnabled: false,
      allowPostpone: true,
      postponeOptionsMinutes: [2, 5, 10],
      maxPostponesPerDay: 3,
    },
    longBreak: {
      enabled: false,
      everyMinutes: 120,
      durationMinutes: 15,
      strictModeEnabled: false,
      allowPostpone: true,
      postponeOptionsMinutes: [5, 10, 15],
      maxPostponesPerDay: 2,
    },
    createdAt: Date.now() + 1,
  };

  configService.saveSchedule(weekdayWork);
  configService.saveSchedule(focusSession);
}
