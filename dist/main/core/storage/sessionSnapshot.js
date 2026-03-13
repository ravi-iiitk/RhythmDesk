"use strict";
/**
 * SessionSnapshotPersistence - Debounced Session State Snapshots
 *
 * Persists session state snapshots for restart recovery.
 * Uses electron-store with debounced writes to avoid excessive disk I/O.
 *
 * This is SEPARATE from ConfigStore to maintain clear separation:
 * - ConfigStore: User configuration (schedules, settings)
 * - SessionSnapshot: Runtime state snapshots for recovery
 *
 * Snapshot Strategy:
 * - Debounce: 5 seconds (don't write on every tick)
 * - Immediate write on critical state changes (phase change, pause, etc.)
 * - Load on startup for recovery
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionSnapshot = void 0;
const electron_store_1 = __importDefault(require("electron-store"));
const types_1 = require("../../shared/types");
const logger_1 = __importDefault(require("../logger"));
// Current schema version
const SNAPSHOT_SCHEMA_VERSION = 1;
// Debounce interval in ms (5 seconds)
const SNAPSHOT_DEBOUNCE_MS = 5000;
// Maximum age for a valid snapshot (24 hours)
const MAX_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * Migrate legacy session state to new format
 */
function migrateSessionState(state) {
    // Convert legacy single postponeCountToday to per-break counts
    const legacyCount = state.postponeCountToday ?? 0;
    const postponeCountsToday = state.postponeCountsToday ?? {
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
        interruptedFlowIndex: state.interruptedFlowIndex,
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
        prePostponeFlowIndex: state.prePostponeFlowIndex,
        currentFlowStepIndex: state.currentFlowStepIndex,
        flowConfigHash: state.flowConfigHash,
    };
}
/**
 * SessionSnapshotPersistence class - singleton for session snapshots
 */
class SessionSnapshotPersistence {
    constructor() {
        this.debounceTimer = null;
        this.pendingSnapshot = null;
        this.store = new electron_store_1.default({
            name: 'session-snapshot',
            defaults: {
                snapshot: { ...types_1.INITIAL_SESSION_STATE },
                savedAt: 0,
                schemaVersion: SNAPSHOT_SCHEMA_VERSION,
            },
        });
        logger_1.default.info('SessionSnapshot', 'Initialized', {
            path: this.store.path,
        });
    }
    static getInstance() {
        if (!SessionSnapshotPersistence.instance) {
            SessionSnapshotPersistence.instance = new SessionSnapshotPersistence();
        }
        return SessionSnapshotPersistence.instance;
    }
    // For testing - reset singleton
    static resetInstance() {
        if (SessionSnapshotPersistence.instance) {
            SessionSnapshotPersistence.instance.cancelPending();
        }
        SessionSnapshotPersistence.instance = null;
    }
    getStorePath() {
        return this.store.path;
    }
    /**
     * Load session snapshot for recovery
     * Returns null if snapshot is too old or invalid
     */
    loadSnapshot() {
        try {
            const savedAt = this.store.get('savedAt');
            const snapshot = this.store.get('snapshot');
            // Check if snapshot is too old
            if (savedAt && Date.now() - savedAt > MAX_SNAPSHOT_AGE_MS) {
                logger_1.default.info('SessionSnapshot', 'Snapshot too old, discarding', {
                    savedAt: new Date(savedAt).toISOString(),
                    ageMs: Date.now() - savedAt,
                });
                return null;
            }
            // Migrate and validate
            const migrated = migrateSessionState(snapshot);
            logger_1.default.info('SessionSnapshot', 'Loaded snapshot', {
                activeScheduleId: migrated.activeScheduleId,
                currentPhase: migrated.currentPhase,
                savedAt: savedAt ? new Date(savedAt).toISOString() : 'never',
            });
            return migrated;
        }
        catch (error) {
            logger_1.default.error('SessionSnapshot', 'Failed to load snapshot', { error });
            return null;
        }
    }
    /**
     * Save session snapshot (debounced)
     * Call this frequently - actual writes are debounced
     */
    saveSnapshot(state) {
        this.pendingSnapshot = state;
        // If already debouncing, let it continue
        if (this.debounceTimer) {
            return;
        }
        // Start debounce timer
        this.debounceTimer = setTimeout(() => {
            this.flushPending();
        }, SNAPSHOT_DEBOUNCE_MS);
    }
    /**
     * Save snapshot immediately (for critical state changes)
     * Use sparingly - only for phase changes, pause, etc.
     */
    saveSnapshotImmediate(state) {
        this.cancelPending();
        this.writeSnapshot(state);
    }
    /**
     * Flush any pending snapshot
     * Call on app shutdown
     */
    flushPending() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        if (this.pendingSnapshot) {
            this.writeSnapshot(this.pendingSnapshot);
            this.pendingSnapshot = null;
        }
    }
    /**
     * Cancel pending snapshot write
     */
    cancelPending() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.pendingSnapshot = null;
    }
    /**
     * Write snapshot to disk
     */
    writeSnapshot(state) {
        try {
            this.store.set('snapshot', state);
            this.store.set('savedAt', Date.now());
            logger_1.default.debug('SessionSnapshot', 'Snapshot saved', {
                currentPhase: state.currentPhase,
                activeScheduleId: state.activeScheduleId,
            });
        }
        catch (error) {
            logger_1.default.error('SessionSnapshot', 'Failed to save snapshot', { error });
        }
    }
    /**
     * Clear snapshot (e.g., on session reset)
     */
    clearSnapshot() {
        this.cancelPending();
        this.store.set('snapshot', { ...types_1.INITIAL_SESSION_STATE });
        this.store.set('savedAt', 0);
        logger_1.default.info('SessionSnapshot', 'Snapshot cleared');
    }
    /**
     * Import legacy session state from config.json
     */
    importLegacyState(legacyState) {
        const migrated = migrateSessionState(legacyState);
        this.writeSnapshot(migrated);
        logger_1.default.info('SessionSnapshot', 'Imported legacy session state');
    }
    /**
     * Get initial state (for fresh starts or failed recovery)
     */
    getInitialState() {
        return {
            ...types_1.INITIAL_SESSION_STATE,
            postponeCountsToday: { ...types_1.INITIAL_POSTPONE_COUNTS },
            breakCountResetDate: new Date().toISOString().split('T')[0],
            postponeResetDate: new Date().toISOString().split('T')[0],
        };
    }
}
SessionSnapshotPersistence.instance = null;
exports.sessionSnapshot = SessionSnapshotPersistence.getInstance();
exports.default = exports.sessionSnapshot;
//# sourceMappingURL=sessionSnapshot.js.map