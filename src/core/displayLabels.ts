/**
 * Display Labels Module
 * 
 * Provides display label resolution for flow steps and phases.
 * Supports custom user-defined labels with fallback to default phase names.
 * 
 * USAGE:
 * - Use getFlowStepDisplayLabel() for flow step display
 * - Use getPhaseDisplayLabel() when you have phase + optional flow step context
 */

import { FlowStep, PhaseType, Schedule } from '../shared/types';
import { PHASE_DISPLAY_NAMES } from '../shared/constants';
import { isFlowBasedSchedule } from './flowUtils';

/**
 * Get display label for a flow step
 * Returns custom label if defined, otherwise falls back to default phase name
 */
export function getFlowStepDisplayLabel(step: FlowStep): string {
  // Use custom label if defined and non-empty
  if (step.label && step.label.trim().length > 0) {
    return step.label.trim();
  }
  // Fall back to default phase display name
  return PHASE_DISPLAY_NAMES[step.type] || step.type;
}

/**
 * Get display label for a phase given optional flow context
 * 
 * @param phase The current phase type
 * @param schedule Optional schedule for flow context
 * @param flowStepIndex Optional flow step index
 * @returns Display label string
 */
export function getPhaseDisplayLabel(
  phase: PhaseType,
  schedule?: Schedule | null,
  flowStepIndex?: number
): string {
  // For flow-based schedules, try to get custom label from flow step
  if (schedule && isFlowBasedSchedule(schedule) && flowStepIndex !== undefined) {
    const flowSteps = schedule.flowSteps;
    if (flowSteps && flowStepIndex >= 0 && flowStepIndex < flowSteps.length) {
      const step = flowSteps[flowStepIndex];
      // Verify the step type matches the phase (safety check)
      if (step.type === phase) {
        return getFlowStepDisplayLabel(step);
      }
    }
  }
  
  // Fall back to default phase display name
  return PHASE_DISPLAY_NAMES[phase] || phase;
}

/**
 * Get display label for the "next" phase in flow
 * 
 * @param schedule The schedule
 * @param nextFlowStepIndex The next flow step index
 * @returns Display label string or undefined if not applicable
 */
export function getNextPhaseDisplayLabel(
  schedule: Schedule | null,
  nextFlowStepIndex?: number
): string | undefined {
  if (!schedule || !isFlowBasedSchedule(schedule)) {
    return undefined;
  }
  
  const flowSteps = schedule.flowSteps;
  if (!flowSteps || nextFlowStepIndex === undefined) {
    return undefined;
  }
  
  if (nextFlowStepIndex >= 0 && nextFlowStepIndex < flowSteps.length) {
    return getFlowStepDisplayLabel(flowSteps[nextFlowStepIndex]);
  }
  
  return undefined;
}

/**
 * Validate a custom label
 * Returns sanitized label or undefined if invalid
 */
export function validateCustomLabel(label: string | undefined): string | undefined {
  if (!label) return undefined;
  
  const trimmed = label.trim();
  
  // Empty after trim
  if (trimmed.length === 0) return undefined;
  
  // Max length check (reasonable limit)
  if (trimmed.length > 50) {
    return trimmed.substring(0, 50);
  }
  
  return trimmed;
}

/**
 * Get all flow step labels for display (e.g., in schedule editor)
 * Returns array of { index, type, label, isCustom }
 */
export function getFlowStepLabelsForDisplay(schedule: Schedule): Array<{
  index: number;
  type: string;
  label: string;
  isCustom: boolean;
}> {
  if (!isFlowBasedSchedule(schedule) || !schedule.flowSteps) {
    return [];
  }
  
  return schedule.flowSteps.map((step, index) => {
    const hasCustomLabel = !!(step.label && step.label.trim().length > 0);
    return {
      index,
      type: step.type,
      label: getFlowStepDisplayLabel(step),
      isCustom: hasCustomLabel,
    };
  });
}
