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

import Store from 'electron-store';
import {
  Schedule,
  GeneralSettings,
  RestBlockPreset,
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_REST_BLOCK_PRESETS,
  DEFAULT_TRANSITION_CONFIG,
  DEFAULT_SHORT_BREAK_CONFIG,
  DEFAULT_LONG_BREAK_CONFIG,
} from '../../shared/types';
import logger from '../logger';

// Schema for electron-store type safety
interface ConfigStoreSchema {
  schedules: Schedule[];
  generalSettings: GeneralSettings;
  restBlockPresets: RestBlockPreset[];
  // Migration tracking
  schemaVersion: number;
}

// Current schema version - increment when making breaking changes
const CURRENT_SCHEMA_VERSION = 1;

/**
 * Migrate legacy schedule format to new per-break config format
 */
function migrateSchedule(schedule: Partial<Schedule> & { id: string; name: string; createdAt: number }): Schedule {
  // If already migrated (has transitions object), return as-is with defaults merged
  if (schedule.transitions && schedule.shortBreak && schedule.longBreak) {
    return {
      ...schedule,
      priority: schedule.priority ?? 0,
    } as Schedule;
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
        durationSeconds: schedule.sitToStandTransitionSeconds ?? DEFAULT_TRANSITION_CONFIG.durationSeconds,
        strictModeEnabled: legacyStrictMode,
        allowPostpone: legacyAllowPostpone,
        allowPause: true,
        postponeOptionsMinutes: [...legacyPostponeOptions],
        maxPostponesPerDay: legacyMaxPostpones,
      },
      standToSit: {
        durationSeconds: schedule.standToSitTransitionSeconds ?? DEFAULT_TRANSITION_CONFIG.durationSeconds,
        strictModeEnabled: legacyStrictMode,
        allowPostpone: legacyAllowPostpone,
        allowPause: true,
        postponeOptionsMinutes: [...legacyPostponeOptions],
        maxPostponesPerDay: legacyMaxPostpones,
      },
    },
    shortBreak: {
      enabled: schedule.shortBreakEnabled ?? DEFAULT_SHORT_BREAK_CONFIG.enabled,
      everyMinutes: schedule.shortBreakEveryMinutes ?? DEFAULT_SHORT_BREAK_CONFIG.everyMinutes,
      durationMinutes: schedule.shortBreakDurationMinutes ?? DEFAULT_SHORT_BREAK_CONFIG.durationMinutes,
      strictModeEnabled: legacyStrictMode,
      allowPostpone: legacyAllowPostpone,
      postponeOptionsMinutes: [...legacyPostponeOptions],
      maxPostponesPerDay: legacyMaxPostpones,
      maxSkipsPerDay: legacyMaxSkips,
    },
    longBreak: {
      enabled: schedule.longBreakEnabled ?? DEFAULT_LONG_BREAK_CONFIG.enabled,
      everyMinutes: schedule.longBreakEveryMinutes ?? DEFAULT_LONG_BREAK_CONFIG.everyMinutes,
      durationMinutes: schedule.longBreakDurationMinutes ?? DEFAULT_LONG_BREAK_CONFIG.durationMinutes,
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
  private store: Store<ConfigStoreSchema>;
  private static instance: ConfigStore | null = null;

  private constructor() {
    this.store = new Store<ConfigStoreSchema>({
      name: 'config',
      defaults: {
        schedules: [],
        generalSettings: { ...DEFAULT_GENERAL_SETTINGS },
        restBlockPresets: [...DEFAULT_REST_BLOCK_PRESETS],
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

    // PERMANENT FIX: Ensure all required keys exist with defaults
    // electron-store only applies defaults to NEW stores, not existing ones with missing keys
    // This guarantees the store is always in a valid state
    this.ensureRequiredKeysExist();

    logger.info('ConfigStore', 'Initialized', {
      path: this.store.path,
      schemaVersion: this.store.get('schemaVersion'),
    });
  }

  /**
   * Ensure all required keys exist in the store with proper defaults.
   * This fixes the issue where existing stores may be missing keys that were
   * added in later versions, causing undefined errors at runtime.
   */
  private ensureRequiredKeysExist(): void {
    let modified = false;

    // Check and set schedules
    if (this.store.get('schedules') === undefined) {
      this.store.set('schedules', []);
      modified = true;
    }

    // Check and set generalSettings
    if (this.store.get('generalSettings') === undefined) {
      this.store.set('generalSettings', { ...DEFAULT_GENERAL_SETTINGS });
      modified = true;
    }

    // Check and set restBlockPresets
    if (this.store.get('restBlockPresets') === undefined) {
      this.store.set('restBlockPresets', [...DEFAULT_REST_BLOCK_PRESETS]);
      modified = true;
    }

    // Check and set schemaVersion
    if (this.store.get('schemaVersion') === undefined) {
      this.store.set('schemaVersion', CURRENT_SCHEMA_VERSION);
      modified = true;
    }

    if (modified) {
      logger.info('ConfigStore', 'Added missing required keys to existing store');
    }
  }

  static getInstance(): ConfigStore {
    if (!ConfigStore.instance) {
      ConfigStore.instance = new ConfigStore();
    }
    return ConfigStore.instance;
  }

  // For testing - reset singleton
  static resetInstance(): void {
    ConfigStore.instance = null;
  }

  getStorePath(): string {
    return this.store.path;
  }

  // ===== Schedules =====

  getSchedules(): Schedule[] {
    return this.store.get('schedules') ?? [];
  }

  getScheduleById(id: string): Schedule | undefined {
    return this.getSchedules().find(s => s.id === id);
  }

  saveSchedule(schedule: Schedule): void {
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
    } else {
      schedules.push(schedule);
    }
    this.store.set('schedules', schedules);
    logger.debug('ConfigStore', 'Schedule saved', { id: schedule.id, name: schedule.name });
  }

  deleteSchedule(id: string): void {
    const schedules = this.getSchedules().filter(s => s.id !== id);
    this.store.set('schedules', schedules);
    logger.debug('ConfigStore', 'Schedule deleted', { id });
  }

  // ===== General Settings =====

  getGeneralSettings(): GeneralSettings {
    return this.store.get('generalSettings') ?? { ...DEFAULT_GENERAL_SETTINGS };
  }

  saveGeneralSettings(settings: GeneralSettings): void {
    this.store.set('generalSettings', settings);
    logger.debug('ConfigStore', 'General settings saved');
  }

  // ===== Rest Block Presets =====

  getRestBlockPresets(): RestBlockPreset[] {
    return this.store.get('restBlockPresets') ?? [...DEFAULT_REST_BLOCK_PRESETS];
  }

  saveRestBlockPreset(preset: RestBlockPreset): void {
    const presets = this.getRestBlockPresets();
    const index = presets.findIndex(p => p.id === preset.id);
    if (index >= 0) {
      presets[index] = preset;
    } else {
      presets.push(preset);
    }
    this.store.set('restBlockPresets', presets);
    logger.debug('ConfigStore', 'Rest block preset saved', { id: preset.id });
  }

  deleteRestBlockPreset(id: string): boolean {
    const presets = this.getRestBlockPresets();
    const filtered = presets.filter(p => p.id !== id);
    if (filtered.length === presets.length) {
      return false; // Not found
    }
    this.store.set('restBlockPresets', filtered);
    logger.debug('ConfigStore', 'Rest block preset deleted', { id });
    return true;
  }

  // ===== Migration from legacy config.json =====

  /**
   * Import data from legacy config.json format
   * Called during migration from old storage format
   */
  importLegacyConfig(legacyConfig: {
    schedules?: any[];
    generalSettings?: Partial<GeneralSettings>;
  }): void {
    logger.info('ConfigStore', 'Importing legacy config');

    // Migrate schedules
    if (legacyConfig.schedules && Array.isArray(legacyConfig.schedules)) {
      const migratedSchedules = legacyConfig.schedules.map((s: any) => migrateSchedule(s));
      this.store.set('schedules', migratedSchedules);
      logger.info('ConfigStore', 'Migrated schedules', { count: migratedSchedules.length });
    }

    // Migrate general settings
    if (legacyConfig.generalSettings) {
      const settings = { ...DEFAULT_GENERAL_SETTINGS, ...legacyConfig.generalSettings };
      this.store.set('generalSettings', settings);
      logger.info('ConfigStore', 'Migrated general settings');
    }
  }

  /**
   * Clear all config (for testing)
   */
  clear(): void {
    this.store.clear();
    logger.warn('ConfigStore', 'All config cleared');
  }
}

export const configStore = ConfigStore.getInstance();
export default configStore;
