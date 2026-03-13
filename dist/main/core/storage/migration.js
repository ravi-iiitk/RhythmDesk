"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.needsMigration = needsMigration;
exports.runMigration = runMigration;
exports.initializeStorage = initializeStorage;
exports.getMigrationStatus = getMigrationStatus;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const configStore_1 = require("./configStore");
const sessionSnapshot_1 = require("./sessionSnapshot");
const logger_1 = __importDefault(require("../logger"));
const constants_1 = require("../../shared/constants");
let migrationStatus = {
    migrated: false,
    migratedAt: null,
    legacyPath: null,
    schedulesCount: 0,
    hadSessionState: false,
};
/**
 * Check if legacy config.json exists and needs migration
 */
function needsMigration() {
    try {
        const userDataPath = electron_1.app.getPath('userData');
        const legacyPath = path.join(userDataPath, constants_1.CONFIG_FILENAME);
        // Check if legacy file exists
        if (!fs.existsSync(legacyPath)) {
            logger_1.default.debug('Migration', 'No legacy config.json found - fresh install');
            return false;
        }
        // Check if already migrated (backup file exists)
        const backupPath = legacyPath + '.migrated';
        if (fs.existsSync(backupPath)) {
            logger_1.default.debug('Migration', 'Migration already completed - backup exists');
            return false;
        }
        // Check if ConfigStore already has data (electron-store)
        // If it has schedules, migration was likely already done
        const existingSchedules = configStore_1.configStore.getSchedules();
        if (existingSchedules.length > 0) {
            logger_1.default.debug('Migration', 'ConfigStore already has schedules - skipping migration');
            return false;
        }
        logger_1.default.info('Migration', 'Legacy config.json found - migration needed', { legacyPath });
        return true;
    }
    catch (error) {
        logger_1.default.error('Migration', 'Error checking migration status', { error });
        return false;
    }
}
/**
 * Run migration from legacy config.json to new hybrid storage
 */
function runMigration() {
    const userDataPath = electron_1.app.getPath('userData');
    const legacyPath = path.join(userDataPath, constants_1.CONFIG_FILENAME);
    try {
        logger_1.default.info('Migration', '=== Starting migration from legacy config.json ===');
        migrationStatus.legacyPath = legacyPath;
        // Read legacy config
        const legacyData = fs.readFileSync(legacyPath, 'utf-8');
        const legacyConfig = JSON.parse(legacyData);
        // Import schedules and general settings into ConfigStore
        if (legacyConfig.schedules || legacyConfig.generalSettings) {
            configStore_1.configStore.importLegacyConfig({
                schedules: legacyConfig.schedules,
                generalSettings: legacyConfig.generalSettings,
            });
            migrationStatus.schedulesCount = legacyConfig.schedules?.length ?? 0;
        }
        // Import session state into SessionSnapshot
        if (legacyConfig.sessionState) {
            sessionSnapshot_1.sessionSnapshot.importLegacyState(legacyConfig.sessionState);
            migrationStatus.hadSessionState = true;
        }
        // Backup legacy file
        const backupPath = legacyPath + '.migrated';
        fs.renameSync(legacyPath, backupPath);
        logger_1.default.info('Migration', 'Legacy config backed up', { backupPath });
        migrationStatus.migrated = true;
        migrationStatus.migratedAt = Date.now();
        logger_1.default.info('Migration', '=== Migration completed successfully ===', {
            schedulesCount: migrationStatus.schedulesCount,
            hadSessionState: migrationStatus.hadSessionState,
            configStorePath: configStore_1.configStore.getStorePath(),
            sessionSnapshotPath: sessionSnapshot_1.sessionSnapshot.getStorePath(),
        });
        return migrationStatus;
    }
    catch (error) {
        logger_1.default.error('Migration', 'Migration failed', { error, legacyPath });
        // Don't throw - let app continue with fresh state
        // User's legacy config is still intact
        return migrationStatus;
    }
}
/**
 * Initialize storage with migration if needed
 * Call this once during app startup
 */
function initializeStorage() {
    logger_1.default.info('Migration', 'Initializing hybrid storage architecture');
    if (needsMigration()) {
        return runMigration();
    }
    logger_1.default.info('Migration', 'Storage initialized', {
        configStorePath: configStore_1.configStore.getStorePath(),
        sessionSnapshotPath: sessionSnapshot_1.sessionSnapshot.getStorePath(),
    });
    return migrationStatus;
}
/**
 * Get current migration status
 */
function getMigrationStatus() {
    return { ...migrationStatus };
}
//# sourceMappingURL=migration.js.map