"use strict";
/**
 * RhythmDesk Transition Model
 * Explicit state transitions for timer/session behavior
 *
 * This module defines the allowed transitions and provides helpers
 * to ensure state changes follow correct semantics.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransitionType = void 0;
exports.computeNextFlowPhase = computeNextFlowPhase;
exports.computeThenFlowPhase = computeThenFlowPhase;
exports.computeNextRuleBasedPhase = computeNextRuleBasedPhase;
exports.computeThenRuleBasedPhase = computeThenRuleBasedPhase;
exports.isWorkPhase = isWorkPhase;
exports.isBreakPhase = isBreakPhase;
exports.isTransitionPhase = isTransitionPhase;
exports.isCustomPhase = isCustomPhase;
exports.isOverlayPhase = isOverlayPhase;
exports.findFirstWorkPhaseIndex = findFirstWorkPhaseIndex;
exports.findPhaseIndex = findPhaseIndex;
exports.getPhaseDuration = getPhaseDuration;
exports.computeResetState = computeResetState;
exports.isValidFlowIndex = isValidFlowIndex;
exports.logTransition = logTransition;
const flowUtils_1 = require("./flowUtils");
const timeUtils_1 = require("../shared/timeUtils");
const logger_1 = __importDefault(require("./logger"));
/**
 * Transition types that can occur in the timer engine
 */
var TransitionType;
(function (TransitionType) {
    // Normal flow
    TransitionType["PHASE_COMPLETED"] = "phase:completed";
    // User actions
    TransitionType["SKIP_REQUESTED"] = "skip:requested";
    TransitionType["POSTPONE_REQUESTED"] = "postpone:requested";
    TransitionType["RESET_REQUESTED"] = "reset:requested";
    TransitionType["PAUSE_REQUESTED"] = "pause:requested";
    TransitionType["RESUME_REQUESTED"] = "resume:requested";
    TransitionType["COMPLETE_REQUESTED"] = "complete:requested";
    // Automatic triggers
    TransitionType["POSTPONE_ENDED"] = "postpone:ended";
    TransitionType["PAUSE_ENDED"] = "pause:ended";
    TransitionType["SHORT_BREAK_DUE"] = "break:short:due";
    TransitionType["LONG_BREAK_DUE"] = "break:long:due";
    // Schedule changes
    TransitionType["SCHEDULE_ACTIVATED"] = "schedule:activated";
    TransitionType["SCHEDULE_DEACTIVATED"] = "schedule:deactivated";
    TransitionType["SCHEDULE_CHANGED"] = "schedule:changed";
})(TransitionType || (exports.TransitionType = TransitionType = {}));
/**
 * Compute the next phase when advancing in flow-based mode
 * This is the single source of truth for flow advancement
 */
function computeNextFlowPhase(currentIndex, flowSteps, isAfterLongBreak = false) {
    if (flowSteps.length === 0) {
        return { nextIndex: 0, nextPhase: 'idle', nextDurationMs: 0 };
    }
    // After long break, restart from first step (index 0)
    if (isAfterLongBreak) {
        const firstStep = flowSteps[0];
        return {
            nextIndex: 0,
            nextPhase: firstStep.type,
            nextDurationMs: (0, flowUtils_1.getFlowStepDurationMs)(firstStep),
        };
    }
    // Normal advancement: wrap around
    const nextIndex = (currentIndex + 1) % flowSteps.length;
    const nextStep = flowSteps[nextIndex];
    return {
        nextIndex,
        nextPhase: nextStep.type,
        nextDurationMs: (0, flowUtils_1.getFlowStepDurationMs)(nextStep),
    };
}
/**
 * Compute the "then" phase (2 steps ahead) in flow-based mode
 */
function computeThenFlowPhase(currentIndex, flowSteps) {
    if (flowSteps.length === 0) {
        return { nextIndex: 0, nextPhase: 'idle', nextDurationMs: 0 };
    }
    const thenIndex = (currentIndex + 2) % flowSteps.length;
    const thenStep = flowSteps[thenIndex];
    return {
        nextIndex: thenIndex,
        nextPhase: thenStep.type,
        nextDurationMs: (0, flowUtils_1.getFlowStepDurationMs)(thenStep),
    };
}
/**
 * Compute next phase for rule-based mode
 */
function computeNextRuleBasedPhase(currentPhase, preBreakPhase) {
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
function computeThenRuleBasedPhase(nextPhase) {
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
function isWorkPhase(phase) {
    return phase === 'sit' || phase === 'stand';
}
/**
 * Check if a phase is a break phase
 */
function isBreakPhase(phase) {
    return phase === 'short-break' || phase === 'long-break';
}
/**
 * Check if a phase is a transition phase
 */
function isTransitionPhase(phase) {
    return phase === 'sit-to-stand-transition' || phase === 'stand-to-sit-transition';
}
/**
 * Check if a phase is a custom phase
 * Custom phases get their overlay/pause/strict behavior from FlowStep flags
 */
function isCustomPhase(phase) {
    return phase === 'custom';
}
/**
 * Check if a phase shows an overlay (transition, break, or custom with showOverlay flag).
 * For custom phases, the FlowStep must be passed to check the showOverlay flag.
 * Use this to decide overlay behavior; use isBreakPhase() for break-specific logic.
 */
function isOverlayPhase(phase, flowStep) {
    if (isBreakPhase(phase) || isTransitionPhase(phase))
        return true;
    if (phase === 'custom' && flowStep?.showOverlay)
        return true;
    return false;
}
/**
 * Find the first work phase index in a flow
 * Returns 0 if no work phase found (shouldn't happen with valid flows)
 */
function findFirstWorkPhaseIndex(flowSteps) {
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
function findPhaseIndex(flowSteps, phase) {
    return flowSteps.findIndex(s => s.type === phase);
}
/**
 * Get phase duration from schedule
 */
function getPhaseDuration(phase, schedule, flowStepIndex) {
    // Flow-based: use flow step duration (except long-break)
    if ((0, flowUtils_1.isFlowBasedSchedule)(schedule) && phase !== 'long-break' && flowStepIndex !== undefined) {
        const flowSteps = schedule.flowSteps;
        if (flowStepIndex >= 0 && flowStepIndex < flowSteps.length) {
            const step = flowSteps[flowStepIndex];
            if (step.type === phase) {
                return (0, flowUtils_1.getFlowStepDurationMs)(step);
            }
        }
    }
    // Rule-based or long-break
    switch (phase) {
        case 'sit':
            return (0, timeUtils_1.minutesToMs)(schedule.sitMinutes);
        case 'stand':
            return (0, timeUtils_1.minutesToMs)(schedule.standMinutes);
        case 'sit-to-stand-transition':
            return (0, timeUtils_1.secondsToMs)(schedule.transitions?.sitToStand?.durationSeconds ??
                schedule.sitToStandTransitionSeconds ?? 60);
        case 'stand-to-sit-transition':
            return (0, timeUtils_1.secondsToMs)(schedule.transitions?.standToSit?.durationSeconds ??
                schedule.standToSitTransitionSeconds ?? 60);
        case 'short-break':
            return (0, timeUtils_1.minutesToMs)(schedule.shortBreak?.durationMinutes ??
                schedule.shortBreakDurationMinutes ?? 5);
        case 'long-break':
            return (0, timeUtils_1.minutesToMs)(schedule.longBreak?.durationMinutes ??
                schedule.longBreakDurationMinutes ?? 15);
        default:
            return 0;
    }
}
function computeResetState(schedule) {
    if ((0, flowUtils_1.isFlowBasedSchedule)(schedule)) {
        const flowSteps = schedule.flowSteps;
        const startIndex = findFirstWorkPhaseIndex(flowSteps);
        const startPhase = flowSteps[startIndex].type;
        const durationMs = (0, flowUtils_1.getFlowStepDurationMs)(flowSteps[startIndex]);
        logger_1.default.debug('transitions', 'computeResetState - flow mode', {
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
        phaseDurationMs: (0, timeUtils_1.minutesToMs)(schedule.sitMinutes),
    };
}
/**
 * Validate that a flow step index is within bounds
 */
function isValidFlowIndex(index, flowSteps) {
    if (index === undefined)
        return false;
    return index >= 0 && index < flowSteps.length;
}
/**
 * Log a transition for debugging
 */
function logTransition(type, details) {
    logger_1.default.info('Transition', type, details);
}
//# sourceMappingURL=transitions.js.map