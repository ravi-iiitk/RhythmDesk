"use strict";
/**
 * RhythmDesk Overlay Policy Engine
 *
 * Centralized decision engine for overlay behavior.
 * All overlay decisions MUST go through this module.
 *
 * This removes duplicate overlay logic scattered across windowManager and timerEngine.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.phaseToBreakType = phaseToBreakType;
exports.isWorkPhase = isWorkPhase;
exports.isBreakOrTransitionPhase = isBreakOrTransitionPhase;
exports.getOverlayPolicy = getOverlayPolicy;
exports.shouldShowOverlay = shouldShowOverlay;
exports.getMaxPostponesForBreakType = getMaxPostponesForBreakType;
exports.getPostponeOptionsForBreakType = getPostponeOptionsForBreakType;
/**
 * Map PhaseType to BreakType for config lookup
 */
function phaseToBreakType(phase) {
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
function isWorkPhase(phase) {
    return phase === 'sit' || phase === 'stand';
}
/**
 * Check if phase is a break or transition (overlay phases)
 */
function isBreakOrTransitionPhase(phase) {
    return (phase === 'sit-to-stand-transition' ||
        phase === 'stand-to-sit-transition' ||
        phase === 'short-break' ||
        phase === 'long-break');
}
/**
 * Get break/transition config for a phase from schedule
 */
function getPhaseConfig(schedule, phase) {
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
const DEFAULT_POLICY = {
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
 * 4. Paused/postponed: no overlay
 * 5. Idle: no overlay
 */
function getOverlayPolicy(input) {
    const { phase, schedule, focusLockActive, isPaused, isPostponed } = input;
    // No schedule = no overlay
    if (!schedule) {
        return { ...DEFAULT_POLICY };
    }
    // Idle = no overlay
    if (phase === 'idle') {
        return { ...DEFAULT_POLICY };
    }
    // Paused or postponed = no overlay
    if (isPaused || isPostponed) {
        return { ...DEFAULT_POLICY };
    }
    // Work phases (sit/stand)
    if (isWorkPhase(phase)) {
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
        }
        else {
            // Normal work phase = no overlay
            return { ...DEFAULT_POLICY };
        }
    }
    // Break/transition phases - always show overlay
    const phaseConfig = getPhaseConfig(schedule, phase);
    if (!phaseConfig) {
        // Unknown phase type - shouldn't happen
        return { ...DEFAULT_POLICY };
    }
    // Focus Lock overrides strictMode to true
    const strictMode = focusLockActive || phaseConfig.strictModeEnabled;
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
function shouldShowOverlay(input) {
    return getOverlayPolicy(input).showOverlay;
}
/**
 * Get the break type's max postpones from schedule
 */
function getMaxPostponesForBreakType(schedule, breakType) {
    if (!schedule || !breakType)
        return 0;
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
function getPostponeOptionsForBreakType(schedule, breakType) {
    if (!schedule || !breakType)
        return [];
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
//# sourceMappingURL=overlayPolicy.js.map