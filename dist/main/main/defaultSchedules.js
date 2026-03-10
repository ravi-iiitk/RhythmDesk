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
    const resyNight = {
        id: (0, uuid_1.v4)(),
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
    configService_1.default.saveSchedule(epamDay);
    configService_1.default.saveSchedule(resyNight);
}
//# sourceMappingURL=defaultSchedules.js.map