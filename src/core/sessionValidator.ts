/**
 * RhythmDesk Session State Validator
 * Validates and normalizes runtime session state to ensure invariants hold
 * 
 * SESSION STATE INVARIANTS:
 * 
 * 1. PHASE-MODE CONSISTENCY:
 *    - If schedule mode is 'flow-based', currentFlowStepIndex MUST be valid (0 to flowSteps.length-1)
 *    - If schedule mode is 'rule-based', currentFlowStepIndex MUST be undefined
 * 
 * 2. FLOW INDEX-PHASE CONSISTENCY:
 *    - In flow mode, currentPhase SHOULD match flowSteps[currentFlowStepIndex].type
 *    - EXCEPTION: during long-break (rule-based interrupt), phase won't match
 * 
 * 3. POSTPONE STATE CONSISTENCY:
 *    - If isPostponed is true: postponedPhase MUST be a break phase, currentPhase SHOULD be work phase
 *    - If isPostponed is false: postponedPhase MUST be null, postponedUntil MUST be null
 * 
 * 4. PAUSE STATE CONSISTENCY:
 *    - If isPaused is true: pausedAt MUST be set
 *    - If isPaused is false: pausedAt MUST be null, pauseResumeAt MUST be null
 * 
 * 5. TIMESTAMP CONSISTENCY:
 *    - phaseEndsAt should be > phaseStartedAt (unless idle)
 *    - phaseRemainingMs should be <= phaseTotalMs
 */

import { SessionState, Schedule } from '../shared/types';
import { isFlowBasedSchedule } from './flowUtils';
import { isWorkPhase, isBreakPhase, findFirstWorkPhaseIndex, findPhaseIndex } from './transitions';
import logger from './logger';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface NormalizationResult {
  state: SessionState;
  changed: boolean;
  changes: string[];
}

/**
 * Validate session state against a schedule
 * Returns validation result with errors and warnings
 */
export function validateSessionState(
  state: SessionState,
  schedule: Schedule | null
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // If no schedule, session should be idle
  if (!schedule) {
    if (state.currentPhase !== 'idle') {
      warnings.push(`No active schedule but currentPhase is '${state.currentPhase}', should be 'idle'`);
    }
    return { valid: errors.length === 0, errors, warnings };
  }
  
  // Invariant 1: Phase-mode consistency
  if (isFlowBasedSchedule(schedule)) {
    const flowSteps = schedule.flowSteps!;
    if (state.currentFlowStepIndex === undefined) {
      errors.push('Flow-based schedule but currentFlowStepIndex is undefined');
    } else if (state.currentFlowStepIndex < 0 || state.currentFlowStepIndex >= flowSteps.length) {
      errors.push(`currentFlowStepIndex ${state.currentFlowStepIndex} out of bounds [0, ${flowSteps.length - 1}]`);
    }
  } else {
    if (state.currentFlowStepIndex !== undefined) {
      warnings.push('Rule-based schedule but currentFlowStepIndex is set, should be undefined');
    }
  }
  
  // Invariant 2: Flow index-phase consistency (only for flow-based, not during long-break)
  if (isFlowBasedSchedule(schedule) && state.currentPhase !== 'long-break') {
    const flowSteps = schedule.flowSteps!;
    const index = state.currentFlowStepIndex ?? 0;
    if (index >= 0 && index < flowSteps.length) {
      const expectedPhase = flowSteps[index].type;
      if (expectedPhase !== state.currentPhase) {
        warnings.push(`Flow desync: currentPhase '${state.currentPhase}' != flowSteps[${index}].type '${expectedPhase}'`);
      }
    }
  }
  
  // Invariant 3: Postpone state consistency
  if (state.isPostponed) {
    if (!state.postponedPhase) {
      errors.push('isPostponed is true but postponedPhase is null');
    } else if (!isBreakPhase(state.postponedPhase)) {
      errors.push(`postponedPhase '${state.postponedPhase}' is not a break phase`);
    }
    if (!state.postponedUntil) {
      errors.push('isPostponed is true but postponedUntil is null');
    }
    if (!isWorkPhase(state.currentPhase) && state.currentPhase !== 'idle') {
      warnings.push(`isPostponed but currentPhase '${state.currentPhase}' is not a work phase`);
    }
  } else {
    if (state.postponedPhase) {
      errors.push('isPostponed is false but postponedPhase is set');
    }
    if (state.postponedUntil) {
      errors.push('isPostponed is false but postponedUntil is set');
    }
  }
  
  // Invariant 4: Pause state consistency
  if (state.isPaused) {
    if (!state.pausedAt) {
      errors.push('isPaused is true but pausedAt is null');
    }
  } else {
    if (state.pausedAt) {
      warnings.push('isPaused is false but pausedAt is set');
    }
  }
  
  // Invariant 5: Timestamp consistency (skip if idle)
  if (state.currentPhase !== 'idle') {
    if (state.phaseRemainingMs > state.phaseTotalMs) {
      warnings.push(`phaseRemainingMs (${state.phaseRemainingMs}) > phaseTotalMs (${state.phaseTotalMs})`);
    }
    if (state.phaseEndsAt > 0 && state.phaseStartedAt > 0) {
      if (state.phaseEndsAt < state.phaseStartedAt) {
        errors.push('phaseEndsAt < phaseStartedAt');
      }
    }
  }
  
  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Normalize session state to fix any inconsistencies
 * Returns normalized state and list of changes made
 */
export function normalizeSessionState(
  state: SessionState,
  schedule: Schedule | null
): NormalizationResult {
  const changes: string[] = [];
  let newState = { ...state };
  
  // If no schedule, reset to idle
  if (!schedule) {
    if (state.currentPhase !== 'idle') {
      newState.currentPhase = 'idle';
      newState.currentFlowStepIndex = undefined;
      newState.phaseRemainingMs = 0;
      newState.phaseTotalMs = 0;
      changes.push('Reset to idle (no active schedule)');
    }
    return { state: newState, changed: changes.length > 0, changes };
  }
  
  // Normalize flow index for flow-based schedules
  if (isFlowBasedSchedule(schedule)) {
    const flowSteps = schedule.flowSteps!;
    
    // Fix undefined index
    if (newState.currentFlowStepIndex === undefined) {
      const correctIndex = findPhaseIndex(flowSteps, newState.currentPhase);
      if (correctIndex !== -1) {
        newState.currentFlowStepIndex = correctIndex;
        changes.push(`Set currentFlowStepIndex to ${correctIndex} (matched currentPhase)`);
      } else {
        // Phase not in flow, reset to first work phase
        const firstWorkIndex = findFirstWorkPhaseIndex(flowSteps);
        newState.currentFlowStepIndex = firstWorkIndex;
        newState.currentPhase = flowSteps[firstWorkIndex].type;
        changes.push(`Reset to first work phase at index ${firstWorkIndex}`);
      }
    }
    
    // Fix out-of-bounds index
    if (newState.currentFlowStepIndex < 0 || newState.currentFlowStepIndex >= flowSteps.length) {
      const firstWorkIndex = findFirstWorkPhaseIndex(flowSteps);
      newState.currentFlowStepIndex = firstWorkIndex;
      newState.currentPhase = flowSteps[firstWorkIndex].type;
      changes.push(`Fixed out-of-bounds index, reset to ${firstWorkIndex}`);
    }
    
    // Fix flow desync (only if not in long-break)
    if (newState.currentPhase !== 'long-break') {
      const expectedPhase = flowSteps[newState.currentFlowStepIndex].type;
      if (expectedPhase !== newState.currentPhase) {
        // Try to find correct index for current phase
        const correctIndex = findPhaseIndex(flowSteps, newState.currentPhase);
        if (correctIndex !== -1) {
          newState.currentFlowStepIndex = correctIndex;
          changes.push(`Resynced flow index to ${correctIndex} for phase '${newState.currentPhase}'`);
        } else {
          // Phase not in flow, update phase to match index
          newState.currentPhase = expectedPhase;
          changes.push(`Updated currentPhase to '${expectedPhase}' to match flow index`);
        }
      }
    }
  } else {
    // Rule-based: clear flow index
    if (newState.currentFlowStepIndex !== undefined) {
      newState.currentFlowStepIndex = undefined;
      changes.push('Cleared currentFlowStepIndex (rule-based schedule)');
    }
  }
  
  // Normalize postpone state
  if (newState.isPostponed) {
    if (!newState.postponedPhase || !newState.postponedUntil) {
      // Invalid postpone state, clear it
      newState.isPostponed = false;
      newState.postponedPhase = null;
      newState.postponedUntil = null;
      newState.postponedBreakType = null;
      changes.push('Cleared invalid postpone state');
    }
  } else {
    if (newState.postponedPhase || newState.postponedUntil) {
      newState.postponedPhase = null;
      newState.postponedUntil = null;
      newState.postponedBreakType = null;
      changes.push('Cleared orphan postpone fields');
    }
  }
  
  // Normalize pause state
  if (!newState.isPaused) {
    if (newState.pausedAt || newState.pauseResumeAt) {
      newState.pausedAt = null;
      newState.pauseResumeAt = null;
      changes.push('Cleared orphan pause fields');
    }
  }
  
  // Normalize remaining time
  if (newState.phaseRemainingMs > newState.phaseTotalMs && newState.phaseTotalMs > 0) {
    newState.phaseRemainingMs = newState.phaseTotalMs;
    changes.push('Clamped phaseRemainingMs to phaseTotalMs');
  }
  
  return { state: newState, changed: changes.length > 0, changes };
}

/**
 * Quick check if session state needs normalization
 */
export function needsNormalization(state: SessionState, schedule: Schedule | null): boolean {
  const result = validateSessionState(state, schedule);
  return !result.valid || result.warnings.length > 0;
}

/**
 * Log validation results
 */
export function logValidationResult(result: ValidationResult, context: string): void {
  if (result.errors.length > 0) {
    logger.error('SessionValidator', `${context} - ERRORS`, { errors: result.errors });
  }
  if (result.warnings.length > 0) {
    logger.warn('SessionValidator', `${context} - WARNINGS`, { warnings: result.warnings });
  }
  if (result.valid && result.warnings.length === 0) {
    logger.debug('SessionValidator', `${context} - valid`);
  }
}
