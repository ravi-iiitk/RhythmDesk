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

export { configStore } from './configStore';
export { sessionSnapshot } from './sessionSnapshot';
export { initializeStorage, needsMigration, runMigration, getMigrationStatus } from './migration';
