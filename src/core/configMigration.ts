/**
 * RhythmDesk Config Migration - Phase 5 Stability Lockdown
 * 
 * Versioned configuration migration system.
 * Transforms old config formats to new formats as schema evolves.
 * 
 * SCHEMA VERSION HISTORY:
 * - 1.0.0: Initial schema
 * - 1.1.0: Added flow-based schedules
 * - 1.2.0: Added per-break configuration
 * - 1.3.0: Added Phase 4/5 runtime invariants
 */

import logger from './logger';
import { AppConfig, SessionState } from '../shared/types';

// ============================================================
// SCHEMA VERSION
// ============================================================

export const CURRENT_SCHEMA_VERSION = '1.3.0';

export interface VersionedConfig {
  schemaVersion: string;
  migratedAt?: number;
  config: AppConfig;
}

// ============================================================
// MIGRATION TYPES
// ============================================================

export interface MigrationResult {
  success: boolean;
  fromVersion: string;
  toVersion: string;
  changes: string[];
  error?: string;
}

type MigrationFunction = (config: unknown) => { config: unknown; changes: string[] };

interface Migration {
  fromVersion: string;
  toVersion: string;
  migrate: MigrationFunction;
}

// ============================================================
// MIGRATIONS
// ============================================================

const migrations: Migration[] = [
  // Migration from no version to 1.0.0
  {
    fromVersion: 'unknown',
    toVersion: '1.0.0',
    migrate: (config: unknown) => {
      const changes: string[] = [];
      const cfg = config as Record<string, unknown>;
      
      // Add schema version
      changes.push('Added schema version');
      
      return { config: cfg, changes };
    },
  },
  
  // Migration from 1.0.0 to 1.1.0 - flow-based schedules
  {
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    migrate: (config: unknown) => {
      const changes: string[] = [];
      const cfg = config as { schedules?: unknown[] };
      
      if (cfg.schedules && Array.isArray(cfg.schedules)) {
        cfg.schedules = cfg.schedules.map((schedule: unknown) => {
          const s = schedule as Record<string, unknown>;
          if (!s.mode) {
            s.mode = 'rule-based';
            changes.push(`Added mode='rule-based' to schedule ${s.name || s.id}`);
          }
          return s;
        });
      }
      
      return { config: cfg, changes };
    },
  },
  
  // Migration from 1.1.0 to 1.2.0 - per-break configuration
  {
    fromVersion: '1.1.0',
    toVersion: '1.2.0',
    migrate: (config: unknown) => {
      const changes: string[] = [];
      const cfg = config as { schedules?: unknown[] };
      
      if (cfg.schedules && Array.isArray(cfg.schedules)) {
        cfg.schedules = cfg.schedules.map((schedule: unknown) => {
          const s = schedule as Record<string, unknown>;
          
          // Migrate legacy break fields to per-break config
          if (!s.shortBreak && s.shortBreakDurationMinutes !== undefined) {
            s.shortBreak = {
              enabled: s.shortBreakEnabled ?? true,
              everyMinutes: s.shortBreakEveryMinutes ?? 25,
              durationMinutes: s.shortBreakDurationMinutes,
              strictModeEnabled: s.strictModeEnabled ?? false,
              allowPostpone: s.allowPostpone ?? true,
              postponeOptionsMinutes: s.postponeOptionsMinutes ?? [5, 10],
              maxPostponesPerDay: s.maxPostponesPerDay ?? 3,
            };
            changes.push(`Migrated short break config for schedule ${s.name || s.id}`);
          }
          
          if (!s.longBreak && s.longBreakDurationMinutes !== undefined) {
            s.longBreak = {
              enabled: s.longBreakEnabled ?? true,
              everyMinutes: s.longBreakEveryMinutes ?? 60,
              durationMinutes: s.longBreakDurationMinutes,
              strictModeEnabled: s.strictModeEnabled ?? false,
              allowPostpone: s.allowPostpone ?? true,
              postponeOptionsMinutes: s.postponeOptionsMinutes ?? [5, 10],
              maxPostponesPerDay: s.maxPostponesPerDay ?? 2,
            };
            changes.push(`Migrated long break config for schedule ${s.name || s.id}`);
          }
          
          // Migrate transitions config
          if (!s.transitions) {
            s.transitions = {
              sitToStand: {
                durationSeconds: (s.sitToStandTransitionSeconds as number) ?? 60,
                strictModeEnabled: false,
                allowPostpone: false,
                postponeOptionsMinutes: [],
                maxPostponesPerDay: 0,
              },
              standToSit: {
                durationSeconds: (s.standToSitTransitionSeconds as number) ?? 60,
                strictModeEnabled: false,
                allowPostpone: false,
                postponeOptionsMinutes: [],
                maxPostponesPerDay: 0,
              },
            };
            changes.push(`Migrated transitions config for schedule ${s.name || s.id}`);
          }
          
          return s;
        });
      }
      
      return { config: cfg, changes };
    },
  },
  
  // Migration from 1.2.0 to 1.3.0 - Phase 4/5 fields
  {
    fromVersion: '1.2.0',
    toVersion: '1.3.0',
    migrate: (config: unknown) => {
      const changes: string[] = [];
      const cfg = config as { sessionState?: Record<string, unknown> };
      
      if (cfg.sessionState) {
        // Add new session state fields if missing
        if (cfg.sessionState.interruptedFlowIndex === undefined) {
          cfg.sessionState.interruptedFlowIndex = undefined;
          changes.push('Added interruptedFlowIndex to session state');
        }
        
        if (cfg.sessionState.prePostponeFlowIndex === undefined) {
          cfg.sessionState.prePostponeFlowIndex = undefined;
          changes.push('Added prePostponeFlowIndex to session state');
        }
      }
      
      return { config: cfg, changes };
    },
  },
];

// ============================================================
// MIGRATION ENGINE
// ============================================================

/**
 * Detect config version
 */
export function detectVersion(config: unknown): string {
  const cfg = config as { schemaVersion?: string };
  
  if (cfg.schemaVersion) {
    return cfg.schemaVersion;
  }
  
  // Try to detect version from structure
  const schedules = (config as { schedules?: unknown[] }).schedules;
  
  if (schedules && Array.isArray(schedules) && schedules.length > 0) {
    const firstSchedule = schedules[0] as Record<string, unknown>;
    
    // Check for v1.3.0 indicators
    if (firstSchedule.transitions && firstSchedule.shortBreak && firstSchedule.longBreak) {
      return '1.2.0';
    }
    
    // Check for v1.1.0 indicators
    if (firstSchedule.mode) {
      return '1.1.0';
    }
    
    return '1.0.0';
  }
  
  return 'unknown';
}

/**
 * Compare version strings
 */
function compareVersions(a: string, b: string): number {
  if (a === 'unknown') return -1;
  if (b === 'unknown') return 1;
  
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  
  for (let i = 0; i < 3; i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    
    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
  }
  
  return 0;
}

/**
 * Run migrations to bring config to current version
 */
export function migrateConfig(config: unknown): MigrationResult {
  const startVersion = detectVersion(config);
  const allChanges: string[] = [];
  let currentConfig = config;
  let currentVersion = startVersion;
  
  logger.info('ConfigMigration', 'Starting migration', {
    fromVersion: startVersion,
    toVersion: CURRENT_SCHEMA_VERSION,
  });
  
  // No migration needed
  if (compareVersions(currentVersion, CURRENT_SCHEMA_VERSION) >= 0) {
    return {
      success: true,
      fromVersion: startVersion,
      toVersion: currentVersion,
      changes: ['No migration needed'],
    };
  }
  
  // Run migrations in order
  try {
    for (const migration of migrations) {
      // Skip if we haven't reached this migration yet
      if (compareVersions(currentVersion, migration.fromVersion) > 0) {
        continue;
      }
      
      // Skip if we're past this migration
      if (compareVersions(currentVersion, migration.fromVersion) < 0 && 
          currentVersion !== 'unknown') {
        continue;
      }
      
      // Run migration
      logger.info('ConfigMigration', `Running migration ${migration.fromVersion} → ${migration.toVersion}`);
      
      const result = migration.migrate(currentConfig);
      currentConfig = result.config;
      allChanges.push(...result.changes);
      currentVersion = migration.toVersion;
      
      // Stop if we've reached current version
      if (compareVersions(currentVersion, CURRENT_SCHEMA_VERSION) >= 0) {
        break;
      }
    }
    
    // Add schema version to config
    (currentConfig as { schemaVersion: string }).schemaVersion = CURRENT_SCHEMA_VERSION;
    
    logger.info('ConfigMigration', 'Migration complete', {
      fromVersion: startVersion,
      toVersion: CURRENT_SCHEMA_VERSION,
      changesCount: allChanges.length,
    });
    
    return {
      success: true,
      fromVersion: startVersion,
      toVersion: CURRENT_SCHEMA_VERSION,
      changes: allChanges,
    };
  } catch (error) {
    logger.error('ConfigMigration', 'Migration failed', {
      fromVersion: startVersion,
      currentVersion,
      error: error instanceof Error ? error.message : String(error),
    });
    
    return {
      success: false,
      fromVersion: startVersion,
      toVersion: currentVersion,
      changes: allChanges,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Wrap config with version metadata
 */
export function wrapConfig(config: AppConfig): VersionedConfig {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    migratedAt: Date.now(),
    config,
  };
}

/**
 * Unwrap versioned config
 */
export function unwrapConfig(wrapped: unknown): AppConfig | null {
  const cfg = wrapped as VersionedConfig;
  
  if (cfg.config) {
    return cfg.config;
  }
  
  // May be unwrapped config
  if ((wrapped as AppConfig).schedules !== undefined) {
    return wrapped as AppConfig;
  }
  
  return null;
}

/**
 * Validate and migrate session state
 */
export function migrateSessionState(state: unknown): SessionState {
  const s = state as Partial<SessionState>;
  const today = new Date().toISOString().split('T')[0];
  
  return {
    activeScheduleId: s.activeScheduleId ?? null,
    currentPhase: s.currentPhase ?? 'idle',
    phaseStartedAt: s.phaseStartedAt ?? Date.now(),
    phaseEndsAt: s.phaseEndsAt ?? 0,
    phaseRemainingMs: s.phaseRemainingMs ?? 0,
    phaseTotalMs: s.phaseTotalMs ?? 0,
    phaseOriginalDurationMs: s.phaseOriginalDurationMs ?? s.phaseTotalMs ?? 0,
    currentFlowStepIndex: s.currentFlowStepIndex,
    flowConfigHash: s.flowConfigHash,
    cumulativeWorkTimeMs: s.cumulativeWorkTimeMs ?? 0,
    lastShortBreakAtWorkTimeMs: s.lastShortBreakAtWorkTimeMs ?? 0,
    lastLongBreakAtWorkTimeMs: s.lastLongBreakAtWorkTimeMs ?? 0,
    shortBreakCountToday: s.shortBreakCountToday ?? 0,
    longBreakCountToday: s.longBreakCountToday ?? 0,
    breakCountResetDate: s.breakCountResetDate ?? today,
    interruptedPhase: s.interruptedPhase ?? null,
    interruptedPhaseRemainingMs: s.interruptedPhaseRemainingMs ?? 0,
    interruptedFlowIndex: s.interruptedFlowIndex,
    postponeCountsToday: s.postponeCountsToday ?? {
      sitToStandTransition: 0,
      standToSitTransition: 0,
      shortBreak: 0,
      longBreak: 0,
    },
    postponeResetDate: s.postponeResetDate ?? today,
    isWaitingForNextActivity: (s as any).isWaitingForNextActivity ?? false,
    waitingNextPhase: (s as any).waitingNextPhase ?? null,
    isPaused: s.isPaused ?? false,
    pausedAt: s.pausedAt ?? null,
    pauseResumeAt: s.pauseResumeAt ?? null,
    isPostponed: s.isPostponed ?? false,
    postponedUntil: s.postponedUntil ?? null,
    postponedPhase: s.postponedPhase ?? null,
    postponedBreakType: s.postponedBreakType ?? null,
    prePostponeWorkPhase: s.prePostponeWorkPhase ?? null,
    prePostponeWorkPhaseRemainingMs: s.prePostponeWorkPhaseRemainingMs ?? 0,
    prePostponeFlowIndex: s.prePostponeFlowIndex,
    isFocusSessionActive: s.isFocusSessionActive ?? false,
    activeFocusSessionId: s.activeFocusSessionId ?? null,
    focusSessionEndsAt: s.focusSessionEndsAt ?? null,
  };
}
