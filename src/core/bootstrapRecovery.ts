/**
 * RhythmDesk Bootstrap Recovery Module
 * 
 * ARCHITECTURE HARDENING: Explicit startup and recovery ordering
 * 
 * This module defines the deterministic startup sequence and recovery logic.
 * All initialization must follow this order to avoid competing loads.
 * 
 * BOOTSTRAP SEQUENCE:
 * 
 * 1. INITIALIZE STORAGE
 *    - Initialize config store (electron-store)
 *    - Initialize session snapshot persistence
 *    - Run any pending migrations
 * 
 * 2. LOAD DURABLE CONFIG
 *    - Load schedules from config store
 *    - Load general settings from config store
 *    - Create default schedules if none exist
 * 
 * 3. LOAD RUNTIME SNAPSHOT
 *    - Load persisted session snapshot
 *    - Validate snapshot age (reject if >24h old)
 *    - Validate snapshot integrity
 * 
 * 4. VALIDATE AND NORMALIZE
 *    - Check snapshot against current schedule config
 *    - Normalize any inconsistencies
 *    - Decide if snapshot can be resumed
 * 
 * 5. INITIALIZE TIMER ENGINE
 *    - Create timer engine with validated state
 *    - Initialize runtime flow snapshot
 *    - Start tick interval
 * 
 * 6. INITIALIZE UI
 *    - Create tray
 *    - Create main window
 *    - Register IPC handlers
 * 
 * RECOVERY DECISION MATRIX:
 * 
 * | Condition                    | Action                      |
 * |------------------------------|---------------------------- |
 * | No snapshot                  | Start fresh (idle)          |
 * | Snapshot >24h old            | Start fresh (idle)          |
 * | Snapshot schedule not found  | Start fresh (idle)          |
 * | Snapshot phase ended >5min   | Reset to first work phase   |
 * | Snapshot phase ended <5min   | Advance to next phase       |
 * | Snapshot valid               | Resume from snapshot        |
 * | Snapshot invalid             | Normalize and resume        |
 */

import { SessionState, Schedule, PhaseType, INITIAL_SESSION_STATE, computeFlowConfigHash } from '../shared/types';
import { isFlowBasedSchedule } from './flowUtils';
import { validateSessionState, normalizeSessionState } from './sessionValidator';
import { findFirstWorkPhaseIndex } from './transitions';
import logger from './logger';

// ============================================================
// BOOTSTRAP CONFIGURATION
// ============================================================

export interface BootstrapConfig {
  // Maximum age of snapshot to consider for recovery (ms)
  maxSnapshotAgeMs: number;
  
  // Maximum time since phase ended to advance vs reset (ms)
  stalePhaseThresholdMs: number;
  
  // Whether to log detailed bootstrap steps
  verboseLogging: boolean;
}

export const DEFAULT_BOOTSTRAP_CONFIG: BootstrapConfig = {
  maxSnapshotAgeMs: 24 * 60 * 60 * 1000, // 24 hours
  stalePhaseThresholdMs: 5 * 60 * 1000, // 5 minutes
  verboseLogging: true,
};

// ============================================================
// BOOTSTRAP STEP TRACKING
// ============================================================

export enum BootstrapStep {
  NOT_STARTED = 'not_started',
  STORAGE_INIT = 'storage_init',
  CONFIG_LOAD = 'config_load',
  SNAPSHOT_LOAD = 'snapshot_load',
  VALIDATE_NORMALIZE = 'validate_normalize',
  TIMER_INIT = 'timer_init',
  UI_INIT = 'ui_init',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

export interface BootstrapState {
  currentStep: BootstrapStep;
  startedAt: number;
  completedAt: number | null;
  steps: {
    step: BootstrapStep;
    status: 'pending' | 'running' | 'completed' | 'failed';
    startedAt: number | null;
    completedAt: number | null;
    error: string | null;
  }[];
}

/**
 * Create initial bootstrap state
 */
export function createBootstrapState(): BootstrapState {
  const steps: BootstrapStep[] = [
    BootstrapStep.STORAGE_INIT,
    BootstrapStep.CONFIG_LOAD,
    BootstrapStep.SNAPSHOT_LOAD,
    BootstrapStep.VALIDATE_NORMALIZE,
    BootstrapStep.TIMER_INIT,
    BootstrapStep.UI_INIT,
  ];
  
  return {
    currentStep: BootstrapStep.NOT_STARTED,
    startedAt: Date.now(),
    completedAt: null,
    steps: steps.map(step => ({
      step,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      error: null,
    })),
  };
}

// ============================================================
// RECOVERY DECISION
// ============================================================

export type RecoveryDecision = 
  | { action: 'start_fresh'; reason: string }
  | { action: 'reset_to_work'; reason: string; scheduleId: string }
  | { action: 'advance_phase'; reason: string; scheduleId: string }
  | { action: 'resume'; reason: string; scheduleId: string };

/**
 * Decide recovery action based on snapshot state
 */
export function decideRecoveryAction(
  snapshot: SessionState | null,
  schedules: Schedule[],
  config: BootstrapConfig = DEFAULT_BOOTSTRAP_CONFIG
): RecoveryDecision {
  const now = Date.now();
  
  // No snapshot - start fresh
  if (!snapshot) {
    return {
      action: 'start_fresh',
      reason: 'No session snapshot found',
    };
  }
  
  // Check snapshot age
  const snapshotAge = now - (snapshot.phaseStartedAt || 0);
  if (snapshotAge > config.maxSnapshotAgeMs) {
    return {
      action: 'start_fresh',
      reason: `Snapshot too old: ${Math.round(snapshotAge / 3600000)}h`,
    };
  }
  
  // Find the schedule from snapshot
  const schedule = schedules.find(s => s.id === snapshot.activeScheduleId);
  if (!schedule) {
    return {
      action: 'start_fresh',
      reason: `Schedule not found: ${snapshot.activeScheduleId}`,
    };
  }
  
  // Check if phase ended
  if (snapshot.phaseEndsAt > 0 && snapshot.phaseEndsAt < now) {
    const timeSinceEnded = now - snapshot.phaseEndsAt;
    
    if (timeSinceEnded > config.stalePhaseThresholdMs) {
      return {
        action: 'reset_to_work',
        reason: `Phase ended ${Math.round(timeSinceEnded / 60000)}min ago`,
        scheduleId: schedule.id,
      };
    }
    
    return {
      action: 'advance_phase',
      reason: `Phase ended ${Math.round(timeSinceEnded / 1000)}s ago`,
      scheduleId: schedule.id,
    };
  }
  
  // Snapshot is valid for resume
  return {
    action: 'resume',
    reason: 'Valid snapshot found',
    scheduleId: schedule.id,
  };
}

// ============================================================
// STATE RECOVERY
// ============================================================

export interface RecoveryResult {
  state: SessionState;
  schedule: Schedule | null;
  decision: RecoveryDecision;
  normalized: boolean;
  changes: string[];
}

/**
 * Recover session state from snapshot
 */
export function recoverSessionState(
  snapshot: SessionState | null,
  schedules: Schedule[],
  config: BootstrapConfig = DEFAULT_BOOTSTRAP_CONFIG
): RecoveryResult {
  const decision = decideRecoveryAction(snapshot, schedules, config);
  const changes: string[] = [];
  
  logger.info('BootstrapRecovery', 'Recovery decision', {
    action: decision.action,
    reason: decision.reason,
  });
  
  switch (decision.action) {
    case 'start_fresh': {
      return {
        state: { ...INITIAL_SESSION_STATE },
        schedule: null,
        decision,
        normalized: false,
        changes: ['Started fresh - no valid snapshot'],
      };
    }
    
    case 'reset_to_work': {
      const schedule = schedules.find(s => s.id === (decision as { scheduleId: string }).scheduleId)!;
      const state = createResetState(schedule);
      changes.push('Reset to first work phase due to stale snapshot');
      
      return {
        state,
        schedule,
        decision,
        normalized: false,
        changes,
      };
    }
    
    case 'advance_phase': {
      // For advance, we'd need the timer engine logic
      // For now, treat similar to resume but flag for advance
      const schedule = schedules.find(s => s.id === (decision as { scheduleId: string }).scheduleId)!;
      const state = { ...snapshot! };
      changes.push('Snapshot phase ended recently - will advance on first tick');
      
      return {
        state,
        schedule,
        decision,
        normalized: false,
        changes,
      };
    }
    
    case 'resume': {
      const schedule = schedules.find(s => s.id === (decision as { scheduleId: string }).scheduleId)!;
      let state = { ...snapshot! };
      
      // Validate and normalize
      const validation = validateSessionState(state, schedule);
      if (!validation.valid || validation.warnings.length > 0) {
        const normalization = normalizeSessionState(state, schedule);
        if (normalization.changed) {
          state = normalization.state;
          changes.push(...normalization.changes);
        }
      }
      
      return {
        state,
        schedule,
        decision,
        normalized: changes.length > 0,
        changes,
      };
    }
  }
}

/**
 * Create a clean reset state for a schedule
 */
function createResetState(schedule: Schedule): SessionState {
  const now = Date.now();
  const today = new Date().toISOString().split('T')[0];
  
  let currentPhase: PhaseType = 'sit';
  let currentFlowStepIndex: number | undefined;
  let phaseDurationMs = schedule.sitMinutes * 60 * 1000;
  let flowConfigHash: string | undefined;
  
  if (isFlowBasedSchedule(schedule)) {
    const flowSteps = schedule.flowSteps!;
    const startIndex = findFirstWorkPhaseIndex(flowSteps);
    currentPhase = flowSteps[startIndex].type;
    currentFlowStepIndex = startIndex;
    
    const step = flowSteps[startIndex];
    phaseDurationMs = step.durationSeconds * 1000;
    flowConfigHash = computeFlowConfigHash(flowSteps);
  }
  
  return {
    activeScheduleId: schedule.id,
    currentPhase,
    phaseStartedAt: now,
    phaseEndsAt: now + phaseDurationMs,
    phaseRemainingMs: phaseDurationMs,
    phaseTotalMs: phaseDurationMs,
    currentFlowStepIndex,
    flowConfigHash,
    cumulativeWorkTimeMs: 0,
    lastShortBreakAtWorkTimeMs: 0,
    lastLongBreakAtWorkTimeMs: 0,
    shortBreakCountToday: 0,
    longBreakCountToday: 0,
    breakCountResetDate: today,
    interruptedPhase: null,
    interruptedPhaseRemainingMs: 0,
    interruptedFlowIndex: undefined,
    postponeCountsToday: {
      sitToStandTransition: 0,
      standToSitTransition: 0,
      shortBreak: 0,
      longBreak: 0,
    },
    postponeResetDate: today,
    isPaused: false,
    pausedAt: null,
    pauseResumeAt: null,
    isPostponed: false,
    postponedUntil: null,
    postponedPhase: null,
    postponedBreakType: null,
    prePostponeWorkPhase: null,
    prePostponeWorkPhaseRemainingMs: 0,
    prePostponeFlowIndex: undefined,
  };
}

// ============================================================
// BOOTSTRAP LOGGING
// ============================================================

/**
 * Log bootstrap step
 */
export function logBootstrapStep(
  step: BootstrapStep,
  status: 'start' | 'complete' | 'fail',
  details?: Record<string, unknown>
): void {
  const prefix = status === 'start' ? '→' : status === 'complete' ? '✓' : '✗';
  logger.info('Bootstrap', `${prefix} ${step}`, details);
}

/**
 * Log bootstrap summary
 */
export function logBootstrapSummary(
  state: BootstrapState,
  recoveryResult: RecoveryResult
): void {
  const duration = (state.completedAt || Date.now()) - state.startedAt;
  
  logger.info('Bootstrap', 'BOOTSTRAP COMPLETE', {
    durationMs: duration,
    recoveryAction: recoveryResult.decision.action,
    scheduleId: recoveryResult.schedule?.id || 'none',
    normalized: recoveryResult.normalized,
    changes: recoveryResult.changes,
  });
}
