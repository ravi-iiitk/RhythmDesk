"use strict";
/**
 * RhythmDesk Bootstrap Recovery Module
 *
 * ARCHITECTURE HARDENING: Explicit startup and recovery ordering
 *
 * This module defines the deterministic startup sequence and recovery logic.
 * All initialization must follow this order to avoid competing loads.
 *
 * BOOTSTRAP SEQUENCE:
 *
 * 1. INITIALIZE STORAGE
 *    - Initialize config store (electron-store)
 *    - Initialize session snapshot persistence
 *    - Run any pending migrations
 *
 * 2. LOAD DURABLE CONFIG
 *    - Load schedules from config store
 *    - Load general settings from config store
 *    - Create default schedules if none exist
 *
 * 3. LOAD RUNTIME SNAPSHOT
 *    - Load persisted session snapshot
 *    - Validate snapshot age (reject if >24h old)
 *    - Validate snapshot integrity
 *
 * 4. VALIDATE AND NORMALIZE
 *    - Check snapshot against current schedule config
 *    - Normalize any inconsistencies
 *    - Decide if snapshot can be resumed
 *
 * 5. INITIALIZE TIMER ENGINE
 *    - Create timer engine with validated state
 *    - Initialize runtime flow snapshot
 *    - Start tick interval
 *
 * 6. INITIALIZE UI
 *    - Create tray
 *    - Create main window
 *    - Register IPC handlers
 *
 * RECOVERY DECISION MATRIX:
 *
 * | Condition                    | Action                      |
 * |------------------------------|---------------------------- |
 * | No snapshot                  | Start fresh (idle)          |
 * | Snapshot >24h old            | Start fresh (idle)          |
 * | Snapshot schedule not found  | Start fresh (idle)          |
 * | Snapshot phase ended >5min   | Reset to first work phase   |
 * | Snapshot phase ended <5min   | Advance to next phase       |
 * | Snapshot valid               | Resume from snapshot        |
 * | Snapshot invalid             | Normalize and resume        |
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BootstrapStep = exports.DEFAULT_BOOTSTRAP_CONFIG = void 0;
exports.createBootstrapState = createBootstrapState;
exports.decideRecoveryAction = decideRecoveryAction;
exports.recoverSessionState = recoverSessionState;
exports.logBootstrapStep = logBootstrapStep;
exports.logBootstrapSummary = logBootstrapSummary;
const types_1 = require("../shared/types");
const flowUtils_1 = require("./flowUtils");
const sessionValidator_1 = require("./sessionValidator");
const transitions_1 = require("./transitions");
const logger_1 = __importDefault(require("./logger"));
exports.DEFAULT_BOOTSTRAP_CONFIG = {
    maxSnapshotAgeMs: 24 * 60 * 60 * 1000, // 24 hours
    stalePhaseThresholdMs: 5 * 60 * 1000, // 5 minutes
    verboseLogging: true,
};
// ============================================================
// BOOTSTRAP STEP TRACKING
// ============================================================
var BootstrapStep;
(function (BootstrapStep) {
    BootstrapStep["NOT_STARTED"] = "not_started";
    BootstrapStep["STORAGE_INIT"] = "storage_init";
    BootstrapStep["CONFIG_LOAD"] = "config_load";
    BootstrapStep["SNAPSHOT_LOAD"] = "snapshot_load";
    BootstrapStep["VALIDATE_NORMALIZE"] = "validate_normalize";
    BootstrapStep["TIMER_INIT"] = "timer_init";
    BootstrapStep["UI_INIT"] = "ui_init";
    BootstrapStep["COMPLETE"] = "complete";
    BootstrapStep["FAILED"] = "failed";
})(BootstrapStep || (exports.BootstrapStep = BootstrapStep = {}));
/**
 * Create initial bootstrap state
 */
function createBootstrapState() {
    const steps = [
        BootstrapStep.STORAGE_INIT,
        BootstrapStep.CONFIG_LOAD,
        BootstrapStep.SNAPSHOT_LOAD,
        BootstrapStep.VALIDATE_NORMALIZE,
        BootstrapStep.TIMER_INIT,
        BootstrapStep.UI_INIT,
    ];
    return {
        currentStep: BootstrapStep.NOT_STARTED,
        startedAt: Date.now(),
        completedAt: null,
        steps: steps.map(step => ({
            step,
            status: 'pending',
            startedAt: null,
            completedAt: null,
            error: null,
        })),
    };
}
/**
 * Decide recovery action based on snapshot state
 */
function decideRecoveryAction(snapshot, schedules, config = exports.DEFAULT_BOOTSTRAP_CONFIG) {
    const now = Date.now();
    // No snapshot - start fresh
    if (!snapshot) {
        return {
            action: 'start_fresh',
            reason: 'No session snapshot found',
        };
    }
    // Check snapshot age
    const snapshotAge = now - (snapshot.phaseStartedAt || 0);
    if (snapshotAge > config.maxSnapshotAgeMs) {
        return {
            action: 'start_fresh',
            reason: `Snapshot too old: ${Math.round(snapshotAge / 3600000)}h`,
        };
    }
    // Find the schedule from snapshot
    const schedule = schedules.find(s => s.id === snapshot.activeScheduleId);
    if (!schedule) {
        return {
            action: 'start_fresh',
            reason: `Schedule not found: ${snapshot.activeScheduleId}`,
        };
    }
    // Check if phase ended
    if (snapshot.phaseEndsAt > 0 && snapshot.phaseEndsAt < now) {
        const timeSinceEnded = now - snapshot.phaseEndsAt;
        if (timeSinceEnded > config.stalePhaseThresholdMs) {
            return {
                action: 'reset_to_work',
                reason: `Phase ended ${Math.round(timeSinceEnded / 60000)}min ago`,
                scheduleId: schedule.id,
            };
        }
        return {
            action: 'advance_phase',
            reason: `Phase ended ${Math.round(timeSinceEnded / 1000)}s ago`,
            scheduleId: schedule.id,
        };
    }
    // Snapshot is valid for resume
    return {
        action: 'resume',
        reason: 'Valid snapshot found',
        scheduleId: schedule.id,
    };
}
/**
 * Recover session state from snapshot
 */
function recoverSessionState(snapshot, schedules, config = exports.DEFAULT_BOOTSTRAP_CONFIG) {
    const decision = decideRecoveryAction(snapshot, schedules, config);
    const changes = [];
    logger_1.default.info('BootstrapRecovery', 'Recovery decision', {
        action: decision.action,
        reason: decision.reason,
    });
    switch (decision.action) {
        case 'start_fresh': {
            return {
                state: { ...types_1.INITIAL_SESSION_STATE },
                schedule: null,
                decision,
                normalized: false,
                changes: ['Started fresh - no valid snapshot'],
            };
        }
        case 'reset_to_work': {
            const schedule = schedules.find(s => s.id === decision.scheduleId);
            const state = createResetState(schedule);
            changes.push('Reset to first work phase due to stale snapshot');
            return {
                state,
                schedule,
                decision,
                normalized: false,
                changes,
            };
        }
        case 'advance_phase': {
            // For advance, we'd need the timer engine logic
            // For now, treat similar to resume but flag for advance
            const schedule = schedules.find(s => s.id === decision.scheduleId);
            const state = { ...snapshot };
            changes.push('Snapshot phase ended recently - will advance on first tick');
            return {
                state,
                schedule,
                decision,
                normalized: false,
                changes,
            };
        }
        case 'resume': {
            const schedule = schedules.find(s => s.id === decision.scheduleId);
            let state = { ...snapshot };
            // Validate and normalize
            const validation = (0, sessionValidator_1.validateSessionState)(state, schedule);
            if (!validation.valid || validation.warnings.length > 0) {
                const normalization = (0, sessionValidator_1.normalizeSessionState)(state, schedule);
                if (normalization.changed) {
                    state = normalization.state;
                    changes.push(...normalization.changes);
                }
            }
            return {
                state,
                schedule,
                decision,
                normalized: changes.length > 0,
                changes,
            };
        }
    }
}
/**
 * Create a clean reset state for a schedule
 */
function createResetState(schedule) {
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];
    let currentPhase = 'sit';
    let currentFlowStepIndex;
    let phaseDurationMs = schedule.sitMinutes * 60 * 1000;
    let flowConfigHash;
    if ((0, flowUtils_1.isFlowBasedSchedule)(schedule)) {
        const flowSteps = schedule.flowSteps;
        const startIndex = (0, transitions_1.findFirstWorkPhaseIndex)(flowSteps);
        currentPhase = flowSteps[startIndex].type;
        currentFlowStepIndex = startIndex;
        const step = flowSteps[startIndex];
        phaseDurationMs = step.durationSeconds * 1000;
        flowConfigHash = (0, types_1.computeFlowConfigHash)(flowSteps);
    }
    return {
        activeScheduleId: schedule.id,
        currentPhase,
        phaseStartedAt: now,
        phaseEndsAt: now + phaseDurationMs,
        phaseRemainingMs: phaseDurationMs,
        phaseTotalMs: phaseDurationMs,
        currentFlowStepIndex,
        flowConfigHash,
        cumulativeWorkTimeMs: 0,
        lastShortBreakAtWorkTimeMs: 0,
        lastLongBreakAtWorkTimeMs: 0,
        shortBreakCountToday: 0,
        longBreakCountToday: 0,
        breakCountResetDate: today,
        interruptedPhase: null,
        interruptedPhaseRemainingMs: 0,
        interruptedFlowIndex: undefined,
        postponeCountsToday: {
            sitToStandTransition: 0,
            standToSitTransition: 0,
            shortBreak: 0,
            longBreak: 0,
        },
        postponeResetDate: today,
        isWaitingForNextActivity: false,
        waitingNextPhase: null,
        isPaused: false,
        pausedAt: null,
        pauseResumeAt: null,
        isPostponed: false,
        postponedUntil: null,
        postponedPhase: null,
        postponedBreakType: null,
        prePostponeWorkPhase: null,
        prePostponeWorkPhaseRemainingMs: 0,
        prePostponeFlowIndex: undefined,
    };
}
// ============================================================
// BOOTSTRAP LOGGING
// ============================================================
/**
 * Log bootstrap step
 */
function logBootstrapStep(step, status, details) {
    const prefix = status === 'start' ? '→' : status === 'complete' ? '✓' : '✗';
    logger_1.default.info('Bootstrap', `${prefix} ${step}`, details);
}
/**
 * Log bootstrap summary
 */
function logBootstrapSummary(state, recoveryResult) {
    const duration = (state.completedAt || Date.now()) - state.startedAt;
    logger_1.default.info('Bootstrap', 'BOOTSTRAP COMPLETE', {
        durationMs: duration,
        recoveryAction: recoveryResult.decision.action,
        scheduleId: recoveryResult.schedule?.id || 'none',
        normalized: recoveryResult.normalized,
        changes: recoveryResult.changes,
    });
}
//# sourceMappingURL=bootstrapRecovery.js.map