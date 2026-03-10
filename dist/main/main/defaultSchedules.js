"use strict";
/**
 * RhythmDesk Default Schedules
 * Creates sample schedules for first-time setup
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultSchedules = createDefaultSchedules;
const uuid_1 = require("uuid");
const configService_1 = __importDefault(require("../core/configService"));
/**
 * Create default sample schedules
 */
function createDefaultSchedules() {
    const epamDay = {
        id: (0, uuid_1.v4)(),
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
                postponeOptionsMinutes: [2, 5, 10],
                maxPostponesPerDay: 4,
            },
            standToSit: {
                durationSeconds: 60,
                strictModeEnabled: true,
                allowPostpone: true,
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
    const resyNight = {
        id: (0, uuid_1.v4)(),
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
                postponeOptionsMinutes: [2, 5, 10],
                maxPostponesPerDay: 3,
            },
            standToSit: {
                durationSeconds: 60,
                strictModeEnabled: true,
                allowPostpone: true,
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
    configService_1.default.saveSchedule(epamDay);
    configService_1.default.saveSchedule(resyNight);
}
//# sourceMappingURL=defaultSchedules.js.map