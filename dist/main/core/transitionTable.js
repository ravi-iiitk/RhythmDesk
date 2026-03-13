"use strict";
/**
 * RhythmDesk Transition Table
 *
 * ARCHITECTURE HARDENING: Explicit transition model with preconditions,
 * postconditions, and side effects for all critical actions.
 *
 * This table defines the expected behavior for each transition type.
 * The timerEngine should consult this table before committing transitions.
 *
 * TRANSITION CATEGORIES:
 *
 * 1. AUTOMATIC TRANSITIONS
 *    - PHASE_COMPLETED: Natural phase timer expiry
 *    - SHORT_BREAK_DUE: Cumulative work time triggers short break
 *    - LONG_BREAK_DUE: Cumulative work time triggers long break
 *    - POSTPONE_ENDED: Postponed break timer expires
 *    - PAUSE_ENDED: Timed pause ends
 *
 * 2. USER-INITIATED TRANSITIONS
 *    - SKIP_REQUESTED: User skips current phase
 *    - POSTPONE_REQUESTED: User postpones break
 *    - RESET_REQUESTED: User resets session
 *    - PAUSE_REQUESTED: User pauses session
 *    - RESUME_REQUESTED: User resumes from pause
 *    - COMPLETE_REQUESTED: User marks phase complete early
 *
 * 3. SYSTEM TRANSITIONS
 *    - SCHEDULE_ACTIVATED: Schedule becomes active
 *    - SCHEDULE_DEACTIVATED: Schedule becomes inactive
 *    - SCHEDULE_EDITED_WHILE_ACTIVE: Config changed during active session
 *    - RUNTIME_RECOVERY: App restart/recovery
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSITION_TABLE = void 0;
exports.getTransitionDefinition = getTransitionDefinition;
exports.getTransitionsByCategory = getTransitionsByCategory;
exports.logTransitionWithDefinition = logTransitionWithDefinition;
exports.TRANSITION_TABLE = {
    // ============================================================
    // AUTOMATIC TRANSITIONS
    // ============================================================
    PHASE_COMPLETED: {
        name: 'Phase timer expired naturally',
        category: 'automatic',
        preconditions: [
            'phaseRemainingMs <= 0',
            'currentPhase !== idle',
            'isPaused === false',
        ],
        postconditions: [
            'currentPhase = computeNextPhase()',
            'currentFlowStepIndex updated if flow mode',
            'phaseTimers reset for new phase',
            'cumulativeWorkTimeMs updated if leaving work phase',
        ],
        sideEffects: [
            'emit phaseChange event',
            'emit tick event',
            'play sound if enabled',
        ],
        persistence: { saveSnapshot: true, updateConfig: false },
        overlay: { show: undefined }, // Depends on new phase
    },
    SHORT_BREAK_DUE: {
        name: 'Short break triggered by cumulative work time',
        category: 'automatic',
        preconditions: [
            'currentPhase is work phase (sit/stand)',
            'cumulativeWorkTimeMs >= shortBreakThreshold',
            'timeSinceLastShortBreak >= shortBreakInterval',
            'isPostponed === false',
            'flow mode: only long breaks interrupt (short breaks are in flow)',
        ],
        postconditions: [
            'interruptedPhase = currentPhase',
            'interruptedPhaseRemainingMs = phaseRemainingMs',
            'interruptedFlowIndex = currentFlowStepIndex',
            'currentPhase = short-break',
            'phaseTimers set for break duration',
        ],
        sideEffects: [
            'emit phaseChange event',
            'show overlay with postpone option',
        ],
        persistence: { saveSnapshot: true, updateConfig: false },
        overlay: { show: true, strictMode: false },
    },
    LONG_BREAK_DUE: {
        name: 'Long break triggered by cumulative work time',
        category: 'automatic',
        preconditions: [
            'currentPhase is work phase (sit/stand)',
            'cumulativeWorkTimeMs >= longBreakThreshold',
            'isPostponed === false',
        ],
        postconditions: [
            'interruptedPhase = currentPhase',
            'interruptedPhaseRemainingMs = phaseRemainingMs',
            'interruptedFlowIndex = currentFlowStepIndex',
            'currentPhase = long-break',
            'phaseTimers set for break duration',
        ],
        sideEffects: [
            'emit phaseChange event',
            'show overlay (strict if strictMode enabled)',
        ],
        persistence: { saveSnapshot: true, updateConfig: false },
        overlay: { show: true },
    },
    POSTPONE_ENDED: {
        name: 'Postponed break timer expired',
        category: 'automatic',
        preconditions: [
            'isPostponed === true',
            'postponedUntil <= now',
            'postponedPhase !== null',
        ],
        postconditions: [
            'isPostponed = false',
            'postponedUntil = null',
            'currentPhase = postponedPhase (the break)',
            'postponedPhase = null',
            'postponedBreakType = null',
            'phaseTimers set for break duration',
        ],
        sideEffects: [
            'emit phaseChange event',
            'show overlay',
        ],
        persistence: { saveSnapshot: true, updateConfig: false },
        overlay: { show: true },
    },
    PAUSE_ENDED: {
        name: 'Timed pause expired',
        category: 'automatic',
        preconditions: [
            'isPaused === true',
            'pauseResumeAt !== null',
            'pauseResumeAt <= now',
        ],
        postconditions: [
            'isPaused = false',
            'pausedAt = null',
            'pauseResumeAt = null',
            'phaseTimers recalculated from stored state',
        ],
        sideEffects: [
            'emit tick event',
        ],
        persistence: { saveSnapshot: true, updateConfig: false },
        overlay: {},
    },
    // ============================================================
    // USER-INITIATED TRANSITIONS
    // ============================================================
    SKIP_REQUESTED: {
        name: 'User skips current phase',
        category: 'user',
        preconditions: [
            'currentPhase !== idle',
            'isPaused === false',
            'schedule.noSkipEnabled !== true',
        ],
        postconditions: [
            'currentPhase = computeNextPhase()',
            'currentFlowStepIndex updated if flow mode',
            'phaseTimers reset for new phase',
            'cumulativeWorkTimeMs NOT updated (skip doesnt count as completing work)',
        ],
        sideEffects: [
            'emit phaseChange event',
            'emit tick event',
        ],
        persistence: { saveSnapshot: true, updateConfig: false },
        overlay: { show: undefined }, // Depends on new phase
    },
    POSTPONE_REQUESTED: {
        name: 'User postpones break',
        category: 'user',
        preconditions: [
            'currentPhase is break phase (short-break/long-break)',
            'isPaused === false',
            'isPostponed === false',
            'postponeCountsToday[breakType] < maxPostpones',
        ],
        postconditions: [
            'isPostponed = true',
            'postponedUntil = now + postponeMinutes',
            'postponedPhase = currentPhase (the break being postponed)',
            'postponedBreakType = breakType',
            'currentPhase = preBreakPhase (work phase)',
            'currentFlowStepIndex = interruptedFlowIndex',
            'prePostponeWorkPhase = preBreakPhase',
            'prePostponeFlowIndex = interruptedFlowIndex',
            'phaseTimers restored for work phase',
            'postponeCountsToday[breakType]++',
        ],
        sideEffects: [
            'emit postponed event',
            'hide overlay',
        ],
        persistence: { saveSnapshot: true, updateConfig: false },
        overlay: { hide: true },
    },
    RESET_REQUESTED: {
        name: 'User resets session',
        category: 'user',
        preconditions: [
            'schedule !== null',
        ],
        postconditions: [
            'currentPhase = first work phase',
            'currentFlowStepIndex = first work phase index (flow mode)',
            'cumulativeWorkTimeMs = 0',
            'lastShortBreakAtWorkTimeMs = 0',
            'lastLongBreakAtWorkTimeMs = 0',
            'isPostponed = false',
            'postponedUntil = null',
            'postponedPhase = null',
            'postponedBreakType = null',
            'prePostponeWorkPhase = null',
            'prePostponeFlowIndex = undefined',
            'interruptedPhase = null',
            'interruptedFlowIndex = undefined',
            'isPaused = false',
            'pausedAt = null',
            'pauseResumeAt = null',
            'flowConfigHash = computeHash(runtimeFlowSnapshot)',
            'runtimeFlowSnapshot = deep copy of schedule.flowSteps',
        ],
        sideEffects: [
            'emit tick event',
            'close overlay if open',
        ],
        persistence: { saveSnapshot: true, updateConfig: false },
        overlay: { hide: true },
    },
    PAUSE_REQUESTED: {
        name: 'User pauses session',
        category: 'user',
        preconditions: [
            'isPaused === false',
            'currentPhase !== idle',
        ],
        postconditions: [
            'isPaused = true',
            'pausedAt = now',
            'pauseResumeAt = now + duration (or null for manual resume)',
        ],
        sideEffects: [
            'emit tick event',
        ],
        persistence: { saveSnapshot: true, updateConfig: false },
        overlay: {},
    },
    RESUME_REQUESTED: {
        name: 'User resumes from pause',
        category: 'user',
        preconditions: [
            'isPaused === true',
        ],
        postconditions: [
            'isPaused = false',
            'pausedAt = null',
            'pauseResumeAt = null',
            'phaseTimers recalculated',
        ],
        sideEffects: [
            'emit tick event',
        ],
        persistence: { saveSnapshot: true, updateConfig: false },
        overlay: {},
    },
    COMPLETE_REQUESTED: {
        name: 'User marks phase complete early',
        category: 'user',
        preconditions: [
            'currentPhase !== idle',
            'isPaused === false',
        ],
        postconditions: [
            'Same as PHASE_COMPLETED',
        ],
        sideEffects: [
            'Same as PHASE_COMPLETED',
        ],
        persistence: { saveSnapshot: true, updateConfig: false },
        overlay: { show: undefined },
    },
    // ============================================================
    // SYSTEM TRANSITIONS
    // ============================================================
    SCHEDULE_ACTIVATED: {
        name: 'Schedule becomes active (time window started)',
        category: 'system',
        preconditions: [
            'schedule time window matches current time',
            'no other schedule currently active (or lower priority)',
        ],
        postconditions: [
            'activeScheduleId = schedule.id',
            'currentPhase = first work phase',
            'currentFlowStepIndex = first work phase index (flow mode)',
            'cumulativeWorkTimeMs = 0',
            'runtimeFlowSnapshot = deep copy of schedule.flowSteps',
            'flowConfigHash = computeHash(runtimeFlowSnapshot)',
        ],
        sideEffects: [
            'emit scheduleChange event',
            'emit tick event',
        ],
        persistence: { saveSnapshot: true, updateConfig: false },
        overlay: {},
    },
    SCHEDULE_DEACTIVATED: {
        name: 'Schedule becomes inactive (time window ended)',
        category: 'system',
        preconditions: [
            'schedule time window no longer matches current time',
        ],
        postconditions: [
            'currentPhase = idle',
            'currentFlowStepIndex = undefined',
            'runtimeFlowSnapshot = null',
        ],
        sideEffects: [
            'emit scheduleChange event',
            'emit phaseChange event',
            'close overlay',
        ],
        persistence: { saveSnapshot: true, updateConfig: false },
        overlay: { hide: true },
    },
    SCHEDULE_EDITED_WHILE_ACTIVE: {
        name: 'Config changed during active session',
        category: 'system',
        preconditions: [
            'schedule is currently active',
            'schedule config was mutated',
        ],
        postconditions: [
            'NO RUNTIME STATE CHANGES',
            'Mark session as stale (flowConfigHash mismatch)',
            'UI shows reset-required indicator',
        ],
        sideEffects: [
            'emit configUpdated event',
        ],
        persistence: { saveSnapshot: false, updateConfig: true },
        overlay: {},
    },
    RUNTIME_RECOVERY: {
        name: 'App restart recovery from snapshot',
        category: 'system',
        preconditions: [
            'App starting up',
            'Persisted session snapshot exists',
        ],
        postconditions: [
            'Load session state from snapshot',
            'Validate and normalize state',
            'Resume if snapshot is recent enough',
            'Reset to idle if snapshot is stale (>5 min)',
            'Initialize runtimeFlowSnapshot from current schedule',
        ],
        sideEffects: [
            'emit tick event after recovery',
        ],
        persistence: { saveSnapshot: true, updateConfig: false },
        overlay: {},
    },
};
// ============================================================
// TRANSITION HELPERS
// ============================================================
/**
 * Get transition definition by name
 */
function getTransitionDefinition(name) {
    return exports.TRANSITION_TABLE[name];
}
/**
 * Get all transitions in a category
 */
function getTransitionsByCategory(category) {
    return Object.values(exports.TRANSITION_TABLE).filter(t => t.category === category);
}
/**
 * Log transition with definition context
 */
function logTransitionWithDefinition(transitionName, context) {
    const definition = exports.TRANSITION_TABLE[transitionName];
    if (definition) {
        console.log(`[TRANSITION] ${transitionName}`, {
            category: definition.category,
            ...context,
        });
    }
}
//# sourceMappingURL=transitionTable.js.map