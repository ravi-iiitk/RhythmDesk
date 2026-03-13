/**
 * Storage Migration - Migrate from legacy config.json to new hybrid storage
 * 
 * Migration Steps:
 * 1. Check if legacy config.json exists
 * 2. If yes, read and parse it
 * 3. Import schedules/settings into ConfigStore (electron-store)
 * 4. Import session state into SessionSnapshot
 * 5. Rename legacy file to config.json.migrated (backup)
 * 6. Log migration completion
 * 
 * This migration runs once on first startup with new storage architecture.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { configStore } from './configStore';
import { sessionSnapshot } from './sessionSnapshot';
import logger from '../logger';
import { CONFIG_FILENAME } from '../../shared/constants';

// Migration status tracking
interface MigrationStatus {
  migrated: boolean;
  migratedAt: number | null;
  legacyPath: string | null;
  schedulesCount: number;
  hadSessionState: boolean;
}

let migrationStatus: MigrationStatus = {
  migrated: false,
  migratedAt: null,
  legacyPath: null,
  schedulesCount: 0,
  hadSessionState: false,
};

/**
 * Check if legacy config.json exists and needs migration
 */
export function needsMigration(): boolean {
  try {
    const userDataPath = app.getPath('userData');
    const legacyPath = path.join(userDataPath, CONFIG_FILENAME);
    
    // Check if legacy file exists
    if (!fs.existsSync(legacyPath)) {
      logger.debug('Migration', 'No legacy config.json found - fresh install');
      return false;
    }

    // Check if already migrated (backup file exists)
    const backupPath = legacyPath + '.migrated';
    if (fs.existsSync(backupPath)) {
      logger.debug('Migration', 'Migration already completed - backup exists');
      return false;
    }

    // Check if ConfigStore already has data (electron-store)
    // If it has schedules, migration was likely already done
    const existingSchedules = configStore.getSchedules();
    if (existingSchedules.length > 0) {
      logger.debug('Migration', 'ConfigStore already has schedules - skipping migration');
      return false;
    }

    logger.info('Migration', 'Legacy config.json found - migration needed', { legacyPath });
    return true;
  } catch (error) {
    logger.error('Migration', 'Error checking migration status', { error });
    return false;
  }
}

/**
 * Run migration from legacy config.json to new hybrid storage
 */
export function runMigration(): MigrationStatus {
  const userDataPath = app.getPath('userData');
  const legacyPath = path.join(userDataPath, CONFIG_FILENAME);

  try {
    logger.info('Migration', '=== Starting migration from legacy config.json ===');
    migrationStatus.legacyPath = legacyPath;

    // Read legacy config
    const legacyData = fs.readFileSync(legacyPath, 'utf-8');
    const legacyConfig = JSON.parse(legacyData);

    // Import schedules and general settings into ConfigStore
    if (legacyConfig.schedules || legacyConfig.generalSettings) {
      configStore.importLegacyConfig({
        schedules: legacyConfig.schedules,
        generalSettings: legacyConfig.generalSettings,
      });
      migrationStatus.schedulesCount = legacyConfig.schedules?.length ?? 0;
    }

    // Import session state into SessionSnapshot
    if (legacyConfig.sessionState) {
      sessionSnapshot.importLegacyState(legacyConfig.sessionState);
      migrationStatus.hadSessionState = true;
    }

    // Backup legacy file
    const backupPath = legacyPath + '.migrated';
    fs.renameSync(legacyPath, backupPath);
    logger.info('Migration', 'Legacy config backed up', { backupPath });

    migrationStatus.migrated = true;
    migrationStatus.migratedAt = Date.now();

    logger.info('Migration', '=== Migration completed successfully ===', {
      schedulesCount: migrationStatus.schedulesCount,
      hadSessionState: migrationStatus.hadSessionState,
      configStorePath: configStore.getStorePath(),
      sessionSnapshotPath: sessionSnapshot.getStorePath(),
    });

    return migrationStatus;
  } catch (error) {
    logger.error('Migration', 'Migration failed', { error, legacyPath });
    
    // Don't throw - let app continue with fresh state
    // User's legacy config is still intact
    return migrationStatus;
  }
}

/**
 * Initialize storage with migration if needed
 * Call this once during app startup
 */
export function initializeStorage(): MigrationStatus {
  logger.info('Migration', 'Initializing hybrid storage architecture');

  if (needsMigration()) {
    return runMigration();
  }

  logger.info('Migration', 'Storage initialized', {
    configStorePath: configStore.getStorePath(),
    sessionSnapshotPath: sessionSnapshot.getStorePath(),
  });

  return migrationStatus;
}

/**
 * Get current migration status
 */
export function getMigrationStatus(): MigrationStatus {
  return { ...migrationStatus };
}
