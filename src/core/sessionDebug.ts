/**
 * Session Debug Logger - Phase 1.5 Runtime Stabilization
 * 
 * Structured debug logging for session state transitions.
 * Helps identify flow/state bugs before they corrupt the session.
 * 
 * Format: [TIMER] event=eventType field=value field=value
 */

import logger from './logger';
import { PhaseType, SessionState, Schedule } from '../shared/types';
import { isFlowBasedSchedule } from './flowUtils';

// ============================================================
// SESSION EVENT TYPES
// ============================================================

export type SessionEventType =
  | 'phaseTransition'
  | 'skipPhase'
  | 'postponeBreak'
  | 'breakStart'
  | 'breakEnd'
  | 'resetSession'
  | 'scheduleEditDetected'
  | 'restartRecovery'
  | 'flowDesync'
  | 'validationError'
  | 'stateNormalized'
  | 'restartActivity';

// ============================================================
// SESSION DEBUG LOGGING
// ============================================================

interface SessionEventData {
  event: SessionEventType;
  phase?: PhaseType;
  fromPhase?: PhaseType;
  toPhase?: PhaseType;
  index?: number;
  indexBefore?: number;
  indexAfter?: number;
  next?: PhaseType;
  then?: PhaseType;
  cumulativeWorkMs?: number;
  pendingBreak?: PhaseType | null;
  postponeUntil?: number | null;
  scheduleId?: string | null;
  reason?: string;
  [key: string]: unknown;
}

/**
 * Log a session event in structured format
 * Format: [TIMER] event=eventType field=value field=value
 */
export function logSessionEvent(data: SessionEventData): void {
  const { event, ...fields } = data;
  
  // Build structured log string
  const parts: string[] = [`event=${event}`];
  
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      // Format timestamps as relative
      if (key === 'postponeUntil' && typeof value === 'number') {
        const relativeMs = value - Date.now();
        parts.push(`${key}=${Math.round(relativeMs / 1000)}s`);
      } else if (key === 'cumulativeWorkMs' && typeof value === 'number') {
        parts.push(`${key}=${Math.round(value / 1000)}s`);
      } else {
        parts.push(`${key}=${value}`);
      }
    }
  }
  
  const logLine = `[TIMER] ${parts.join(' ')}`;
  
  // Log as info for key events, debug for less important ones
  const infoEvents: SessionEventType[] = [
    'phaseTransition', 'skipPhase', 'postponeBreak', 
    'resetSession', 'flowDesync', 'validationError',
    'restartActivity'
  ];
  
  if (infoEvents.includes(event)) {
    logger.info('SessionDebug', logLine);
  } else {
    logger.debug('SessionDebug', logLine);
  }
  
  // Also log to console in dev mode for visibility
  if (process.env.NODE_ENV === 'development') {
    console.log(logLine);
  }
}

// ============================================================
// FLOW INDEX NORMALIZATION
// ============================================================

/**
 * Normalize flow index to valid bounds
 * 
 * Behavior:
 * - if index < 0 → reset to 0
 * - if index >= flowSteps.length → wrap to 0
 * - if flowSteps empty → throw validation error
 * 
 * @returns normalized index
 */
export function normalizeFlowIndex(index: number | undefined, flowStepsLength: number): number {
  if (flowStepsLength === 0) {
    logSessionEvent({
      event: 'validationError',
      reason: 'flowSteps is empty, cannot normalize index',
    });
    throw new Error('Cannot normalize flow index: flowSteps is empty');
  }
  
  if (index === undefined || index < 0) {
    logSessionEvent({
      event: 'stateNormalized',
      reason: 'index was undefined or negative',
      indexBefore: index,
      indexAfter: 0,
    });
    return 0;
  }
  
  if (index >= flowStepsLength) {
    const normalized = index % flowStepsLength;
    logSessionEvent({
      event: 'stateNormalized',
      reason: 'index exceeded flowSteps length',
      indexBefore: index,
      indexAfter: normalized,
    });
    return normalized;
  }
  
  return index;
}

// ============================================================
// SESSION STATE VALIDATION
// ============================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate runtime session state
 * 
 * Checks:
 * - currentFlowStepIndex is within flowSteps bounds
 * - currentPhase matches flowSteps[currentFlowStepIndex] in flow mode
 * - postponed break is not also active break
 * - nextPhase != undefined
 * - nextPhase != currentPhase unless flow truly contains duplicate steps
 */
export function validateRuntimeState(
  state: SessionState,
  schedule: Schedule | null,
  nextPhase: PhaseType
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Skip validation if no schedule
  if (!schedule) {
    return { valid: true, errors, warnings };
  }
  
  // Flow-based mode specific checks
  if (isFlowBasedSchedule(schedule)) {
    const flowSteps = schedule.flowSteps!;
    const index = state.currentFlowStepIndex;
    
    // Check 1: index within bounds
    if (index === undefined) {
      errors.push('currentFlowStepIndex is undefined in flow mode');
    } else if (index < 0 || index >= flowSteps.length) {
      errors.push(`currentFlowStepIndex (${index}) out of bounds [0, ${flowSteps.length - 1}]`);
    } else {
      // Check 2: phase matches flow step (except during long-break)
      const expectedPhase = flowSteps[index].type;
      if (state.currentPhase !== expectedPhase && state.currentPhase !== 'long-break') {
        warnings.push(`currentPhase (${state.currentPhase}) != flowSteps[${index}] (${expectedPhase})`);
      }
    }
    
    // Check 3: nextPhase != currentPhase (unless flow has consecutive duplicates)
    if (nextPhase === state.currentPhase && state.currentPhase !== 'idle') {
      const currentIndex = index ?? 0;
      const nextIndex = (currentIndex + 1) % flowSteps.length;
      const flowHasDuplicates = flowSteps[currentIndex]?.type === flowSteps[nextIndex]?.type;
      
      if (!flowHasDuplicates) {
        errors.push(`nextPhase (${nextPhase}) == currentPhase (${state.currentPhase}) but flow has no consecutive duplicates`);
      }
    }
  }
  
  // Check 4: nextPhase defined
  if (!nextPhase || nextPhase === undefined) {
    errors.push('nextPhase is undefined');
  }
  
  // Check 5: postponed break not also active
  if (state.isPostponed && state.postponedPhase) {
    // During postpone, currentPhase should be work, not break
    if (state.currentPhase === state.postponedPhase) {
      errors.push(`postponed break (${state.postponedPhase}) is also current phase - invalid state`);
    }
    
    // Pending break must be a break type
    const breakPhases: PhaseType[] = ['short-break', 'long-break'];
    if (!breakPhases.includes(state.postponedPhase)) {
      warnings.push(`postponedPhase (${state.postponedPhase}) is not a break type`);
    }
    
    // Current phase during postpone should be work
    const workPhases: PhaseType[] = ['sit', 'stand', 'sit-to-stand-transition', 'stand-to-sit-transition'];
    if (!workPhases.includes(state.currentPhase)) {
      errors.push(`currentPhase (${state.currentPhase}) is not work during postpone`);
    }
  }
  
  // Log validation errors
  if (errors.length > 0) {
    logSessionEvent({
      event: 'validationError',
      reason: errors.join('; '),
      phase: state.currentPhase,
      index: state.currentFlowStepIndex,
      next: nextPhase,
      pendingBreak: state.postponedPhase,
    });
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Attempt safe recovery from invalid state
 * Returns the corrected index or null if unrecoverable
 */
export function attemptSafeRecovery(
  state: SessionState,
  schedule: Schedule | null
): { recovered: boolean; newIndex?: number; reason?: string } {
  if (!schedule || !isFlowBasedSchedule(schedule)) {
    return { recovered: true };
  }
  
  const flowSteps = schedule.flowSteps!;
  if (flowSteps.length === 0) {
    return { recovered: false, reason: 'flowSteps is empty' };
  }
  
  const currentIndex = state.currentFlowStepIndex;
  
  // Case 1: index out of bounds
  if (currentIndex === undefined || currentIndex < 0 || currentIndex >= flowSteps.length) {
    // Try to find current phase in flow
    const correctIndex = flowSteps.findIndex(s => s.type === state.currentPhase);
    if (correctIndex !== -1) {
      logSessionEvent({
        event: 'stateNormalized',
        reason: 'recovered index from currentPhase',
        indexBefore: currentIndex,
        indexAfter: correctIndex,
        phase: state.currentPhase,
      });
      return { recovered: true, newIndex: correctIndex, reason: 'found phase in flow' };
    }
    
    // Fallback: find first work phase
    const firstWorkIndex = flowSteps.findIndex(s => s.type === 'sit' || s.type === 'stand');
    const fallbackIndex = firstWorkIndex !== -1 ? firstWorkIndex : 0;
    
    logSessionEvent({
      event: 'stateNormalized',
      reason: 'recovered index to first work phase',
      indexBefore: currentIndex,
      indexAfter: fallbackIndex,
    });
    return { recovered: true, newIndex: fallbackIndex, reason: 'reset to first work phase' };
  }
  
  // Case 2: phase doesn't match index
  const expectedPhase = flowSteps[currentIndex].type;
  if (state.currentPhase !== expectedPhase && state.currentPhase !== 'long-break') {
    // Index might be wrong, try to find correct index for current phase
    const correctIndex = flowSteps.findIndex(s => s.type === state.currentPhase);
    if (correctIndex !== -1) {
      logSessionEvent({
        event: 'stateNormalized',
        reason: 'corrected index to match currentPhase',
        indexBefore: currentIndex,
        indexAfter: correctIndex,
        phase: state.currentPhase,
      });
      return { recovered: true, newIndex: correctIndex, reason: 'synced index to phase' };
    }
  }
  
  return { recovered: true };
}

// ============================================================
// SNAPSHOT FOR DEBUG PANEL
// ============================================================

export interface SessionDebugSnapshot {
  currentPhase: PhaseType;
  currentFlowStepIndex: number | undefined;
  nextPhase: PhaseType;
  thenPhase: PhaseType;
  cumulativeWorkTimeMs: number;
  pendingBreakType: PhaseType | null;
  postponedUntil: number | null;
  isPostponed: boolean;
  isPaused: boolean;
  activeScheduleId: string | null;
  scheduleMode: string | null;
  flowStepsCount: number;
  validationStatus: 'ok' | 'warning' | 'error';
}

/**
 * Create a snapshot of session state for debug panel
 */
export function createDebugSnapshot(
  state: SessionState,
  schedule: Schedule | null,
  nextPhase: PhaseType,
  thenPhase: PhaseType
): SessionDebugSnapshot {
  const validation = validateRuntimeState(state, schedule, nextPhase);
  
  let validationStatus: 'ok' | 'warning' | 'error' = 'ok';
  if (validation.errors.length > 0) {
    validationStatus = 'error';
  } else if (validation.warnings.length > 0) {
    validationStatus = 'warning';
  }
  
  return {
    currentPhase: state.currentPhase,
    currentFlowStepIndex: state.currentFlowStepIndex,
    nextPhase,
    thenPhase,
    cumulativeWorkTimeMs: state.cumulativeWorkTimeMs,
    pendingBreakType: state.postponedPhase,
    postponedUntil: state.postponedUntil,
    isPostponed: state.isPostponed,
    isPaused: state.isPaused,
    activeScheduleId: state.activeScheduleId,
    scheduleMode: schedule?.mode ?? null,
    flowStepsCount: schedule?.flowSteps?.length ?? 0,
    validationStatus,
  };
}
