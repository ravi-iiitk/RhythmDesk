"use strict";
/**
 * Storage Module - Hybrid Storage Architecture
 *
 * This module provides the storage layer for RhythmDesk:
 *
 * 1. ConfigStore - Durable configuration using electron-store
 *    - schedules, generalSettings, restBlockPresets
 *    - Persists across app restarts
 *    - User configuration only
 *
 * 2. SessionSnapshot - Debounced session state snapshots
 *    - Runtime state snapshots for recovery
 *    - Debounced writes (5s) to avoid excessive I/O
 *    - Immediate write on critical state changes
 *
 * 3. Migration - Migrate from legacy config.json
 *    - One-time migration on first run
 *    - Preserves user data
 *    - Creates backup of legacy file
 *
 * The LIVE session state is kept IN-MEMORY by timerEngine.
 * Snapshots are only for recovery after restart.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMigrationStatus = exports.runMigration = exports.needsMigration = exports.initializeStorage = exports.sessionSnapshot = exports.configStore = void 0;
var configStore_1 = require("./configStore");
Object.defineProperty(exports, "configStore", { enumerable: true, get: function () { return configStore_1.configStore; } });
var sessionSnapshot_1 = require("./sessionSnapshot");
Object.defineProperty(exports, "sessionSnapshot", { enumerable: true, get: function () { return sessionSnapshot_1.sessionSnapshot; } });
var migration_1 = require("./migration");
Object.defineProperty(exports, "initializeStorage", { enumerable: true, get: function () { return migration_1.initializeStorage; } });
Object.defineProperty(exports, "needsMigration", { enumerable: true, get: function () { return migration_1.needsMigration; } });
Object.defineProperty(exports, "runMigration", { enumerable: true, get: function () { return migration_1.runMigration; } });
Object.defineProperty(exports, "getMigrationStatus", { enumerable: true, get: function () { return migration_1.getMigrationStatus; } });
//# sourceMappingURL=index.js.map