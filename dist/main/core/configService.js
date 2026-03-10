"use strict";
/**
 * RhythmDesk Config Service
 * Handles local JSON persistence with abstraction for future SQLite migration
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.configService = exports.JsonStorageProvider = void 0;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const types_1 = require("../shared/types");
const constants_1 = require("../shared/constants");
/**
 * Migrate legacy schedule format to new per-break config format
 */
function migrateSchedule(schedule) {
    // If already migrated (has transitions object), return as-is with defaults merged
    if (schedule.transitions && schedule.shortBreak && schedule.longBreak) {
        return {
            ...schedule,
            priority: schedule.priority ?? 0,
        };
    }
    // Migrate from legacy flat fields to new nested structure
    const legacyStrictMode = schedule.strictModeEnabled ?? true;
    const legacyAllowPostpone = schedule.allowPostpone ?? true;
    const legacyPostponeOptions = schedule.postponeOptionsMinutes ?? [2, 5, 10];
    const legacyMaxPostpones = schedule.maxPostponesPerDay ?? 4;
    return {
        id: schedule.id,
        name: schedule.name,
        enabled: schedule.enabled ?? true,
        activeDays: schedule.activeDays ?? ['mon', 'tue', 'wed', 'thu', 'fri'],
        startTime: schedule.startTime ?? '09:00',
        endTime: schedule.endTime ?? '17:00',
        priority: schedule.priority ?? 0,
        sitMinutes: schedule.sitMinutes ?? 12,
        standMinutes: schedule.standMinutes ?? 8,
        transitions: {
            sitToStand: {
                durationSeconds: schedule.sitToStandTransitionSeconds ?? types_1.DEFAULT_TRANSITION_CONFIG.durationSeconds,
                strictModeEnabled: legacyStrictMode,
                allowPostpone: legacyAllowPostpone,
                postponeOptionsMinutes: [...legacyPostponeOptions],
                maxPostponesPerDay: legacyMaxPostpones,
            },
            standToSit: {
                durationSeconds: schedule.standToSitTransitionSeconds ?? types_1.DEFAULT_TRANSITION_CONFIG.durationSeconds,
                strictModeEnabled: legacyStrictMode,
                allowPostpone: legacyAllowPostpone,
                postponeOptionsMinutes: [...legacyPostponeOptions],
                maxPostponesPerDay: legacyMaxPostpones,
            },
        },
        shortBreak: {
            enabled: schedule.shortBreakEnabled ?? types_1.DEFAULT_SHORT_BREAK_CONFIG.enabled,
            everyMinutes: schedule.shortBreakEveryMinutes ?? types_1.DEFAULT_SHORT_BREAK_CONFIG.everyMinutes,
            durationMinutes: schedule.shortBreakDurationMinutes ?? types_1.DEFAULT_SHORT_BREAK_CONFIG.durationMinutes,
            strictModeEnabled: legacyStrictMode,
            allowPostpone: legacyAllowPostpone,
            postponeOptionsMinutes: [...legacyPostponeOptions],
            maxPostponesPerDay: legacyMaxPostpones,
        },
        longBreak: {
            enabled: schedule.longBreakEnabled ?? types_1.DEFAULT_LONG_BREAK_CONFIG.enabled,
            everyMinutes: schedule.longBreakEveryMinutes ?? types_1.DEFAULT_LONG_BREAK_CONFIG.everyMinutes,
            durationMinutes: schedule.longBreakDurationMinutes ?? types_1.DEFAULT_LONG_BREAK_CONFIG.durationMinutes,
            strictModeEnabled: legacyStrictMode,
            allowPostpone: legacyAllowPostpone,
            postponeOptionsMinutes: [...legacyPostponeOptions],
            maxPostponesPerDay: Math.max(1, Math.floor(legacyMaxPostpones / 2)), // Fewer for long breaks
        },
        createdAt: schedule.createdAt,
    };
}
/**
 * Migrate legacy session state to new format
 */
function migrateSessionState(state) {
    // Convert legacy single postponeCountToday to per-break counts
    const legacyCount = state.postponeCountToday ?? 0;
    const postponeCountsToday = state.postponeCountsToday ?? {
        sitToStandTransition: legacyCount,
        standToSitTransition: 0,
        shortBreak: 0,
        longBreak: 0,
    };
    return {
        activeScheduleId: state.activeScheduleId ?? null,
        currentPhase: state.currentPhase ?? 'idle',
        phaseStartedAt: state.phaseStartedAt ?? 0,
        phaseEndsAt: state.phaseEndsAt ?? 0,
        phaseRemainingMs: state.phaseRemainingMs ?? 0,
        phaseTotalMs: state.phaseTotalMs ?? 0,
        cumulativeWorkTimeMs: state.cumulativeWorkTimeMs ?? 0,
        lastShortBreakAtWorkTimeMs: state.lastShortBreakAtWorkTimeMs ?? 0,
        lastLongBreakAtWorkTimeMs: state.lastLongBreakAtWorkTimeMs ?? 0,
        shortBreakCountToday: state.shortBreakCountToday ?? 0,
        longBreakCountToday: state.longBreakCountToday ?? 0,
        breakCountResetDate: state.breakCountResetDate ?? new Date().toISOString().split('T')[0],
        interruptedPhase: state.interruptedPhase ?? null,
        interruptedPhaseRemainingMs: state.interruptedPhaseRemainingMs ?? 0,
        postponeCountsToday,
        postponeResetDate: state.postponeResetDate ?? new Date().toISOString().split('T')[0],
        isPaused: state.isPaused ?? false,
        pausedAt: state.pausedAt ?? null,
        pauseResumeAt: state.pauseResumeAt ?? null,
        isPostponed: state.isPostponed ?? false,
        postponedUntil: state.postponedUntil ?? null,
        postponedPhase: state.postponedPhase ?? null,
        postponedBreakType: state.postponedBreakType ?? null,
        prePostponeWorkPhase: state.prePostponeWorkPhase ?? null,
        prePostponeWorkPhaseRemainingMs: state.prePostponeWorkPhaseRemainingMs ?? 0,
        currentFlowStepIndex: state.currentFlowStepIndex,
        flowConfigHash: state.flowConfigHash,
    };
}
/**
 * JSON File Storage Provider
 * Stores all config in a single JSON file
 */
class JsonStorageProvider {
    constructor() {
        this.configPath = '';
        this.config = null;
        this.initialized = false;
    }
    ensureInitialized() {
        if (this.initialized)
            return;
        const userDataPath = electron_1.app.getPath('userData');
        this.configPath = path.join(userDataPath, constants_1.CONFIG_FILENAME);
        this.config = this.loadFromDisk();
        this.initialized = true;
    }
    getConfig() {
        this.ensureInitialized();
        return this.config;
    }
    getDefaultConfig() {
        return {
            schedules: [],
            generalSettings: { ...types_1.DEFAULT_GENERAL_SETTINGS },
            sessionState: { ...types_1.INITIAL_SESSION_STATE },
        };
    }
    loadFromDisk() {
        try {
            if (this.configPath && fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf-8');
                const parsed = JSON.parse(data);
                // Migrate schedules to new format
                const schedules = (parsed.schedules || []).map((s) => migrateSchedule(s));
                // Migrate session state to new format
                const sessionState = migrateSessionState(parsed.sessionState || {});
                // Merge general settings with defaults
                const generalSettings = { ...types_1.DEFAULT_GENERAL_SETTINGS, ...parsed.generalSettings };
                return { schedules, generalSettings, sessionState };
            }
        }
        catch (error) {
            console.error('Failed to load config from disk:', error);
        }
        return this.getDefaultConfig();
    }
    saveToDisk() {
        try {
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
        }
        catch (error) {
            console.error('Failed to save config to disk:', error);
        }
    }
    load() {
        return this.getConfig();
    }
    save(config) {
        this.ensureInitialized();
        this.config = config;
        this.saveToDisk();
    }
    getSchedules() {
        return this.getConfig().schedules;
    }
    saveSchedule(schedule) {
        const cfg = this.getConfig();
        const index = cfg.schedules.findIndex((s) => s.id === schedule.id);
        if (index >= 0) {
            cfg.schedules[index] = schedule;
        }
        else {
            cfg.schedules.push(schedule);
        }
        this.saveToDisk();
    }
    deleteSchedule(id) {
        const cfg = this.getConfig();
        cfg.schedules = cfg.schedules.filter((s) => s.id !== id);
        this.saveToDisk();
    }
    getSessionState() {
        return this.getConfig().sessionState;
    }
    saveSessionState(state) {
        this.getConfig().sessionState = state;
        this.saveToDisk();
    }
    getGeneralSettings() {
        return this.getConfig().generalSettings;
    }
    saveGeneralSettings(settings) {
        this.getConfig().generalSettings = settings;
        this.saveToDisk();
    }
}
exports.JsonStorageProvider = JsonStorageProvider;
/**
 * Config Service singleton
 * Provides high-level access to configuration with storage abstraction
 */
class ConfigService {
    constructor() {
        this.storage = new JsonStorageProvider();
    }
    static getInstance() {
        if (!ConfigService.instance) {
            ConfigService.instance = new ConfigService();
        }
        return ConfigService.instance;
    }
    // Allow swapping storage provider for future SQLite migration
    setStorageProvider(provider) {
        this.storage = provider;
    }
    getConfig() {
        return this.storage.load();
    }
    saveConfig(config) {
        this.storage.save(config);
    }
    getSchedules() {
        return this.storage.getSchedules();
    }
    getScheduleById(id) {
        return this.storage.getSchedules().find((s) => s.id === id);
    }
    saveSchedule(schedule) {
        this.storage.saveSchedule(schedule);
    }
    deleteSchedule(id) {
        this.storage.deleteSchedule(id);
    }
    getSessionState() {
        return this.storage.getSessionState();
    }
    saveSessionState(state) {
        this.storage.saveSessionState(state);
    }
    getGeneralSettings() {
        return this.storage.getGeneralSettings();
    }
    saveGeneralSettings(settings) {
        this.storage.saveGeneralSettings(settings);
    }
}
exports.configService = ConfigService.getInstance();
exports.default = exports.configService;
//# sourceMappingURL=configService.js.map