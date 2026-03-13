"use strict";
/**
 * Break Conflict Resolution Module
 *
 * Implements the break conflict policy to ensure the runtime never holds
 * conflicting break states.
 *
 * BREAK PRIORITY: Long Break > Short Break
 *
 * CONFLICT RULES:
 *
 * 1. At most one active break at a time
 * 2. At most one pending break at a time
 * 3. Never allow: active break + same-type pending break
 * 4. Long break supersedes short break
 *
 * FLOW MODE RULES:
 * - If pending break exists and flow reaches break step, skip the break step
 * - Continue to next valid work step
 *
 * RULE-BASED MODE RULES:
 * - If break already pending, don't enqueue another equal/lower-priority break
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BREAK_PRIORITY = void 0;
exports.isBreakPhase = isBreakPhase;
exports.getBreakPriority = getBreakPriority;
exports.resolveBreakConflict = resolveBreakConflict;
exports.shouldClearPendingOnBreakEntry = shouldClearPendingOnBreakEntry;
exports.shouldSkipFlowBreakStep = shouldSkipFlowBreakStep;
exports.validateBreakState = validateBreakState;
const logger_1 = __importDefault(require("./logger"));
/**
 * Break priority levels (higher number = higher priority)
 */
exports.BREAK_PRIORITY = {
    'short-break': 1,
    'long-break': 2,
};
/**
 * Check if a phase is a break phase
 */
function isBreakPhase(phase) {
    return phase === 'short-break' || phase === 'long-break';
}
/**
 * Get break priority (returns 0 for non-break phases)
 */
function getBreakPriority(phase) {
    if (isBreakPhase(phase)) {
        return exports.BREAK_PRIORITY[phase];
    }
    return 0;
}
/**
 * Resolve break conflict when a new break becomes due
 *
 * @param currentState Current break state
 * @param newBreak The new break that is trying to trigger
 * @returns Resolution action to take
 */
function resolveBreakConflict(currentState, newBreak) {
    const { activeBreak, pendingBreak } = currentState;
    const newPriority = getBreakPriority(newBreak);
    // Case 1: Active break of same type exists - skip (can't have duplicate)
    if (activeBreak === newBreak) {
        logger_1.default.info('BreakConflict', 'Skipping duplicate active break', {
            activeBreak,
            newBreak,
        });
        return {
            action: 'skip',
            reason: `Already in ${newBreak}, skipping duplicate`,
        };
    }
    // Case 2: Active break exists (different type)
    if (activeBreak !== null) {
        const activePriority = getBreakPriority(activeBreak);
        if (newPriority > activePriority) {
            // Higher priority break - this shouldn't happen during normal flow
            // as breaks should interrupt work phases, not other breaks
            logger_1.default.warn('BreakConflict', 'Higher priority break while in break', {
                activeBreak,
                newBreak,
            });
            return {
                action: 'skip',
                reason: `Cannot interrupt ${activeBreak} with ${newBreak}`,
            };
        }
        else {
            // Same or lower priority - skip
            return {
                action: 'skip',
                reason: `Already in ${activeBreak}, skipping ${newBreak}`,
            };
        }
    }
    // Case 3: No active break, check pending break
    if (pendingBreak !== null) {
        const pendingPriority = getBreakPriority(pendingBreak);
        // Same type pending - skip/merge
        if (pendingBreak === newBreak) {
            logger_1.default.info('BreakConflict', 'Same-type break already pending, merging', {
                pendingBreak,
                newBreak,
            });
            return {
                action: 'merge',
                reason: `${newBreak} already pending, no action needed`,
            };
        }
        // Higher priority new break - replace pending
        if (newPriority > pendingPriority) {
            logger_1.default.info('BreakConflict', 'Higher priority break supersedes pending', {
                pendingBreak,
                newBreak,
            });
            return {
                action: 'replace',
                reason: `${newBreak} supersedes pending ${pendingBreak}`,
                shouldClearPending: true,
                replacePendingWith: newBreak,
            };
        }
        // Lower or equal priority - skip
        logger_1.default.info('BreakConflict', 'Lower priority break skipped', {
            pendingBreak,
            newBreak,
        });
        return {
            action: 'skip',
            reason: `${pendingBreak} pending (higher/equal priority), skipping ${newBreak}`,
        };
    }
    // Case 4: No conflicts - allow the break
    return {
        action: 'allow',
        reason: 'No conflict, break allowed',
    };
}
/**
 * Check if entering a break phase should clear a pending break
 *
 * Called when transitioning to a break phase to determine if
 * the pending break should be cleared (because we're taking a break now)
 */
function shouldClearPendingOnBreakEntry(pendingBreak, enteringBreak) {
    if (!pendingBreak) {
        return { clear: false, reason: 'No pending break' };
    }
    // Same type - clear the pending since we're taking that break now
    if (pendingBreak === enteringBreak) {
        return {
            clear: true,
            reason: `Entering ${enteringBreak}, clearing same-type pending break`,
        };
    }
    const pendingPriority = getBreakPriority(pendingBreak);
    const enteringPriority = getBreakPriority(enteringBreak);
    // Entering higher or equal priority break - clear pending
    if (enteringPriority >= pendingPriority) {
        return {
            clear: true,
            reason: `Entering ${enteringBreak} (priority ${enteringPriority}) clears pending ${pendingBreak} (priority ${pendingPriority})`,
        };
    }
    // Entering lower priority break (e.g., short break while long break pending)
    // Don't clear - the higher priority break should still trigger after
    return {
        clear: false,
        reason: `Pending ${pendingBreak} has higher priority than ${enteringBreak}, keeping pending`,
    };
}
/**
 * Determine if a flow break step should be skipped due to pending break
 *
 * In flow-based mode, if a pending break exists and the flow reaches
 * a break step, we should skip it to avoid duplicate breaks.
 */
function shouldSkipFlowBreakStep(pendingBreak, flowStepBreak) {
    if (!pendingBreak) {
        return { skip: false, reason: 'No pending break' };
    }
    // Same type pending - definitely skip
    if (pendingBreak === flowStepBreak) {
        return {
            skip: true,
            reason: `${flowStepBreak} already pending, skipping flow break step`,
        };
    }
    const pendingPriority = getBreakPriority(pendingBreak);
    const flowStepPriority = getBreakPriority(flowStepBreak);
    // Higher priority pending - skip the lower priority flow step
    if (pendingPriority > flowStepPriority) {
        return {
            skip: true,
            reason: `${pendingBreak} pending (higher priority), skipping ${flowStepBreak} flow step`,
        };
    }
    // Flow step is higher priority - don't skip, but this is unusual
    // The flow step should proceed and will clear the pending break
    return {
        skip: false,
        reason: `${flowStepBreak} has higher priority than pending ${pendingBreak}`,
    };
}
/**
 * Validate break state consistency
 * Returns errors if state is inconsistent
 */
function validateBreakState(state) {
    const errors = [];
    // Can't have same-type active and pending
    if (state.activeBreak && state.pendingBreak && state.activeBreak === state.pendingBreak) {
        errors.push(`Invalid: active ${state.activeBreak} and pending ${state.pendingBreak} are same type`);
    }
    // Pending break must have due time
    if (state.pendingBreak && !state.pendingBreakDueAt) {
        errors.push(`Invalid: pending ${state.pendingBreak} has no due time`);
    }
    // No pending break should have no due time
    if (!state.pendingBreak && state.pendingBreakDueAt) {
        errors.push(`Invalid: pending due time set but no pending break`);
    }
    return errors;
}
//# sourceMappingURL=breakConflict.js.map