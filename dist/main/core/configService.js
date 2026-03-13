"use strict";
/**
 * RhythmDesk Config Service
 *
 * HYBRID STORAGE ARCHITECTURE:
 *
 * 1. ConfigStore (electron-store) - Durable configuration
 *    - schedules, generalSettings, restBlockPresets
 *    - Persists across app restarts
 *
 * 2. SessionSnapshot (electron-store) - Debounced session snapshots
 *    - Runtime state snapshots for restart recovery
 *    - Debounced writes (5s) to avoid excessive I/O
 *
 * 3. In-Memory Session State (timerEngine)
 *    - LIVE session state is source of truth
 *    - Snapshots are only for recovery
 *
 * This service provides a unified interface that delegates to the appropriate
 * storage module while maintaining backward compatibility with existing code.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configService = exports.getMigrationStatus = exports.initializeStorage = exports.sessionSnapshot = exports.configStore = void 0;
const types_1 = require("../shared/types");
const configStore_1 = require("./storage/configStore");
const sessionSnapshot_1 = require("./storage/sessionSnapshot");
const migration_1 = require("./storage/migration");
const logger_1 = __importDefault(require("./logger"));
// Re-export storage modules for direct access when needed
var configStore_2 = require("./storage/configStore");
Object.defineProperty(exports, "configStore", { enumerable: true, get: function () { return configStore_2.configStore; } });
var sessionSnapshot_2 = require("./storage/sessionSnapshot");
Object.defineProperty(exports, "sessionSnapshot", { enumerable: true, get: function () { return sessionSnapshot_2.sessionSnapshot; } });
var migration_2 = require("./storage/migration");
Object.defineProperty(exports, "initializeStorage", { enumerable: true, get: function () { return migration_2.initializeStorage; } });
Object.defineProperty(exports, "getMigrationStatus", { enumerable: true, get: function () { return migration_2.getMigrationStatus; } });
/**
 * Hybrid Storage Provider
 * Delegates to ConfigStore and SessionSnapshot
 */
class HybridStorageProvider {
    constructor() {
        this.initialized = false;
    }
    ensureInitialized() {
        if (this.initialized)
            return;
        // Run migration if needed (from legacy config.json)
        (0, migration_1.initializeStorage)();
        this.initialized = true;
        logger_1.default.info('ConfigService', 'Hybrid storage initialized');
    }
    load() {
        this.ensureInitialized();
        return {
            schedules: configStore_1.configStore.getSchedules(),
            generalSettings: configStore_1.configStore.getGeneralSettings(),
            sessionState: sessionSnapshot_1.sessionSnapshot.loadSnapshot() ?? this.getInitialSessionState(),
        };
    }
    save(config) {
        this.ensureInitialized();
        // Save schedules and settings to ConfigStore
        config.schedules.forEach(s => configStore_1.configStore.saveSchedule(s));
        configStore_1.configStore.saveGeneralSettings(config.generalSettings);
        // Save session state to snapshot (immediate)
        sessionSnapshot_1.sessionSnapshot.saveSnapshotImmediate(config.sessionState);
    }
    getSchedules() {
        this.ensureInitialized();
        return configStore_1.configStore.getSchedules();
    }
    saveSchedule(schedule) {
        this.ensureInitialized();
        configStore_1.configStore.saveSchedule(schedule);
    }
    deleteSchedule(id) {
        this.ensureInitialized();
        configStore_1.configStore.deleteSchedule(id);
    }
    getSessionState() {
        this.ensureInitialized();
        return sessionSnapshot_1.sessionSnapshot.loadSnapshot() ?? this.getInitialSessionState();
    }
    saveSessionState(state) {
        this.ensureInitialized();
        // Use debounced save for normal state updates
        sessionSnapshot_1.sessionSnapshot.saveSnapshot(state);
    }
    /**
     * Save session state immediately (for critical changes)
     */
    saveSessionStateImmediate(state) {
        this.ensureInitialized();
        sessionSnapshot_1.sessionSnapshot.saveSnapshotImmediate(state);
    }
    getGeneralSettings() {
        this.ensureInitialized();
        return configStore_1.configStore.getGeneralSettings();
    }
    saveGeneralSettings(settings) {
        this.ensureInitialized();
        configStore_1.configStore.saveGeneralSettings(settings);
    }
    getInitialSessionState() {
        return {
            ...types_1.INITIAL_SESSION_STATE,
            postponeCountsToday: { ...types_1.INITIAL_POSTPONE_COUNTS },
            breakCountResetDate: new Date().toISOString().split('T')[0],
            postponeResetDate: new Date().toISOString().split('T')[0],
        };
    }
}
/**
 * Config Service singleton
 * Provides high-level access to configuration with hybrid storage
 */
class ConfigService {
    constructor() {
        this.storage = new HybridStorageProvider();
    }
    static getInstance() {
        if (!ConfigService.instance) {
            ConfigService.instance = new ConfigService();
        }
        return ConfigService.instance;
    }
    /**
     * Initialize storage (call on app startup)
     */
    initialize() {
        this.storage.ensureInitialized();
    }
    // Allow swapping storage provider for future SQLite migration
    setStorageProvider(_provider) {
        // Note: This is kept for backward compatibility but not recommended
        // The hybrid storage provider handles all storage needs
        logger_1.default.warn('ConfigService', 'setStorageProvider called - this is deprecated');
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
    /**
     * Save session state (debounced)
     * For normal state updates during timer operation
     */
    saveSessionState(state) {
        this.storage.saveSessionState(state);
    }
    /**
     * Save session state immediately (no debounce)
     * Use for critical state changes: phase change, pause, reset
     */
    saveSessionStateImmediate(state) {
        this.storage.saveSessionStateImmediate(state);
    }
    /**
     * Clear session state (e.g., on session reset)
     */
    clearSessionState() {
        sessionSnapshot_1.sessionSnapshot.clearSnapshot();
    }
    /**
     * Flush any pending session snapshot
     * Call on app shutdown
     */
    flushSessionSnapshot() {
        sessionSnapshot_1.sessionSnapshot.flushPending();
    }
    getGeneralSettings() {
        return this.storage.getGeneralSettings();
    }
    saveGeneralSettings(settings) {
        this.storage.saveGeneralSettings(settings);
    }
    // ===== Rest Block Presets (new in hybrid architecture) =====
    getRestBlockPresets() {
        return configStore_1.configStore.getRestBlockPresets();
    }
    saveRestBlockPreset(preset) {
        configStore_1.configStore.saveRestBlockPreset(preset);
    }
    deleteRestBlockPreset(id) {
        return configStore_1.configStore.deleteRestBlockPreset(id);
    }
}
exports.configService = ConfigService.getInstance();
exports.default = exports.configService;
//# sourceMappingURL=configService.js.map