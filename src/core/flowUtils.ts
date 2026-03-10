/**
 * Flow-Based Schedule Utilities
 * Helper functions for flow-based schedule mode
 */

import { v4 as uuidv4 } from 'uuid';
import { FlowStep, FlowStepType, Schedule, PhaseType } from '../shared/types';

/**
 * Check if a schedule is in flow-based mode
 */
export function isFlowBasedSchedule(schedule: Schedule | null): boolean {
  return schedule?.mode === 'flow-based' && Array.isArray(schedule.flowSteps) && schedule.flowSteps.length > 0;
}

/**
 * Get display name for a flow step type
 */
export function getFlowStepDisplayName(type: FlowStepType): string {
  switch (type) {
    case 'sit':
      return 'Sit';
    case 'stand':
      return 'Stand';
    case 'sit-to-stand-transition':
      return 'Sit → Stand Transition';
    case 'stand-to-sit-transition':
      return 'Stand → Sit Transition';
    case 'short-break':
      return 'Short Break';
    default:
      return type;
  }
}

/**
 * Get the next step index in a flow (wraps around)
 */
export function getNextFlowStepIndex(currentIndex: number, flowSteps: FlowStep[]): number {
  if (flowSteps.length === 0) return 0;
  return (currentIndex + 1) % flowSteps.length;
}

/**
 * Get the step N positions ahead in the flow (wraps around)
 */
export function getFlowStepAtOffset(currentIndex: number, offset: number, flowSteps: FlowStep[]): FlowStep | null {
  if (flowSteps.length === 0) return null;
  const targetIndex = (currentIndex + offset) % flowSteps.length;
  return flowSteps[targetIndex] ?? null;
}

/**
 * Get the phase type for the next step in flow
 */
export function getNextFlowPhase(currentIndex: number, flowSteps: FlowStep[]): PhaseType {
  const nextStep = getFlowStepAtOffset(currentIndex, 1, flowSteps);
  return nextStep?.type ?? 'idle';
}

/**
 * Get duration for a flow step in milliseconds
 */
export function getFlowStepDurationMs(step: FlowStep): number {
  return step.durationSeconds * 1000;
}

/**
 * Check if a flow step type counts as work time
 * Only sit and stand phases count toward cumulative work time
 */
export function isFlowStepWorkPhase(type: FlowStepType): boolean {
  return type === 'sit' || type === 'stand';
}

/**
 * Create a new flow step with default duration
 */
export function createFlowStep(type: FlowStepType, durationSeconds?: number): FlowStep {
  const defaultDurations: Record<FlowStepType, number> = {
    'sit': 12 * 60, // 12 minutes
    'stand': 12 * 60, // 12 minutes
    'sit-to-stand-transition': 30, // 30 seconds
    'stand-to-sit-transition': 30, // 30 seconds
    'short-break': 5 * 60, // 5 minutes
  };

  return {
    id: uuidv4(),
    type,
    durationSeconds: durationSeconds ?? defaultDurations[type],
  };
}

/**
 * Default flow steps for a new flow-based schedule
 */
export function getDefaultFlowSteps(): FlowStep[] {
  return [
    createFlowStep('sit', 12 * 60),
    createFlowStep('sit-to-stand-transition', 30),
    createFlowStep('stand', 12 * 60),
    createFlowStep('stand-to-sit-transition', 30),
    createFlowStep('short-break', 5 * 60),
  ];
}

/**
 * Validate flow steps
 * Returns array of validation errors (empty if valid)
 */
export function validateFlowSteps(flowSteps: FlowStep[] | undefined): string[] {
  const errors: string[] = [];

  if (!flowSteps || flowSteps.length === 0) {
    errors.push('Flow must have at least one step');
    return errors;
  }

  const hasWorkStep = flowSteps.some(step => isFlowStepWorkPhase(step.type));
  if (!hasWorkStep) {
    errors.push('Flow should include at least one work step (Sit or Stand)');
  }

  for (let i = 0; i < flowSteps.length; i++) {
    const step = flowSteps[i];
    if (step.durationSeconds <= 0) {
      errors.push(`Step ${i + 1} (${getFlowStepDisplayName(step.type)}) must have duration > 0`);
    }
  }

  return errors;
}

/**
 * Move a step up in the flow (swap with previous)
 */
export function moveFlowStepUp(flowSteps: FlowStep[], index: number): FlowStep[] {
  if (index <= 0 || index >= flowSteps.length) return flowSteps;
  const newSteps = [...flowSteps];
  [newSteps[index - 1], newSteps[index]] = [newSteps[index], newSteps[index - 1]];
  return newSteps;
}

/**
 * Move a step down in the flow (swap with next)
 */
export function moveFlowStepDown(flowSteps: FlowStep[], index: number): FlowStep[] {
  if (index < 0 || index >= flowSteps.length - 1) return flowSteps;
  const newSteps = [...flowSteps];
  [newSteps[index], newSteps[index + 1]] = [newSteps[index + 1], newSteps[index]];
  return newSteps;
}

/**
 * Remove a step from the flow
 */
export function removeFlowStep(flowSteps: FlowStep[], index: number): FlowStep[] {
  if (index < 0 || index >= flowSteps.length) return flowSteps;
  return flowSteps.filter((_, i) => i !== index);
}

/**
 * Add a step to the end of the flow
 */
export function addFlowStep(flowSteps: FlowStep[], step: FlowStep): FlowStep[] {
  return [...flowSteps, step];
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatFlowStepDuration(durationSeconds: number): string {
  if (durationSeconds < 60) {
    return `${durationSeconds}s`;
  }
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}
