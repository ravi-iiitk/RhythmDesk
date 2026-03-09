/**
 * PostureGuard Validation Utilities
 * Validates schedule and configuration data
 */

import { Schedule } from '../shared/types';

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
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

  // Transition duration validation
  if (schedule.sitToStandTransitionSeconds === undefined || schedule.sitToStandTransitionSeconds < 0) {
    errors.push({ field: 'sitToStandTransitionSeconds', message: 'Transition duration cannot be negative' });
  } else if (schedule.sitToStandTransitionSeconds > 300) {
    errors.push({ field: 'sitToStandTransitionSeconds', message: 'Transition duration must be 5 minutes or less' });
  }

  if (schedule.standToSitTransitionSeconds === undefined || schedule.standToSitTransitionSeconds < 0) {
    errors.push({ field: 'standToSitTransitionSeconds', message: 'Transition duration cannot be negative' });
  } else if (schedule.standToSitTransitionSeconds > 300) {
    errors.push({ field: 'standToSitTransitionSeconds', message: 'Transition duration must be 5 minutes or less' });
  }

  // Calculate cycle duration for break validation
  const cycleMinutes = (schedule.sitMinutes || 0) + (schedule.standMinutes || 0);

  // Short break validation
  if (schedule.shortBreakEnabled) {
    if (schedule.shortBreakEveryMinutes === undefined || schedule.shortBreakEveryMinutes <= 0) {
      errors.push({ field: 'shortBreakEveryMinutes', message: 'Short break frequency must be greater than 0' });
    } else if (schedule.shortBreakEveryMinutes < cycleMinutes) {
      errors.push({ 
        field: 'shortBreakEveryMinutes', 
        message: `Short break frequency (${schedule.shortBreakEveryMinutes} min) must be >= sit+stand cycle (${cycleMinutes} min)` 
      });
    }

    if (schedule.shortBreakDurationMinutes === undefined || schedule.shortBreakDurationMinutes <= 0) {
      errors.push({ field: 'shortBreakDurationMinutes', message: 'Short break duration must be greater than 0' });
    } else if (schedule.shortBreakDurationMinutes > 30) {
      errors.push({ field: 'shortBreakDurationMinutes', message: 'Short break duration must be 30 minutes or less' });
    }
  }

  // Long break validation
  if (schedule.longBreakEnabled) {
    if (schedule.longBreakEveryMinutes === undefined || schedule.longBreakEveryMinutes <= 0) {
      errors.push({ field: 'longBreakEveryMinutes', message: 'Long break frequency must be greater than 0' });
    } else {
      // Long break must be greater than short break frequency
      if (schedule.shortBreakEnabled && schedule.shortBreakEveryMinutes) {
        if (schedule.longBreakEveryMinutes <= schedule.shortBreakEveryMinutes) {
          errors.push({ 
            field: 'longBreakEveryMinutes', 
            message: `Long break frequency must be greater than short break frequency (${schedule.shortBreakEveryMinutes} min)` 
          });
        }
      }
    }

    if (schedule.longBreakDurationMinutes === undefined || schedule.longBreakDurationMinutes <= 0) {
      errors.push({ field: 'longBreakDurationMinutes', message: 'Long break duration must be greater than 0' });
    } else if (schedule.longBreakDurationMinutes > 60) {
      errors.push({ field: 'longBreakDurationMinutes', message: 'Long break duration must be 60 minutes or less' });
    }
  }

  // Postpone validation
  if (schedule.allowPostpone) {
    if (schedule.maxPostponesPerDay === undefined || schedule.maxPostponesPerDay < 0) {
      errors.push({ field: 'maxPostponesPerDay', message: 'Max postpones per day cannot be negative' });
    } else if (schedule.maxPostponesPerDay > 20) {
      errors.push({ field: 'maxPostponesPerDay', message: 'Max postpones per day must be 20 or less' });
    }

    if (!schedule.postponeOptionsMinutes || schedule.postponeOptionsMinutes.length === 0) {
      errors.push({ field: 'postponeOptionsMinutes', message: 'At least one postpone option is required' });
    } else {
      for (const option of schedule.postponeOptionsMinutes) {
        if (option <= 0 || option > 60) {
          errors.push({ field: 'postponeOptionsMinutes', message: 'Postpone options must be between 1 and 60 minutes' });
          break;
        }
      }
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
