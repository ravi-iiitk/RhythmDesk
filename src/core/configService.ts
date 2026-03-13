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

import {
  AppConfig,
  Schedule,
  SessionState,
  GeneralSettings,
  RestBlockPreset,
  INITIAL_SESSION_STATE,
  INITIAL_POSTPONE_COUNTS,
} from '../shared/types';
import { configStore } from './storage/configStore';
import { sessionSnapshot } from './storage/sessionSnapshot';
import { initializeStorage } from './storage/migration';
import logger from './logger';

// Re-export storage modules for direct access when needed
export { configStore } from './storage/configStore';
export { sessionSnapshot } from './storage/sessionSnapshot';
export { initializeStorage, getMigrationStatus } from './storage/migration';

// Storage interface for backward compatibility
export interface IStorageProvider {
  load(): AppConfig;
  save(config: AppConfig): void;
  getSchedules(): Schedule[];
  saveSchedule(schedule: Schedule): void;
  deleteSchedule(id: string): void;
  getSessionState(): SessionState;
  saveSessionState(state: SessionState): void;
  getGeneralSettings(): GeneralSettings;
  saveGeneralSettings(settings: GeneralSettings): void;
}

/**
 * Hybrid Storage Provider
 * Delegates to ConfigStore and SessionSnapshot
 */
class HybridStorageProvider implements IStorageProvider {
  private initialized: boolean = false;

  ensureInitialized(): void {
    if (this.initialized) return;
    
    // Run migration if needed (from legacy config.json)
    initializeStorage();
    this.initialized = true;
    
    logger.info('ConfigService', 'Hybrid storage initialized');
  }

  load(): AppConfig {
    this.ensureInitialized();
    return {
      schedules: configStore.getSchedules(),
      generalSettings: configStore.getGeneralSettings(),
      sessionState: sessionSnapshot.loadSnapshot() ?? this.getInitialSessionState(),
    };
  }

  save(config: AppConfig): void {
    this.ensureInitialized();
    // Save schedules and settings to ConfigStore
    config.schedules.forEach(s => configStore.saveSchedule(s));
    configStore.saveGeneralSettings(config.generalSettings);
    // Save session state to snapshot (immediate)
    sessionSnapshot.saveSnapshotImmediate(config.sessionState);
  }

  getSchedules(): Schedule[] {
    this.ensureInitialized();
    return configStore.getSchedules();
  }

  saveSchedule(schedule: Schedule): void {
    this.ensureInitialized();
    configStore.saveSchedule(schedule);
  }

  deleteSchedule(id: string): void {
    this.ensureInitialized();
    configStore.deleteSchedule(id);
  }

  getSessionState(): SessionState {
    this.ensureInitialized();
    return sessionSnapshot.loadSnapshot() ?? this.getInitialSessionState();
  }

  saveSessionState(state: SessionState): void {
    this.ensureInitialized();
    // Use debounced save for normal state updates
    sessionSnapshot.saveSnapshot(state);
  }

  /**
   * Save session state immediately (for critical changes)
   */
  saveSessionStateImmediate(state: SessionState): void {
    this.ensureInitialized();
    sessionSnapshot.saveSnapshotImmediate(state);
  }

  getGeneralSettings(): GeneralSettings {
    this.ensureInitialized();
    return configStore.getGeneralSettings();
  }

  saveGeneralSettings(settings: GeneralSettings): void {
    this.ensureInitialized();
    configStore.saveGeneralSettings(settings);
  }

  private getInitialSessionState(): SessionState {
    return {
      ...INITIAL_SESSION_STATE,
      postponeCountsToday: { ...INITIAL_POSTPONE_COUNTS },
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
  private storage: HybridStorageProvider;
  private static instance: ConfigService;

  private constructor() {
    this.storage = new HybridStorageProvider();
  }

  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  /**
   * Initialize storage (call on app startup)
   */
  initialize(): void {
    this.storage.ensureInitialized();
  }

  // Allow swapping storage provider for future SQLite migration
  setStorageProvider(_provider: IStorageProvider): void {
    // Note: This is kept for backward compatibility but not recommended
    // The hybrid storage provider handles all storage needs
    logger.warn('ConfigService', 'setStorageProvider called - this is deprecated');
  }

  getConfig(): AppConfig {
    return this.storage.load();
  }

  saveConfig(config: AppConfig): void {
    this.storage.save(config);
  }

  getSchedules(): Schedule[] {
    return this.storage.getSchedules();
  }

  getScheduleById(id: string): Schedule | undefined {
    return this.storage.getSchedules().find((s) => s.id === id);
  }

  saveSchedule(schedule: Schedule): void {
    this.storage.saveSchedule(schedule);
  }

  deleteSchedule(id: string): void {
    this.storage.deleteSchedule(id);
  }

  getSessionState(): SessionState {
    return this.storage.getSessionState();
  }

  /**
   * Save session state (debounced)
   * For normal state updates during timer operation
   */
  saveSessionState(state: SessionState): void {
    this.storage.saveSessionState(state);
  }

  /**
   * Save session state immediately (no debounce)
   * Use for critical state changes: phase change, pause, reset
   */
  saveSessionStateImmediate(state: SessionState): void {
    this.storage.saveSessionStateImmediate(state);
  }

  /**
   * Clear session state (e.g., on session reset)
   */
  clearSessionState(): void {
    sessionSnapshot.clearSnapshot();
  }

  /**
   * Flush any pending session snapshot
   * Call on app shutdown
   */
  flushSessionSnapshot(): void {
    sessionSnapshot.flushPending();
  }

  getGeneralSettings(): GeneralSettings {
    return this.storage.getGeneralSettings();
  }

  saveGeneralSettings(settings: GeneralSettings): void {
    this.storage.saveGeneralSettings(settings);
  }

  // ===== Rest Block Presets (new in hybrid architecture) =====

  getRestBlockPresets(): RestBlockPreset[] {
    return configStore.getRestBlockPresets();
  }

  saveRestBlockPreset(preset: RestBlockPreset): void {
    configStore.saveRestBlockPreset(preset);
  }

  deleteRestBlockPreset(id: string): boolean {
    return configStore.deleteRestBlockPreset(id);
  }
}

export const configService = ConfigService.getInstance();
export default configService;
