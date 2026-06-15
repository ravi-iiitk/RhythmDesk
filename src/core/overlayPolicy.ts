/**
 * RhythmDesk Overlay Policy Engine
 * 
 * Centralized decision engine for overlay behavior.
 * All overlay decisions MUST go through this module.
 * 
 * This removes duplicate overlay logic scattered across windowManager and timerEngine.
 */

import { PhaseType, Schedule, BreakType, FlowStep } from '../shared/types';
import { OfficeFocusLockState } from '../shared/types';

/**
 * Input for overlay policy decision
 */
export interface OverlayPolicyInput {
  phase: PhaseType;
  schedule: Schedule | null;
  focusLockActive: boolean;
  focusLockState?: OfficeFocusLockState;
  isPaused: boolean;
  isPostponed: boolean;
  isWaitingForNextActivity: boolean;
  currentFlowStep?: FlowStep;  // Current flow step (for custom step overlay/pause/strict flags)
}

/**
 * Output from overlay policy decision
 */
export interface OverlayPolicy {
  showOverlay: boolean;
  fullscreen: boolean;
  strictMode: boolean;
  allowPostpone: boolean;
  allowClose: boolean;
  allowSkip: boolean;
  postponeOptions: number[];
  maxPostpones: number;
}

/**
 * Map PhaseType to BreakType for config lookup
 */
export function phaseToBreakType(phase: PhaseType): BreakType | null {
  switch (phase) {
    case 'sit-to-stand-transition':
      return 'sitToStandTransition';
    case 'stand-to-sit-transition':
      return 'standToSitTransition';
    case 'short-break':
      return 'shortBreak';
    case 'long-break':
      return 'longBreak';
    default:
      return null;
  }
}

/**
 * Check if phase is a work phase (sit or stand)
 */
export function isWorkPhase(phase: PhaseType): boolean {
  return phase === 'sit' || phase === 'stand';
}

/**
 * Check if phase is a break or transition (overlay phases).
 * Custom phases with showOverlay flag are also overlay phases.
 */
export function isBreakOrTransitionPhase(phase: PhaseType, flowStep?: FlowStep): boolean {
  if (
    phase === 'sit-to-stand-transition' ||
    phase === 'stand-to-sit-transition' ||
    phase === 'short-break' ||
    phase === 'long-break'
  ) return true;
  if (phase === 'custom' && flowStep?.showOverlay) return true;
  return false;
}

/**
 * Get break/transition config for a phase from schedule
 */
function getPhaseConfig(schedule: Schedule, phase: PhaseType) {
  switch (phase) {
    case 'sit-to-stand-transition':
      return schedule.transitions.sitToStand;
    case 'stand-to-sit-transition':
      return schedule.transitions.standToSit;
    case 'short-break':
      return schedule.shortBreak;
    case 'long-break':
      return schedule.longBreak;
    default:
      return null;
  }
}

/**
 * Default policy when no schedule or idle
 */
const DEFAULT_POLICY: OverlayPolicy = {
  showOverlay: false,
  fullscreen: false,
  strictMode: false,
  allowPostpone: false,
  allowClose: true,
  allowSkip: true,
  postponeOptions: [],
  maxPostpones: 0,
};

/**
 * Central overlay policy function
 * 
 * RULES:
 * 1. Work phases (sit/stand): overlay only if Focus Lock is active
 * 2. Break/transition phases: always show overlay
 * 3. Strict mode comes from per-break config (or Focus Lock overrides to strict)
 * 4. Paused: no overlay
 *    NOTE: postponed breaks should NOT suppress transition overlays
 * 5. Idle: no overlay
 */
export function getOverlayPolicy(input: OverlayPolicyInput): OverlayPolicy {
  const { phase, schedule, focusLockActive, isPaused, isPostponed, isWaitingForNextActivity } = input;

  // No schedule = no overlay
  if (!schedule) {
    return { ...DEFAULT_POLICY };
  }

  // Idle = no overlay
  if (phase === 'idle') {
    return { ...DEFAULT_POLICY };
  }

  // Paused = no overlay
  if (isPaused) {
    return { ...DEFAULT_POLICY };
  }

  // Waiting for user to start next activity = no overlay
  // The timer is between activities; showing overlay makes no sense
  if (isWaitingForNextActivity) {
    return { ...DEFAULT_POLICY };
  }

  // Work phases (sit/stand)
  if (isWorkPhase(phase)) {
    // If a break is postponed, the user explicitly chose to keep working.
    // Do NOT show the overlay even if Focus Lock is active — otherwise
    // ensureOverlayIfRequired will re-open the overlay within seconds
    // of the postpone closing it, trapping the user in work overlay.
    if (isPostponed) {
      return { ...DEFAULT_POLICY };
    }
    if (focusLockActive) {
      // Focus Lock active during work = strict fullscreen overlay
      return {
        showOverlay: true,
        fullscreen: true,
        strictMode: true,
        allowPostpone: false,
        allowClose: false,
        allowSkip: false,
        postponeOptions: [],
        maxPostpones: 0,
      };
    } else {
      // Normal work phase = no overlay
      return { ...DEFAULT_POLICY };
    }
  }

  // Custom phase: behavior is driven by FlowStep flags, not hard-coded phase config
  if (phase === 'custom') {
    const flowStep = input.currentFlowStep;
    if (flowStep?.showOverlay) {
      const strictMode = focusLockActive || (flowStep.strictMode ?? false);
      return {
        showOverlay: true,
        fullscreen: true,
        strictMode,
        allowPostpone: false,  // Custom steps don't support postpone (no BreakType mapping)
        allowClose: !strictMode,
        allowSkip: !strictMode,
        postponeOptions: [],
        maxPostpones: 0,
      };
    }
    // Custom step without showOverlay = background activity, no overlay
    return { ...DEFAULT_POLICY };
  }

  // Break/transition phases - always show overlay
  const phaseConfig = getPhaseConfig(schedule, phase);
  
  if (!phaseConfig) {
    // Unknown phase type - shouldn't happen
    return { ...DEFAULT_POLICY };
  }

  // CRITICAL: Transitions must NEVER use strict/kiosk mode.
  // They are 30-60 seconds — too short for kiosk mode. Kiosk causes:
  // 1. Heartbeat watchdog false-positive → destroy/recreate cycle → frozen appearance
  // 2. User lockout if overlay fails to render
  // 3. No escape mechanism during the brief transition period
  const isTransition = phase === 'sit-to-stand-transition' || phase === 'stand-to-sit-transition';
  const strictMode = isTransition ? false : (focusLockActive || phaseConfig.strictModeEnabled);

  return {
    showOverlay: true,
    fullscreen: true,
    strictMode,
    allowPostpone: phaseConfig.allowPostpone && !focusLockActive,
    allowClose: !strictMode,
    allowSkip: !strictMode,
    postponeOptions: phaseConfig.postponeOptionsMinutes,
    maxPostpones: phaseConfig.maxPostponesPerDay,
  };
}

/**
 * Check if overlay should be shown for given state
 * Convenience function for quick checks
 */
export function shouldShowOverlay(input: OverlayPolicyInput): boolean {
  return getOverlayPolicy(input).showOverlay;
}

/**
 * Get the break type's max postpones from schedule
 */
export function getMaxPostponesForBreakType(
  schedule: Schedule | null,
  breakType: BreakType | null
): number {
  if (!schedule || !breakType) return 0;

  switch (breakType) {
    case 'sitToStandTransition':
      return schedule.transitions.sitToStand.maxPostponesPerDay;
    case 'standToSitTransition':
      return schedule.transitions.standToSit.maxPostponesPerDay;
    case 'shortBreak':
      return schedule.shortBreak.maxPostponesPerDay;
    case 'longBreak':
      return schedule.longBreak.maxPostponesPerDay;
    default:
      return 0;
  }
}

/**
 * Get postpone options for a break type
 */
export function getPostponeOptionsForBreakType(
  schedule: Schedule | null,
  breakType: BreakType | null
): number[] {
  if (!schedule || !breakType) return [];

  switch (breakType) {
    case 'sitToStandTransition':
      return schedule.transitions.sitToStand.postponeOptionsMinutes;
    case 'standToSitTransition':
      return schedule.transitions.standToSit.postponeOptionsMinutes;
    case 'shortBreak':
      return schedule.shortBreak.postponeOptionsMinutes;
    case 'longBreak':
      return schedule.longBreak.postponeOptionsMinutes;
    default:
      return [];
  }
}
