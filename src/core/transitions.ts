/**
 * RhythmDesk Transition Model
 * Explicit state transitions for timer/session behavior
 * 
 * This module defines the allowed transitions and provides helpers
 * to ensure state changes follow correct semantics.
 */

import { PhaseType, Schedule, FlowStep } from '../shared/types';
import { isFlowBasedSchedule, getFlowStepDurationMs } from './flowUtils';
import { minutesToMs, secondsToMs } from '../shared/timeUtils';
import logger from './logger';

/**
 * Transition types that can occur in the timer engine
 */
export enum TransitionType {
  // Normal flow
  PHASE_COMPLETED = 'phase:completed',
  
  // User actions
  SKIP_REQUESTED = 'skip:requested',
  POSTPONE_REQUESTED = 'postpone:requested',
  RESET_REQUESTED = 'reset:requested',
  PAUSE_REQUESTED = 'pause:requested',
  RESUME_REQUESTED = 'resume:requested',
  COMPLETE_REQUESTED = 'complete:requested',
  
  // Automatic triggers
  POSTPONE_ENDED = 'postpone:ended',
  PAUSE_ENDED = 'pause:ended',
  SHORT_BREAK_DUE = 'break:short:due',
  LONG_BREAK_DUE = 'break:long:due',
  
  // Schedule changes
  SCHEDULE_ACTIVATED = 'schedule:activated',
  SCHEDULE_DEACTIVATED = 'schedule:deactivated',
  SCHEDULE_CHANGED = 'schedule:changed',
}

/**
 * Result of computing the next phase in a flow
 */
export interface FlowAdvanceResult {
  nextIndex: number;
  nextPhase: PhaseType;
  nextDurationMs: number;
}

/**
 * Compute the next phase when advancing in flow-based mode
 * This is the single source of truth for flow advancement
 */
export function computeNextFlowPhase(
  currentIndex: number,
  flowSteps: FlowStep[],
  isAfterLongBreak: boolean = false
): FlowAdvanceResult {
  if (flowSteps.length === 0) {
    return { nextIndex: 0, nextPhase: 'idle', nextDurationMs: 0 };
  }
  
  // After long break, restart from first step (index 0)
  if (isAfterLongBreak) {
    const firstStep = flowSteps[0];
    return {
      nextIndex: 0,
      nextPhase: firstStep.type,
      nextDurationMs: getFlowStepDurationMs(firstStep),
    };
  }
  
  // Normal advancement: wrap around
  const nextIndex = (currentIndex + 1) % flowSteps.length;
  const nextStep = flowSteps[nextIndex];
  
  return {
    nextIndex,
    nextPhase: nextStep.type,
    nextDurationMs: getFlowStepDurationMs(nextStep),
  };
}

/**
 * Compute the "then" phase (2 steps ahead) in flow-based mode
 */
export function computeThenFlowPhase(
  currentIndex: number,
  flowSteps: FlowStep[]
): FlowAdvanceResult {
  if (flowSteps.length === 0) {
    return { nextIndex: 0, nextPhase: 'idle', nextDurationMs: 0 };
  }
  
  const thenIndex = (currentIndex + 2) % flowSteps.length;
  const thenStep = flowSteps[thenIndex];
  
  return {
    nextIndex: thenIndex,
    nextPhase: thenStep.type,
    nextDurationMs: getFlowStepDurationMs(thenStep),
  };
}

/**
 * Compute next phase for rule-based mode
 */
export function computeNextRuleBasedPhase(
  currentPhase: PhaseType,
  preBreakPhase: PhaseType | null
): PhaseType {
  switch (currentPhase) {
    case 'sit':
      return 'sit-to-stand-transition';
    case 'sit-to-stand-transition':
      return 'stand';
    case 'stand':
      return 'stand-to-sit-transition';
    case 'stand-to-sit-transition':
      return 'sit';
    case 'short-break':
      // Resume to pre-break phase if available
      return preBreakPhase && isWorkPhase(preBreakPhase) ? preBreakPhase : 'sit';
    case 'long-break':
      // After long break, always start fresh with sit
      return 'sit';
    default:
      return 'sit';
  }
}

/**
 * Compute "then" phase for rule-based mode
 */
export function computeThenRuleBasedPhase(nextPhase: PhaseType): PhaseType {
  switch (nextPhase) {
    case 'sit':
      return 'sit-to-stand-transition';
    case 'sit-to-stand-transition':
      return 'stand';
    case 'stand':
      return 'stand-to-sit-transition';
    case 'stand-to-sit-transition':
      return 'sit';
    case 'short-break':
    case 'long-break':
      return 'sit'; // After break, return to sit
    default:
      return 'idle';
  }
}

/**
 * Check if a phase is a work phase (sit or stand)
 */
export function isWorkPhase(phase: PhaseType): boolean {
  return phase === 'sit' || phase === 'stand';
}

/**
 * Check if a phase is a break phase
 */
export function isBreakPhase(phase: PhaseType): boolean {
  return phase === 'short-break' || phase === 'long-break';
}

/**
 * Check if a phase is a transition phase
 */
export function isTransitionPhase(phase: PhaseType): boolean {
  return phase === 'sit-to-stand-transition' || phase === 'stand-to-sit-transition';
}

/**
 * Check if a phase is a custom phase
 * Custom phases get their overlay/pause/strict behavior from FlowStep flags
 */
export function isCustomPhase(phase: PhaseType): boolean {
  return phase === 'custom';
}

/**
 * Check if a phase shows an overlay (transition, break, or custom with showOverlay flag).
 * For custom phases, the FlowStep must be passed to check the showOverlay flag.
 * Use this to decide overlay behavior; use isBreakPhase() for break-specific logic.
 */
export function isOverlayPhase(phase: PhaseType, flowStep?: FlowStep): boolean {
  if (isBreakPhase(phase) || isTransitionPhase(phase)) return true;
  if (phase === 'custom' && flowStep?.showOverlay) return true;
  return false;
}

/**
 * Find the first work phase index in a flow
 * Returns 0 if no work phase found (shouldn't happen with valid flows)
 */
export function findFirstWorkPhaseIndex(flowSteps: FlowStep[]): number {
  for (let i = 0; i < flowSteps.length; i++) {
    if (flowSteps[i].type === 'sit' || flowSteps[i].type === 'stand') {
      return i;
    }
  }
  return 0;
}

/**
 * Find the index of a specific phase type in flow
 * Returns -1 if not found
 */
export function findPhaseIndex(flowSteps: FlowStep[], phase: PhaseType): number {
  return flowSteps.findIndex(s => s.type === phase);
}

/**
 * Get phase duration from schedule
 */
export function getPhaseDuration(
  phase: PhaseType,
  schedule: Schedule,
  flowStepIndex?: number
): number {
  // Flow-based: use flow step duration (except long-break)
  if (isFlowBasedSchedule(schedule) && phase !== 'long-break' && flowStepIndex !== undefined) {
    const flowSteps = schedule.flowSteps!;
    if (flowStepIndex >= 0 && flowStepIndex < flowSteps.length) {
      const step = flowSteps[flowStepIndex];
      if (step.type === phase) {
        return getFlowStepDurationMs(step);
      }
    }
  }
  
  // Rule-based or long-break
  switch (phase) {
    case 'sit':
      return minutesToMs(schedule.sitMinutes);
    case 'stand':
      return minutesToMs(schedule.standMinutes);
    case 'sit-to-stand-transition':
      return secondsToMs(
        schedule.transitions?.sitToStand?.durationSeconds ?? 
        schedule.sitToStandTransitionSeconds ?? 60
      );
    case 'stand-to-sit-transition':
      return secondsToMs(
        schedule.transitions?.standToSit?.durationSeconds ?? 
        schedule.standToSitTransitionSeconds ?? 60
      );
    case 'short-break':
      return minutesToMs(
        schedule.shortBreak?.durationMinutes ?? 
        schedule.shortBreakDurationMinutes ?? 5
      );
    case 'long-break':
      return minutesToMs(
        schedule.longBreak?.durationMinutes ?? 
        schedule.longBreakDurationMinutes ?? 15
      );
    default:
      return 0;
  }
}

/**
 * Create a clean reset state for a schedule
 * This is the single source of truth for what reset produces
 */
export interface ResetResult {
  currentPhase: PhaseType;
  currentFlowStepIndex: number | undefined;
  phaseDurationMs: number;
}

export function computeResetState(schedule: Schedule): ResetResult {
  if (isFlowBasedSchedule(schedule)) {
    const flowSteps = schedule.flowSteps!;
    const startIndex = findFirstWorkPhaseIndex(flowSteps);
    const startPhase = flowSteps[startIndex].type;
    const durationMs = getFlowStepDurationMs(flowSteps[startIndex]);
    
    logger.debug('transitions', 'computeResetState - flow mode', {
      startIndex,
      startPhase,
      durationMs,
    });
    
    return {
      currentPhase: startPhase,
      currentFlowStepIndex: startIndex,
      phaseDurationMs: durationMs,
    };
  }
  
  // Rule-based: always start with sit
  return {
    currentPhase: 'sit',
    currentFlowStepIndex: undefined,
    phaseDurationMs: minutesToMs(schedule.sitMinutes),
  };
}

/**
 * Validate that a flow step index is within bounds
 */
export function isValidFlowIndex(index: number | undefined, flowSteps: FlowStep[]): boolean {
  if (index === undefined) return false;
  return index >= 0 && index < flowSteps.length;
}

/**
 * Log a transition for debugging
 */
export function logTransition(
  type: TransitionType,
  details: Record<string, unknown>
): void {
  logger.info('Transition', type, details);
}
