"use strict";
/**
 * ConfigStore - Durable Configuration Storage
 *
 * Uses electron-store for persistent configuration that survives app restarts.
 * This is for USER CONFIGURATION only, not runtime session state.
 *
 * Stores:
 * - schedules: User-defined work/break schedules
 * - generalSettings: App preferences (sound, theme, startup)
 * - restBlockPresets: Custom rest block presets
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configStore = void 0;
const electron_store_1 = __importDefault(require("electron-store"));
const types_1 = require("../../shared/types");
const logger_1 = __importDefault(require("../logger"));
// Current schema version - increment when making breaking changes
const CURRENT_SCHEMA_VERSION = 1;
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
    const legacyMaxSkips = schedule.maxSkipsPerDay ?? 2;
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
            maxSkipsPerDay: legacyMaxSkips,
        },
        longBreak: {
            enabled: schedule.longBreakEnabled ?? types_1.DEFAULT_LONG_BREAK_CONFIG.enabled,
            everyMinutes: schedule.longBreakEveryMinutes ?? types_1.DEFAULT_LONG_BREAK_CONFIG.everyMinutes,
            durationMinutes: schedule.longBreakDurationMinutes ?? types_1.DEFAULT_LONG_BREAK_CONFIG.durationMinutes,
            strictModeEnabled: legacyStrictMode,
            allowPostpone: legacyAllowPostpone,
            postponeOptionsMinutes: [...legacyPostponeOptions],
            maxPostponesPerDay: Math.max(1, Math.floor(legacyMaxPostpones / 2)),
            maxSkipsPerDay: Math.max(0, Math.floor(legacyMaxSkips / 2)),
        },
        createdAt: schedule.createdAt,
    };
}
/**
 * ConfigStore class - singleton for durable configuration
 */
class ConfigStore {
    constructor() {
        this.store = new electron_store_1.default({
            name: 'config',
            defaults: {
                schedules: [],
                generalSettings: { ...types_1.DEFAULT_GENERAL_SETTINGS },
                restBlockPresets: [...types_1.DEFAULT_REST_BLOCK_PRESETS],
                schemaVersion: CURRENT_SCHEMA_VERSION,
            },
            // Migrations for future schema changes
            migrations: {
                '>=1.0.0': (store) => {
                    // Future migrations go here
                    store.set('schemaVersion', CURRENT_SCHEMA_VERSION);
                },
            },
        });
        logger_1.default.info('ConfigStore', 'Initialized', {
            path: this.store.path,
            schemaVersion: this.store.get('schemaVersion'),
        });
    }
    static getInstance() {
        if (!ConfigStore.instance) {
            ConfigStore.instance = new ConfigStore();
        }
        return ConfigStore.instance;
    }
    // For testing - reset singleton
    static resetInstance() {
        ConfigStore.instance = null;
    }
    getStorePath() {
        return this.store.path;
    }
    // ===== Schedules =====
    getSchedules() {
        return this.store.get('schedules');
    }
    getScheduleById(id) {
        return this.getSchedules().find(s => s.id === id);
    }
    saveSchedule(schedule) {
        // Normalize flow-based schedules to always start with a work phase
        if (schedule.mode === 'flow-based' && schedule.flowSteps && schedule.flowSteps.length > 0) {
            const firstStep = schedule.flowSteps[0];
            if (firstStep.type !== 'sit' && firstStep.type !== 'stand') {
                const workIndex = schedule.flowSteps.findIndex(s => s.type === 'sit' || s.type === 'stand');
                if (workIndex > 0) {
                    schedule.flowSteps = [
                        ...schedule.flowSteps.slice(workIndex),
                        ...schedule.flowSteps.slice(0, workIndex)
                    ];
                }
            }
        }
        const schedules = this.getSchedules();
        const index = schedules.findIndex(s => s.id === schedule.id);
        if (index >= 0) {
            schedules[index] = schedule;
        }
        else {
            schedules.push(schedule);
        }
        this.store.set('schedules', schedules);
        logger_1.default.debug('ConfigStore', 'Schedule saved', { id: schedule.id, name: schedule.name });
    }
    deleteSchedule(id) {
        const schedules = this.getSchedules().filter(s => s.id !== id);
        this.store.set('schedules', schedules);
        logger_1.default.debug('ConfigStore', 'Schedule deleted', { id });
    }
    // ===== General Settings =====
    getGeneralSettings() {
        return this.store.get('generalSettings');
    }
    saveGeneralSettings(settings) {
        this.store.set('generalSettings', settings);
        logger_1.default.debug('ConfigStore', 'General settings saved');
    }
    // ===== Rest Block Presets =====
    getRestBlockPresets() {
        return this.store.get('restBlockPresets');
    }
    saveRestBlockPreset(preset) {
        const presets = this.getRestBlockPresets();
        const index = presets.findIndex(p => p.id === preset.id);
        if (index >= 0) {
            presets[index] = preset;
        }
        else {
            presets.push(preset);
        }
        this.store.set('restBlockPresets', presets);
        logger_1.default.debug('ConfigStore', 'Rest block preset saved', { id: preset.id });
    }
    deleteRestBlockPreset(id) {
        const presets = this.getRestBlockPresets();
        const filtered = presets.filter(p => p.id !== id);
        if (filtered.length === presets.length) {
            return false; // Not found
        }
        this.store.set('restBlockPresets', filtered);
        logger_1.default.debug('ConfigStore', 'Rest block preset deleted', { id });
        return true;
    }
    // ===== Migration from legacy config.json =====
    /**
     * Import data from legacy config.json format
     * Called during migration from old storage format
     */
    importLegacyConfig(legacyConfig) {
        logger_1.default.info('ConfigStore', 'Importing legacy config');
        // Migrate schedules
        if (legacyConfig.schedules && Array.isArray(legacyConfig.schedules)) {
            const migratedSchedules = legacyConfig.schedules.map((s) => migrateSchedule(s));
            this.store.set('schedules', migratedSchedules);
            logger_1.default.info('ConfigStore', 'Migrated schedules', { count: migratedSchedules.length });
        }
        // Migrate general settings
        if (legacyConfig.generalSettings) {
            const settings = { ...types_1.DEFAULT_GENERAL_SETTINGS, ...legacyConfig.generalSettings };
            this.store.set('generalSettings', settings);
            logger_1.default.info('ConfigStore', 'Migrated general settings');
        }
    }
    /**
     * Clear all config (for testing)
     */
    clear() {
        this.store.clear();
        logger_1.default.warn('ConfigStore', 'All config cleared');
    }
}
ConfigStore.instance = null;
exports.configStore = ConfigStore.getInstance();
exports.default = exports.configStore;
//# sourceMappingURL=configStore.js.map