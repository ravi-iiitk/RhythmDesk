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

import Store from 'electron-store';
import {
  SessionState,
  PostponeCountsToday,
  INITIAL_SESSION_STATE,
  INITIAL_POSTPONE_COUNTS,
} from '../../shared/types';
import logger from '../logger';

// Snapshot schema
interface SessionSnapshotSchema {
  snapshot: SessionState;
  savedAt: number;
  schemaVersion: number;
}

// Current schema version
const SNAPSHOT_SCHEMA_VERSION = 1;

// Debounce interval in ms (5 seconds)
const SNAPSHOT_DEBOUNCE_MS = 5000;

// Maximum age for a valid snapshot (24 hours)
const MAX_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000;

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
    interruptedFlowIndex: state.interruptedFlowIndex,
    postponeCountsToday,
    postponeResetDate: state.postponeResetDate ?? new Date().toISOString().split('T')[0],
    isWaitingForNextActivity: state.isWaitingForNextActivity ?? false,
    waitingNextPhase: state.waitingNextPhase ?? null,
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
  private store: Store<SessionSnapshotSchema>;
  private static instance: SessionSnapshotPersistence | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingSnapshot: SessionState | null = null;

  private constructor() {
    this.store = new Store<SessionSnapshotSchema>({
      name: 'session-snapshot',
      defaults: {
        snapshot: { ...INITIAL_SESSION_STATE },
        savedAt: 0,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      },
    });

    logger.info('SessionSnapshot', 'Initialized', {
      path: this.store.path,
    });
  }

  static getInstance(): SessionSnapshotPersistence {
    if (!SessionSnapshotPersistence.instance) {
      SessionSnapshotPersistence.instance = new SessionSnapshotPersistence();
    }
    return SessionSnapshotPersistence.instance;
  }

  // For testing - reset singleton
  static resetInstance(): void {
    if (SessionSnapshotPersistence.instance) {
      SessionSnapshotPersistence.instance.cancelPending();
    }
    SessionSnapshotPersistence.instance = null;
  }

  getStorePath(): string {
    return this.store.path;
  }

  /**
   * Load session snapshot for recovery
   * Returns null if snapshot is too old or invalid
   */
  loadSnapshot(): SessionState | null {
    try {
      const savedAt = this.store.get('savedAt');
      const snapshot = this.store.get('snapshot');

      // Check if snapshot is too old
      if (savedAt && Date.now() - savedAt > MAX_SNAPSHOT_AGE_MS) {
        logger.info('SessionSnapshot', 'Snapshot too old, discarding', {
          savedAt: new Date(savedAt).toISOString(),
          ageMs: Date.now() - savedAt,
        });
        return null;
      }

      // Migrate and validate
      const migrated = migrateSessionState(snapshot);
      
      logger.info('SessionSnapshot', 'Loaded snapshot', {
        activeScheduleId: migrated.activeScheduleId,
        currentPhase: migrated.currentPhase,
        savedAt: savedAt ? new Date(savedAt).toISOString() : 'never',
      });

      return migrated;
    } catch (error) {
      logger.error('SessionSnapshot', 'Failed to load snapshot', { error });
      return null;
    }
  }

  /**
   * Save session snapshot (debounced)
   * Call this frequently - actual writes are debounced
   */
  saveSnapshot(state: SessionState): void {
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
  saveSnapshotImmediate(state: SessionState): void {
    this.cancelPending();
    this.writeSnapshot(state);
  }

  /**
   * Flush any pending snapshot
   * Call on app shutdown
   */
  flushPending(): void {
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
  cancelPending(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingSnapshot = null;
  }

  /**
   * Write snapshot to disk
   */
  private writeSnapshot(state: SessionState): void {
    try {
      this.store.set('snapshot', state);
      this.store.set('savedAt', Date.now());
      logger.debug('SessionSnapshot', 'Snapshot saved', {
        currentPhase: state.currentPhase,
        activeScheduleId: state.activeScheduleId,
      });
    } catch (error) {
      logger.error('SessionSnapshot', 'Failed to save snapshot', { error });
    }
  }

  /**
   * Clear snapshot (e.g., on session reset)
   */
  clearSnapshot(): void {
    this.cancelPending();
    this.store.set('snapshot', { ...INITIAL_SESSION_STATE });
    this.store.set('savedAt', 0);
    logger.info('SessionSnapshot', 'Snapshot cleared');
  }

  /**
   * Import legacy session state from config.json
   */
  importLegacyState(legacyState: Partial<SessionState>): void {
    const migrated = migrateSessionState(legacyState);
    this.writeSnapshot(migrated);
    logger.info('SessionSnapshot', 'Imported legacy session state');
  }

  /**
   * Get initial state (for fresh starts or failed recovery)
   */
  getInitialState(): SessionState {
    return {
      ...INITIAL_SESSION_STATE,
      postponeCountsToday: { ...INITIAL_POSTPONE_COUNTS },
      breakCountResetDate: new Date().toISOString().split('T')[0],
      postponeResetDate: new Date().toISOString().split('T')[0],
    };
  }
}

export const sessionSnapshot = SessionSnapshotPersistence.getInstance();
export default sessionSnapshot;
