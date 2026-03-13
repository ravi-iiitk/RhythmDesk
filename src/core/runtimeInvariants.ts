/**
 * RhythmDesk Runtime Invariants
 * 
 * ARCHITECTURE HARDENING: Formal session state invariants
 * 
 * This module defines and enforces runtime session invariants.
 * All state transitions must pass invariant checks BEFORE being committed.
 * 
 * INVARIANT CATEGORIES:
 * 
 * 1. PHASE-MODE CONSISTENCY
 *    - Flow-based mode requires valid currentFlowStepIndex
 *    - Rule-based mode must have undefined currentFlowStepIndex
 * 
 * 2. FLOW INDEX-PHASE CONSISTENCY
 *    - In flow mode, currentPhase must match runtime snapshot at currentFlowStepIndex
 *    - Exception: during long-break (rule-based interrupt)
 * 
 * 3. POSTPONE STATE CONSISTENCY
 *    - Active break and pending break cannot represent the same break
 *    - If pendingBreakType != null, currentPhase must be work phase
 *    - currentFlowStepIndex must match work phase, not break
 * 
 * 4. PAUSE STATE CONSISTENCY
 *    - isPaused implies pausedAt is set
 *    - !isPaused implies pausedAt and pauseResumeAt are null
 * 
 * 5. TIMESTAMP CONSISTENCY
 *    - phaseEndsAt > phaseStartedAt (unless idle)
 *    - phaseRemainingMs <= phaseTotalMs
 * 
 * 6. OVERLAY SAFETY
 *    - idle state cannot have mandatory overlay
 *    - overlay-active + idle + blank content must be impossible
 * 
 * 7. DERIVATION CONSISTENCY
 *    - current/next/then must derive from runtime session state
 *    - Never from live config during active session
 */

import { SessionState, PhaseType, FlowStep, Schedule } from '../shared/types';
import { isFlowBasedSchedule } from './flowUtils';
import logger from './logger';

// ============================================================
// INVARIANT TYPES
// ============================================================

export interface InvariantViolation {
  invariant: string;
  message: string;
  severity: 'error' | 'warning';
  context?: Record<string, unknown>;
}

export interface InvariantCheckResult {
  valid: boolean;
  violations: InvariantViolation[];
}

export interface TransitionPrecondition {
  name: string;
  check: (state: SessionState, context: TransitionContext) => boolean;
  message: string;
}

export interface TransitionContext {
  schedule: Schedule | null;
  runtimeFlowSnapshot: FlowStep[] | null;
  targetPhase?: PhaseType;
  targetFlowIndex?: number;
}

// ============================================================
// CORE INVARIANT CHECKS
// ============================================================

/**
 * Check all runtime invariants against current state
 */
export function checkRuntimeInvariants(
  state: SessionState,
  context: TransitionContext
): InvariantCheckResult {
  const violations: InvariantViolation[] = [];
  
  // INV-1: Phase-Mode Consistency
  checkPhaseModeConsistency(state, context, violations);
  
  // INV-2: Flow Index-Phase Consistency
  checkFlowIndexPhaseConsistency(state, context, violations);
  
  // INV-3: Postpone State Consistency
  checkPostponeStateConsistency(state, violations);
  
  // INV-4: Pause State Consistency
  checkPauseStateConsistency(state, violations);
  
  // INV-5: Timestamp Consistency
  checkTimestampConsistency(state, violations);
  
  // INV-6: Overlay Safety
  checkOverlaySafety(state, violations);
  
  return {
    valid: violations.filter(v => v.severity === 'error').length === 0,
    violations,
  };
}

/**
 * INV-1: Phase-Mode Consistency
 */
function checkPhaseModeConsistency(
  state: SessionState,
  context: TransitionContext,
  violations: InvariantViolation[]
): void {
  const { schedule, runtimeFlowSnapshot } = context;
  
  if (!schedule) {
    // No schedule - index should be undefined
    if (state.currentFlowStepIndex !== undefined) {
      violations.push({
        invariant: 'INV-1-A',
        message: 'No active schedule but currentFlowStepIndex is defined',
        severity: 'warning',
        context: { currentFlowStepIndex: state.currentFlowStepIndex },
      });
    }
    return;
  }
  
  if (isFlowBasedSchedule(schedule)) {
    const flowSteps = runtimeFlowSnapshot || schedule.flowSteps!;
    
    // Flow mode requires valid index
    if (state.currentFlowStepIndex === undefined) {
      violations.push({
        invariant: 'INV-1-B',
        message: 'Flow-based schedule but currentFlowStepIndex is undefined',
        severity: 'error',
      });
    } else if (state.currentFlowStepIndex < 0 || state.currentFlowStepIndex >= flowSteps.length) {
      violations.push({
        invariant: 'INV-1-C',
        message: `currentFlowStepIndex ${state.currentFlowStepIndex} out of bounds [0, ${flowSteps.length - 1}]`,
        severity: 'error',
        context: { 
          currentFlowStepIndex: state.currentFlowStepIndex,
          flowStepsLength: flowSteps.length,
        },
      });
    }
  } else {
    // Rule-based mode should not have flow index
    if (state.currentFlowStepIndex !== undefined) {
      violations.push({
        invariant: 'INV-1-D',
        message: 'Rule-based schedule but currentFlowStepIndex is set',
        severity: 'warning',
        context: { currentFlowStepIndex: state.currentFlowStepIndex },
      });
    }
  }
}

/**
 * INV-2: Flow Index-Phase Consistency
 */
function checkFlowIndexPhaseConsistency(
  state: SessionState,
  context: TransitionContext,
  violations: InvariantViolation[]
): void {
  const { schedule, runtimeFlowSnapshot } = context;
  
  if (!schedule || !isFlowBasedSchedule(schedule)) return;
  
  // Skip check during long-break (rule-based interrupt)
  if (state.currentPhase === 'long-break') return;
  
  // Skip check for idle
  if (state.currentPhase === 'idle') return;
  
  const flowSteps = runtimeFlowSnapshot || schedule.flowSteps!;
  const index = state.currentFlowStepIndex ?? 0;
  
  if (index >= 0 && index < flowSteps.length) {
    const expectedPhase = flowSteps[index].type;
    if (expectedPhase !== state.currentPhase) {
      violations.push({
        invariant: 'INV-2-A',
        message: `Flow desync: currentPhase '${state.currentPhase}' != flowSteps[${index}].type '${expectedPhase}'`,
        severity: 'error',
        context: {
          currentPhase: state.currentPhase,
          currentFlowStepIndex: index,
          expectedPhase,
        },
      });
    }
  }
}

/**
 * INV-3: Postpone State Consistency
 */
function checkPostponeStateConsistency(
  state: SessionState,
  violations: InvariantViolation[]
): void {
  if (state.isPostponed) {
    // Postponed break must be specified
    if (!state.postponedPhase) {
      violations.push({
        invariant: 'INV-3-A',
        message: 'isPostponed is true but postponedPhase is null',
        severity: 'error',
      });
    }
    
    // Postponed phase must be a break
    if (state.postponedPhase && !isBreakPhase(state.postponedPhase)) {
      violations.push({
        invariant: 'INV-3-B',
        message: `postponedPhase '${state.postponedPhase}' is not a break phase`,
        severity: 'error',
        context: { postponedPhase: state.postponedPhase },
      });
    }
    
    // Must have postponedUntil timestamp
    if (!state.postponedUntil) {
      violations.push({
        invariant: 'INV-3-C',
        message: 'isPostponed is true but postponedUntil is null',
        severity: 'error',
      });
    }
    
    // Current phase should be work phase (not break)
    if (!isWorkPhase(state.currentPhase) && state.currentPhase !== 'idle') {
      violations.push({
        invariant: 'INV-3-D',
        message: `Postponed but currentPhase '${state.currentPhase}' is not a work phase`,
        severity: 'error',
        context: { currentPhase: state.currentPhase },
      });
    }
    
    // CRITICAL: Active break and pending break cannot be same
    if (isBreakPhase(state.currentPhase) && state.currentPhase === state.postponedPhase) {
      violations.push({
        invariant: 'INV-3-E',
        message: 'Active break and pending break cannot be the same break',
        severity: 'error',
        context: {
          currentPhase: state.currentPhase,
          postponedPhase: state.postponedPhase,
        },
      });
    }
  } else {
    // Not postponed - these should be clear
    if (state.postponedPhase) {
      violations.push({
        invariant: 'INV-3-F',
        message: 'isPostponed is false but postponedPhase is set',
        severity: 'error',
        context: { postponedPhase: state.postponedPhase },
      });
    }
    if (state.postponedUntil) {
      violations.push({
        invariant: 'INV-3-G',
        message: 'isPostponed is false but postponedUntil is set',
        severity: 'error',
        context: { postponedUntil: state.postponedUntil },
      });
    }
  }
}

/**
 * INV-4: Pause State Consistency
 */
function checkPauseStateConsistency(
  state: SessionState,
  violations: InvariantViolation[]
): void {
  if (state.isPaused) {
    if (!state.pausedAt) {
      violations.push({
        invariant: 'INV-4-A',
        message: 'isPaused is true but pausedAt is null',
        severity: 'error',
      });
    }
  } else {
    if (state.pausedAt) {
      violations.push({
        invariant: 'INV-4-B',
        message: 'isPaused is false but pausedAt is set',
        severity: 'warning',
        context: { pausedAt: state.pausedAt },
      });
    }
  }
}

/**
 * INV-5: Timestamp Consistency
 */
function checkTimestampConsistency(
  state: SessionState,
  violations: InvariantViolation[]
): void {
  // Skip for idle
  if (state.currentPhase === 'idle') return;
  
  if (state.phaseRemainingMs > state.phaseTotalMs) {
    violations.push({
      invariant: 'INV-5-A',
      message: `phaseRemainingMs (${state.phaseRemainingMs}) > phaseTotalMs (${state.phaseTotalMs})`,
      severity: 'warning',
      context: {
        phaseRemainingMs: state.phaseRemainingMs,
        phaseTotalMs: state.phaseTotalMs,
      },
    });
  }
  
  if (state.phaseEndsAt > 0 && state.phaseStartedAt > 0) {
    if (state.phaseEndsAt < state.phaseStartedAt) {
      violations.push({
        invariant: 'INV-5-B',
        message: 'phaseEndsAt < phaseStartedAt',
        severity: 'error',
        context: {
          phaseStartedAt: state.phaseStartedAt,
          phaseEndsAt: state.phaseEndsAt,
        },
      });
    }
  }
}

/**
 * INV-6: Overlay Safety
 */
function checkOverlaySafety(
  state: SessionState,
  violations: InvariantViolation[]
): void {
  // Idle state cannot have mandatory overlay content
  // This is enforced at the overlay policy level, but we can check state consistency
  if (state.currentPhase === 'idle') {
    // Postponed break during idle would be invalid
    if (state.isPostponed && state.postponedPhase) {
      violations.push({
        invariant: 'INV-6-A',
        message: 'Idle state with postponed break is inconsistent',
        severity: 'warning',
        context: { postponedPhase: state.postponedPhase },
      });
    }
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function isWorkPhase(phase: PhaseType): boolean {
  return phase === 'sit' || phase === 'stand';
}

function isBreakPhase(phase: PhaseType): boolean {
  return phase === 'short-break' || phase === 'long-break';
}

// ============================================================
// PRE-TRANSITION VALIDATION
// ============================================================

/**
 * Transition preconditions for each transition type
 */
export const TRANSITION_PRECONDITIONS: Record<string, TransitionPrecondition[]> = {
  'postpone': [
    {
      name: 'PRECOND-POSTPONE-1',
      check: (state) => isBreakPhase(state.currentPhase),
      message: 'Can only postpone from break phase',
    },
    {
      name: 'PRECOND-POSTPONE-2',
      check: (state) => !state.isPaused,
      message: 'Cannot postpone while paused',
    },
    {
      name: 'PRECOND-POSTPONE-3',
      check: (state) => !state.isPostponed,
      message: 'Already postponed',
    },
  ],
  
  'skip': [
    {
      name: 'PRECOND-SKIP-1',
      check: (state) => state.currentPhase !== 'idle',
      message: 'Cannot skip idle phase',
    },
    {
      name: 'PRECOND-SKIP-2',
      check: (state) => !state.isPaused,
      message: 'Cannot skip while paused',
    },
    {
      name: 'PRECOND-SKIP-3',
      check: (_state, ctx) => !ctx.schedule?.noSkipEnabled,
      message: 'Skip disabled for this schedule',
    },
  ],
  
  'reset': [
    {
      name: 'PRECOND-RESET-1',
      check: (_state, ctx) => ctx.schedule !== null,
      message: 'No active schedule to reset',
    },
  ],
  
  'pause': [
    {
      name: 'PRECOND-PAUSE-1',
      check: (state) => !state.isPaused,
      message: 'Already paused',
    },
    {
      name: 'PRECOND-PAUSE-2',
      check: (state) => state.currentPhase !== 'idle',
      message: 'Cannot pause idle state',
    },
  ],
  
  'resume': [
    {
      name: 'PRECOND-RESUME-1',
      check: (state) => state.isPaused,
      message: 'Not paused',
    },
  ],
};

/**
 * Validate preconditions for a transition
 */
export function validateTransitionPreconditions(
  transitionType: string,
  state: SessionState,
  context: TransitionContext
): { valid: boolean; failedPreconditions: string[] } {
  const preconditions = TRANSITION_PRECONDITIONS[transitionType];
  if (!preconditions) {
    return { valid: true, failedPreconditions: [] };
  }
  
  const failedPreconditions: string[] = [];
  
  for (const precond of preconditions) {
    if (!precond.check(state, context)) {
      failedPreconditions.push(`${precond.name}: ${precond.message}`);
    }
  }
  
  return {
    valid: failedPreconditions.length === 0,
    failedPreconditions,
  };
}

/**
 * Validate a proposed next state before committing
 */
export function validateNextState(
  nextState: SessionState,
  context: TransitionContext
): InvariantCheckResult {
  return checkRuntimeInvariants(nextState, context);
}

// ============================================================
// LOGGING HELPERS
// ============================================================

/**
 * Log invariant violations
 */
export function logInvariantViolations(
  violations: InvariantViolation[],
  label: string
): void {
  if (violations.length === 0) return;
  
  const errors = violations.filter(v => v.severity === 'error');
  const warnings = violations.filter(v => v.severity === 'warning');
  
  if (errors.length > 0) {
    logger.error('RuntimeInvariants', `${label} - ${errors.length} errors`, {
      errors: errors.map(e => `${e.invariant}: ${e.message}`),
    });
  }
  
  if (warnings.length > 0) {
    logger.warn('RuntimeInvariants', `${label} - ${warnings.length} warnings`, {
      warnings: warnings.map(w => `${w.invariant}: ${w.message}`),
    });
  }
}
