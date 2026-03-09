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
} from '../shared/types';
import { CONFIG_FILENAME } from '../shared/constants';

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
        const parsed = JSON.parse(data) as AppConfig;
        // Merge with defaults to handle missing fields from older versions
        return {
          schedules: parsed.schedules || [],
          generalSettings: { ...DEFAULT_GENERAL_SETTINGS, ...parsed.generalSettings },
          sessionState: { ...INITIAL_SESSION_STATE, ...parsed.sessionState },
        };
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
