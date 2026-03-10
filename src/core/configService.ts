/**
 * RhythmDesk Config Service
 * Handles local JSON persistence with abstraction for future SQLite migration
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  AppConfig,
  Schedule,
  SessionState,
  GeneralSettings,
  DEFAULT_GENERAL_SETTINGS,
  INITIAL_SESSION_STATE,
  DEFAULT_TRANSITION_CONFIG,
  DEFAULT_SHORT_BREAK_CONFIG,
  DEFAULT_LONG_BREAK_CONFIG,
  PostponeCountsToday,
} from '../shared/types';
import { CONFIG_FILENAME } from '../shared/constants';

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
        postponeOptionsMinutes: [...legacyPostponeOptions],
        maxPostponesPerDay: legacyMaxPostpones,
      },
      standToSit: {
        durationSeconds: schedule.standToSitTransitionSeconds ?? DEFAULT_TRANSITION_CONFIG.durationSeconds,
        strictModeEnabled: legacyStrictMode,
        allowPostpone: legacyAllowPostpone,
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
    },
    longBreak: {
      enabled: schedule.longBreakEnabled ?? DEFAULT_LONG_BREAK_CONFIG.enabled,
      everyMinutes: schedule.longBreakEveryMinutes ?? DEFAULT_LONG_BREAK_CONFIG.everyMinutes,
      durationMinutes: schedule.longBreakDurationMinutes ?? DEFAULT_LONG_BREAK_CONFIG.durationMinutes,
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
function migrateSessionState(state: Partial<SessionState>): SessionState {
  // Convert legacy single postponeCountToday to per-break counts
  const legacyCount = state.postponeCountToday ?? 0;
  const postponeCountsToday: PostponeCountsToday = state.postponeCountsToday ?? {
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

// Storage interface for future migration to SQLite
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
 * JSON File Storage Provider
 * Stores all config in a single JSON file
 */
export class JsonStorageProvider implements IStorageProvider {
  private configPath: string = '';
  private config: AppConfig | null = null;
  private initialized: boolean = false;

  private ensureInitialized(): void {
    if (this.initialized) return;
    const userDataPath = app.getPath('userData');
    this.configPath = path.join(userDataPath, CONFIG_FILENAME);
    this.config = this.loadFromDisk();
    this.initialized = true;
  }

  private getConfig(): AppConfig {
    this.ensureInitialized();
    return this.config!;
  }

  private getDefaultConfig(): AppConfig {
    return {
      schedules: [],
      generalSettings: { ...DEFAULT_GENERAL_SETTINGS },
      sessionState: { ...INITIAL_SESSION_STATE },
    };
  }

  private loadFromDisk(): AppConfig {
    try {
      if (this.configPath && fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(data) as Partial<AppConfig>;
        
        // Migrate schedules to new format
        const schedules = (parsed.schedules || []).map((s: any) => migrateSchedule(s));
        
        // Migrate session state to new format
        const sessionState = migrateSessionState(parsed.sessionState || {});
        
        // Merge general settings with defaults
        const generalSettings = { ...DEFAULT_GENERAL_SETTINGS, ...parsed.generalSettings };
        
        return { schedules, generalSettings, sessionState };
      }
    } catch (error) {
      console.error('Failed to load config from disk:', error);
    }
    return this.getDefaultConfig();
  }

  private saveToDisk(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save config to disk:', error);
    }
  }

  load(): AppConfig {
    return this.getConfig();
  }

  save(config: AppConfig): void {
    this.ensureInitialized();
    this.config = config;
    this.saveToDisk();
  }

  getSchedules(): Schedule[] {
    return this.getConfig().schedules;
  }

  saveSchedule(schedule: Schedule): void {
    const cfg = this.getConfig();
    const index = cfg.schedules.findIndex((s) => s.id === schedule.id);
    if (index >= 0) {
      cfg.schedules[index] = schedule;
    } else {
      cfg.schedules.push(schedule);
    }
    this.saveToDisk();
  }

  deleteSchedule(id: string): void {
    const cfg = this.getConfig();
    cfg.schedules = cfg.schedules.filter((s) => s.id !== id);
    this.saveToDisk();
  }

  getSessionState(): SessionState {
    return this.getConfig().sessionState;
  }

  saveSessionState(state: SessionState): void {
    this.getConfig().sessionState = state;
    this.saveToDisk();
  }

  getGeneralSettings(): GeneralSettings {
    return this.getConfig().generalSettings;
  }

  saveGeneralSettings(settings: GeneralSettings): void {
    this.getConfig().generalSettings = settings;
    this.saveToDisk();
  }
}

/**
 * Config Service singleton
 * Provides high-level access to configuration with storage abstraction
 */
class ConfigService {
  private storage: IStorageProvider;
  private static instance: ConfigService;

  private constructor() {
    this.storage = new JsonStorageProvider();
  }

  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  // Allow swapping storage provider for future SQLite migration
  setStorageProvider(provider: IStorageProvider): void {
    this.storage = provider;
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

  saveSessionState(state: SessionState): void {
    this.storage.saveSessionState(state);
  }

  getGeneralSettings(): GeneralSettings {
    return this.storage.getGeneralSettings();
  }

  saveGeneralSettings(settings: GeneralSettings): void {
    this.storage.saveGeneralSettings(settings);
  }
}

export const configService = ConfigService.getInstance();
export default configService;
