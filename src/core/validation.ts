/**
 * RhythmDesk Validation Utilities
 * Validates schedule and configuration data
 */

import { Schedule, TransitionConfig, BreakConfig } from '../shared/types';

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate postpone options array
 */
function validatePostponeOptions(
  options: number[] | undefined,
  fieldPrefix: string,
  errors: ValidationError[]
): void {
  if (!options || options.length === 0) {
    errors.push({ field: `${fieldPrefix}.postponeOptionsMinutes`, message: 'At least one postpone option is required' });
    return;
  }

  // Check values are valid (up to 2 hours = 120 minutes)
  for (const option of options) {
    if (option <= 0 || option > 120) {
      errors.push({ 
        field: `${fieldPrefix}.postponeOptionsMinutes`, 
        message: 'Postpone options must be between 1 and 120 minutes' 
      });
      break;
    }
  }

  // Check sorted and unique
  const sorted = [...options].sort((a, b) => a - b);
  const unique = [...new Set(sorted)];
  if (options.length !== unique.length || !options.every((v, i) => v === sorted[i])) {
    errors.push({ 
      field: `${fieldPrefix}.postponeOptionsMinutes`, 
      message: 'Postpone options should be sorted and unique' 
    });
  }
}

/**
 * Validate a transition config
 */
function validateTransitionConfig(
  config: TransitionConfig | undefined,
  fieldPrefix: string,
  errors: ValidationError[]
): void {
  if (!config) {
    errors.push({ field: fieldPrefix, message: 'Transition config is required' });
    return;
  }

  // Duration validation (0-300 seconds, i.e., 0-5 minutes)
  if (config.durationSeconds < 0) {
    errors.push({ field: `${fieldPrefix}.durationSeconds`, message: 'Transition duration cannot be negative' });
  } else if (config.durationSeconds > 300) {
    errors.push({ field: `${fieldPrefix}.durationSeconds`, message: 'Transition duration must be 5 minutes or less' });
  }

  // Max postpones validation
  if (config.maxPostponesPerDay < 0) {
    errors.push({ field: `${fieldPrefix}.maxPostponesPerDay`, message: 'Max postpones cannot be negative' });
  } else if (config.maxPostponesPerDay > 20) {
    errors.push({ field: `${fieldPrefix}.maxPostponesPerDay`, message: 'Max postpones must be 20 or less' });
  }

  // Postpone options validation (only if postpone is allowed)
  if (config.allowPostpone) {
    validatePostponeOptions(config.postponeOptionsMinutes, fieldPrefix, errors);
  }
}

/**
 * Validate a break config
 */
function validateBreakConfig(
  config: BreakConfig | undefined,
  fieldPrefix: string,
  cycleMinutes: number,
  otherBreakEveryMinutes: number | null,
  isLongBreak: boolean,
  errors: ValidationError[]
): void {
  if (!config) {
    errors.push({ field: fieldPrefix, message: 'Break config is required' });
    return;
  }

  // Only validate other fields if break is enabled
  if (!config.enabled) return;

  // Frequency validation
  if (config.everyMinutes <= 0) {
    errors.push({ field: `${fieldPrefix}.everyMinutes`, message: 'Break frequency must be greater than 0' });
  } else if (config.everyMinutes < cycleMinutes) {
    errors.push({ 
      field: `${fieldPrefix}.everyMinutes`, 
      message: `Break frequency (${config.everyMinutes} min) must be >= sit+stand cycle (${cycleMinutes} min)` 
    });
  }

  // Long break must be greater than short break
  if (isLongBreak && otherBreakEveryMinutes !== null && config.everyMinutes <= otherBreakEveryMinutes) {
    errors.push({ 
      field: `${fieldPrefix}.everyMinutes`, 
      message: `Long break frequency must be greater than short break frequency (${otherBreakEveryMinutes} min)` 
    });
  }

  // Duration validation
  const maxDuration = isLongBreak ? 60 : 30;
  if (config.durationMinutes <= 0) {
    errors.push({ field: `${fieldPrefix}.durationMinutes`, message: 'Break duration must be greater than 0' });
  } else if (config.durationMinutes > maxDuration) {
    errors.push({ 
      field: `${fieldPrefix}.durationMinutes`, 
      message: `Break duration must be ${maxDuration} minutes or less` 
    });
  }

  // Max postpones validation
  if (config.maxPostponesPerDay < 0) {
    errors.push({ field: `${fieldPrefix}.maxPostponesPerDay`, message: 'Max postpones cannot be negative' });
  } else if (config.maxPostponesPerDay > 20) {
    errors.push({ field: `${fieldPrefix}.maxPostponesPerDay`, message: 'Max postpones must be 20 or less' });
  }

  // Postpone options validation (only if postpone is allowed)
  if (config.allowPostpone) {
    validatePostponeOptions(config.postponeOptionsMinutes, fieldPrefix, errors);
  }
}

/**
 * Validate a schedule configuration
 */
export function validateSchedule(schedule: Partial<Schedule>): ValidationResult {
  const errors: ValidationError[] = [];

  // Name validation
  if (!schedule.name || schedule.name.trim().length === 0) {
    errors.push({ field: 'name', message: 'Schedule name is required' });
  } else if (schedule.name.length > 50) {
    errors.push({ field: 'name', message: 'Schedule name must be 50 characters or less' });
  }

  // Active days validation
  if (!schedule.activeDays || schedule.activeDays.length === 0) {
    errors.push({ field: 'activeDays', message: 'At least one active day must be selected' });
  }

  // Time validation
  if (!schedule.startTime) {
    errors.push({ field: 'startTime', message: 'Start time is required' });
  }
  if (!schedule.endTime) {
    errors.push({ field: 'endTime', message: 'End time is required' });
  }

  // Priority validation
  if (schedule.priority !== undefined && schedule.priority < 0) {
    errors.push({ field: 'priority', message: 'Priority cannot be negative' });
  }

  // Sit/Stand duration validation
  if (schedule.sitMinutes === undefined || schedule.sitMinutes <= 0) {
    errors.push({ field: 'sitMinutes', message: 'Sit duration must be greater than 0' });
  } else if (schedule.sitMinutes > 120) {
    errors.push({ field: 'sitMinutes', message: 'Sit duration must be 120 minutes or less' });
  }

  if (schedule.standMinutes === undefined || schedule.standMinutes <= 0) {
    errors.push({ field: 'standMinutes', message: 'Stand duration must be greater than 0' });
  } else if (schedule.standMinutes > 120) {
    errors.push({ field: 'standMinutes', message: 'Stand duration must be 120 minutes or less' });
  }

  // Calculate cycle duration for break validation
  const cycleMinutes = (schedule.sitMinutes || 0) + (schedule.standMinutes || 0);

  // Validate new per-break configuration
  if (schedule.transitions) {
    validateTransitionConfig(schedule.transitions.sitToStand, 'transitions.sitToStand', errors);
    validateTransitionConfig(schedule.transitions.standToSit, 'transitions.standToSit', errors);
  }

  if (schedule.shortBreak) {
    const longBreakEvery = schedule.longBreak?.enabled ? schedule.longBreak.everyMinutes : null;
    validateBreakConfig(schedule.shortBreak, 'shortBreak', cycleMinutes, null, false, errors);
  }

  if (schedule.longBreak) {
    const shortBreakEvery = schedule.shortBreak?.enabled ? schedule.shortBreak.everyMinutes : null;
    validateBreakConfig(schedule.longBreak, 'longBreak', cycleMinutes, shortBreakEvery, true, errors);
  }

  // Legacy field validation (for backward compatibility during migration)
  if (schedule.sitToStandTransitionSeconds !== undefined) {
    if (schedule.sitToStandTransitionSeconds < 0) {
      errors.push({ field: 'sitToStandTransitionSeconds', message: 'Transition duration cannot be negative' });
    } else if (schedule.sitToStandTransitionSeconds > 300) {
      errors.push({ field: 'sitToStandTransitionSeconds', message: 'Transition duration must be 5 minutes or less' });
    }
  }

  if (schedule.standToSitTransitionSeconds !== undefined) {
    if (schedule.standToSitTransitionSeconds < 0) {
      errors.push({ field: 'standToSitTransitionSeconds', message: 'Transition duration cannot be negative' });
    } else if (schedule.standToSitTransitionSeconds > 300) {
      errors.push({ field: 'standToSitTransitionSeconds', message: 'Transition duration must be 5 minutes or less' });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get validation error for a specific field
 */
export function getFieldError(result: ValidationResult, field: string): string | null {
  const error = result.errors.find(e => e.field === field);
  return error ? error.message : null;
}

/**
 * Format all validation errors as a single message
 */
export function formatValidationErrors(result: ValidationResult): string {
  if (result.valid) return '';
  return result.errors.map(e => `• ${e.message}`).join('\n');
}
