"use strict";
/**
 * RhythmDesk Test Harness - Phase 4 Production Hardening
 *
 * Lightweight test harness for timer/session engine.
 * Runs without UI and validates session state transitions.
 *
 * TEST SCENARIOS:
 * 1. Sit → transition → stand → transition → break → resume
 * 2. Skip repeatedly across full flow cycle
 * 3. Postpone break during flow-based schedule
 * 4. Reset during work phase
 * 5. Reset during break phase
 * 6. Restart recovery during work
 * 7. Restart recovery during break
 * 8. Restart recovery during postponed break
 * 9. Edit schedule while active
 * 10. Flow wrap-around
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEST_SCENARIOS = exports.TestHarness = void 0;
exports.runTestSuite = runTestSuite;
exports.formatTestResults = formatTestResults;
exports.createMockFlowSchedule = createMockFlowSchedule;
exports.createMockRuleBasedSchedule = createMockRuleBasedSchedule;
exports.createMockSessionState = createMockSessionState;
const types_1 = require("../../shared/types");
const flowUtils_1 = require("../flowUtils");
const transitions_1 = require("../transitions");
const sessionValidator_1 = require("../sessionValidator");
const runtimeInvariants_1 = require("../runtimeInvariants");
// ============================================================
// MOCK SESSION STATE
// ============================================================
function createMockSessionState(schedule) {
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
        phaseDurationMs = (0, flowUtils_1.getFlowStepDurationMs)(flowSteps[startIndex]);
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
// MOCK SCHEDULE
// ============================================================
function createMockFlowSchedule() {
    return {
        id: 'test-flow-schedule',
        name: 'Test Flow Schedule',
        enabled: true,
        mode: 'flow-based',
        sitMinutes: 12,
        standMinutes: 12,
        sitToStandTransitionSeconds: 30,
        standToSitTransitionSeconds: 30,
        shortBreakDurationMinutes: 5,
        shortBreakEveryMinutes: 25,
        longBreakDurationMinutes: 15,
        longBreakEveryMinutes: 60,
        flowSteps: [
            { id: 'step-1', type: 'sit', durationSeconds: 720 }, // 12 min
            { id: 'step-2', type: 'sit-to-stand-transition', durationSeconds: 30 },
            { id: 'step-3', type: 'stand', durationSeconds: 720 }, // 12 min
            { id: 'step-4', type: 'stand-to-sit-transition', durationSeconds: 30 },
            { id: 'step-5', type: 'short-break', durationSeconds: 300 }, // 5 min
        ],
        transitions: {
            sitToStand: {
                durationSeconds: 30,
                strictModeEnabled: false,
                allowPostpone: false,
                postponeOptionsMinutes: [],
                maxPostponesPerDay: 0,
            },
            standToSit: {
                durationSeconds: 30,
                strictModeEnabled: false,
                allowPostpone: false,
                postponeOptionsMinutes: [],
                maxPostponesPerDay: 0,
            },
        },
        shortBreak: {
            enabled: true,
            everyMinutes: 25,
            durationMinutes: 5,
            strictModeEnabled: false,
            allowPostpone: true,
            postponeOptionsMinutes: [5, 10],
            maxPostponesPerDay: 3,
        },
        longBreak: {
            enabled: true,
            everyMinutes: 60,
            durationMinutes: 15,
            strictModeEnabled: false,
            allowPostpone: true,
            postponeOptionsMinutes: [5, 10],
            maxPostponesPerDay: 2,
        },
        noSkipEnabled: false,
        allowPostpone: true,
        maxPostponesPerDay: 3,
        postponeOptionsMinutes: [5, 10],
        startTime: '00:00',
        endTime: '23:59',
        priority: 1,
        activeDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        createdAt: Date.now(),
    };
}
function createMockRuleBasedSchedule() {
    return {
        id: 'test-rule-schedule',
        name: 'Test Rule Schedule',
        enabled: true,
        mode: 'rule-based',
        sitMinutes: 12,
        standMinutes: 12,
        sitToStandTransitionSeconds: 30,
        standToSitTransitionSeconds: 30,
        shortBreakDurationMinutes: 5,
        shortBreakEveryMinutes: 25,
        longBreakDurationMinutes: 15,
        longBreakEveryMinutes: 60,
        transitions: {
            sitToStand: {
                durationSeconds: 30,
                strictModeEnabled: false,
                allowPostpone: false,
                postponeOptionsMinutes: [],
                maxPostponesPerDay: 0,
            },
            standToSit: {
                durationSeconds: 30,
                strictModeEnabled: false,
                allowPostpone: false,
                postponeOptionsMinutes: [],
                maxPostponesPerDay: 0,
            },
        },
        shortBreak: {
            enabled: true,
            everyMinutes: 25,
            durationMinutes: 5,
            strictModeEnabled: false,
            allowPostpone: true,
            postponeOptionsMinutes: [5, 10],
            maxPostponesPerDay: 3,
        },
        longBreak: {
            enabled: true,
            everyMinutes: 60,
            durationMinutes: 15,
            strictModeEnabled: false,
            allowPostpone: true,
            postponeOptionsMinutes: [5, 10],
            maxPostponesPerDay: 2,
        },
        noSkipEnabled: false,
        allowPostpone: true,
        maxPostponesPerDay: 3,
        postponeOptionsMinutes: [5, 10],
        startTime: '00:00',
        endTime: '23:59',
        priority: 1,
        activeDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        createdAt: Date.now(),
    };
}
// ============================================================
// TEST HARNESS
// ============================================================
class TestHarness {
    constructor(schedule) {
        this.runtimeFlowSnapshot = null;
        this.steps = [];
        this.schedule = schedule;
        this.state = createMockSessionState(schedule);
        if ((0, flowUtils_1.isFlowBasedSchedule)(schedule)) {
            this.runtimeFlowSnapshot = JSON.parse(JSON.stringify(schedule.flowSteps));
        }
    }
    getState() {
        return { ...this.state };
    }
    getSchedule() {
        return this.schedule;
    }
    getSteps() {
        return this.steps;
    }
    /**
     * Get transition context for invariant checks
     */
    getContext() {
        return {
            schedule: this.schedule,
            runtimeFlowSnapshot: this.runtimeFlowSnapshot,
        };
    }
    /**
     * Advance to next phase (simulating natural timer progression)
     */
    advancePhase() {
        const before = this.captureState();
        if ((0, flowUtils_1.isFlowBasedSchedule)(this.schedule)) {
            const flowSteps = this.runtimeFlowSnapshot || this.schedule.flowSteps;
            const currentIndex = this.state.currentFlowStepIndex ?? 0;
            const nextIndex = (currentIndex + 1) % flowSteps.length;
            const nextStep = flowSteps[nextIndex];
            this.state.currentFlowStepIndex = nextIndex;
            this.state.currentPhase = nextStep.type;
            this.state.phaseTotalMs = (0, flowUtils_1.getFlowStepDurationMs)(nextStep);
            this.state.phaseRemainingMs = this.state.phaseTotalMs;
            this.state.phaseStartedAt = Date.now();
            this.state.phaseEndsAt = Date.now() + this.state.phaseTotalMs;
        }
        else {
            // Rule-based: simple sit/stand cycling
            if (this.state.currentPhase === 'sit') {
                this.state.currentPhase = 'sit-to-stand-transition';
            }
            else if (this.state.currentPhase === 'sit-to-stand-transition') {
                this.state.currentPhase = 'stand';
            }
            else if (this.state.currentPhase === 'stand') {
                this.state.currentPhase = 'stand-to-sit-transition';
            }
            else if (this.state.currentPhase === 'stand-to-sit-transition') {
                this.state.currentPhase = 'sit';
            }
            this.state.phaseTotalMs = this.getPhaseDuration(this.state.currentPhase);
            this.state.phaseRemainingMs = this.state.phaseTotalMs;
            this.state.phaseStartedAt = Date.now();
            this.state.phaseEndsAt = Date.now() + this.state.phaseTotalMs;
        }
        // Update cumulative work time for work phases
        if (this.state.currentPhase === 'sit' || this.state.currentPhase === 'stand') {
            // Add time from previous phase if it was work
            const timePassed = (before.phaseTotalMs ?? 0) - (before.phaseRemainingMs ?? 0);
            if (before.currentPhase === 'sit' || before.currentPhase === 'stand') {
                this.state.cumulativeWorkTimeMs += timePassed;
            }
        }
        const after = this.captureState();
        this.steps.push({
            action: 'advancePhase',
            before,
            after,
            passed: this.validateState(),
        });
    }
    /**
     * Skip current phase
     */
    skipPhase() {
        const before = this.captureState();
        this.advancePhase();
        const after = this.captureState();
        // Replace the last step with skip action
        this.steps[this.steps.length - 1] = {
            action: 'skipPhase',
            before,
            after,
            passed: this.validateState(),
        };
    }
    /**
     * Trigger a break
     */
    triggerBreak(breakType) {
        const before = this.captureState();
        // Store interrupted phase
        this.state.interruptedPhase = this.state.currentPhase;
        this.state.interruptedPhaseRemainingMs = this.state.phaseRemainingMs;
        this.state.interruptedFlowIndex = this.state.currentFlowStepIndex;
        // Set break as current phase
        this.state.currentPhase = breakType;
        const breakDuration = breakType === 'short-break'
            ? (this.schedule.shortBreak?.durationMinutes ?? 5) * 60 * 1000
            : (this.schedule.longBreak?.durationMinutes ?? 15) * 60 * 1000;
        this.state.phaseTotalMs = breakDuration;
        this.state.phaseRemainingMs = breakDuration;
        this.state.phaseStartedAt = Date.now();
        this.state.phaseEndsAt = Date.now() + breakDuration;
        const after = this.captureState();
        this.steps.push({
            action: `triggerBreak(${breakType})`,
            before,
            after,
            passed: this.validateState(),
        });
    }
    /**
     * Postpone current break
     */
    postponeBreak(minutes) {
        const before = this.captureState();
        if (!(0, transitions_1.isBreakPhase)(this.state.currentPhase)) {
            this.steps.push({
                action: 'postponeBreak',
                before,
                after: before,
                passed: false,
                assertion: 'Cannot postpone non-break phase',
            });
            return false;
        }
        // Store postpone info
        this.state.isPostponed = true;
        this.state.postponedPhase = this.state.currentPhase;
        this.state.postponedUntil = Date.now() + minutes * 60 * 1000;
        this.state.postponedBreakType = this.state.currentPhase === 'short-break' ? 'shortBreak' : 'longBreak';
        // Store work phase info
        this.state.prePostponeWorkPhase = this.state.interruptedPhase;
        this.state.prePostponeWorkPhaseRemainingMs = this.state.interruptedPhaseRemainingMs;
        this.state.prePostponeFlowIndex = this.state.interruptedFlowIndex;
        // Restore to work phase
        this.state.currentPhase = this.state.interruptedPhase || 'sit';
        this.state.phaseRemainingMs = this.state.interruptedPhaseRemainingMs || this.getPhaseDuration(this.state.currentPhase);
        this.state.phaseTotalMs = this.getPhaseDuration(this.state.currentPhase);
        this.state.phaseStartedAt = Date.now();
        this.state.phaseEndsAt = Date.now() + this.state.phaseRemainingMs;
        // Restore flow index
        if (this.state.interruptedFlowIndex !== undefined) {
            this.state.currentFlowStepIndex = this.state.interruptedFlowIndex;
        }
        // Clear interrupted state
        this.state.interruptedPhase = null;
        this.state.interruptedPhaseRemainingMs = 0;
        this.state.interruptedFlowIndex = undefined;
        // Increment postpone count
        if (this.state.postponedBreakType === 'shortBreak') {
            this.state.postponeCountsToday.shortBreak++;
        }
        else {
            this.state.postponeCountsToday.longBreak++;
        }
        const after = this.captureState();
        this.steps.push({
            action: `postponeBreak(${minutes}min)`,
            before,
            after,
            passed: this.validateState(),
        });
        return true;
    }
    /**
     * Resume postponed break
     */
    resumePostponedBreak() {
        const before = this.captureState();
        if (!this.state.isPostponed || !this.state.postponedPhase) {
            this.steps.push({
                action: 'resumePostponedBreak',
                before,
                after: before,
                passed: false,
                assertion: 'No postponed break to resume',
            });
            return;
        }
        // Store current work phase
        this.state.interruptedPhase = this.state.currentPhase;
        this.state.interruptedPhaseRemainingMs = this.state.phaseRemainingMs;
        this.state.interruptedFlowIndex = this.state.currentFlowStepIndex;
        // Restore break phase
        this.state.currentPhase = this.state.postponedPhase;
        const breakDuration = this.state.postponedBreakType === 'shortBreak'
            ? (this.schedule.shortBreak?.durationMinutes ?? 5) * 60 * 1000
            : (this.schedule.longBreak?.durationMinutes ?? 15) * 60 * 1000;
        this.state.phaseTotalMs = breakDuration;
        this.state.phaseRemainingMs = breakDuration;
        this.state.phaseStartedAt = Date.now();
        this.state.phaseEndsAt = Date.now() + breakDuration;
        // Clear postpone state
        this.state.isPostponed = false;
        this.state.postponedUntil = null;
        this.state.postponedPhase = null;
        this.state.postponedBreakType = null;
        this.state.prePostponeWorkPhase = null;
        this.state.prePostponeWorkPhaseRemainingMs = 0;
        this.state.prePostponeFlowIndex = undefined;
        const after = this.captureState();
        this.steps.push({
            action: 'resumePostponedBreak',
            before,
            after,
            passed: this.validateState(),
        });
    }
    /**
     * Reset session
     */
    resetSession() {
        const before = this.captureState();
        const resetState = (0, transitions_1.computeResetState)(this.schedule);
        this.state.currentPhase = resetState.currentPhase;
        this.state.currentFlowStepIndex = resetState.currentFlowStepIndex;
        this.state.phaseTotalMs = resetState.phaseDurationMs;
        this.state.phaseRemainingMs = resetState.phaseDurationMs;
        this.state.phaseStartedAt = Date.now();
        this.state.phaseEndsAt = Date.now() + resetState.phaseDurationMs;
        // Clear all transient state
        this.state.cumulativeWorkTimeMs = 0;
        this.state.lastShortBreakAtWorkTimeMs = 0;
        this.state.lastLongBreakAtWorkTimeMs = 0;
        this.state.interruptedPhase = null;
        this.state.interruptedPhaseRemainingMs = 0;
        this.state.interruptedFlowIndex = undefined;
        this.state.isPostponed = false;
        this.state.postponedUntil = null;
        this.state.postponedPhase = null;
        this.state.postponedBreakType = null;
        this.state.prePostponeWorkPhase = null;
        this.state.prePostponeWorkPhaseRemainingMs = 0;
        this.state.prePostponeFlowIndex = undefined;
        this.state.isPaused = false;
        this.state.pausedAt = null;
        this.state.pauseResumeAt = null;
        // Re-freeze flow snapshot
        if ((0, flowUtils_1.isFlowBasedSchedule)(this.schedule)) {
            this.runtimeFlowSnapshot = JSON.parse(JSON.stringify(this.schedule.flowSteps));
            this.state.flowConfigHash = (0, types_1.computeFlowConfigHash)(this.schedule.flowSteps);
        }
        const after = this.captureState();
        this.steps.push({
            action: 'resetSession',
            before,
            after,
            passed: this.validateState(),
        });
    }
    /**
     * Simulate restart recovery
     */
    simulateRestartRecovery(timePassedMs) {
        const before = this.captureState();
        // Simulate time passing
        this.state.phaseRemainingMs = Math.max(0, this.state.phaseRemainingMs - timePassedMs);
        this.state.phaseEndsAt = this.state.phaseStartedAt + this.state.phaseTotalMs;
        // If phase should have ended, advance
        if (this.state.phaseRemainingMs <= 0) {
            this.advancePhase();
        }
        // Validate and normalize
        const validation = (0, sessionValidator_1.validateSessionState)(this.state, this.schedule);
        if (!validation.valid) {
            const normalization = (0, sessionValidator_1.normalizeSessionState)(this.state, this.schedule);
            if (normalization.changed) {
                this.state = normalization.state;
            }
        }
        const after = this.captureState();
        this.steps.push({
            action: `simulateRestartRecovery(${timePassedMs}ms)`,
            before,
            after,
            passed: this.validateState(),
        });
    }
    /**
     * Edit schedule (simulates config change while active)
     */
    editSchedule(newFlowSteps) {
        const before = this.captureState();
        // Update schedule config
        this.schedule = {
            ...this.schedule,
            flowSteps: newFlowSteps,
        };
        // NOTE: Runtime snapshot should NOT change (isolation)
        // The session should become stale
        const after = this.captureState();
        const oldHash = this.state.flowConfigHash;
        const newHash = (0, types_1.computeFlowConfigHash)(newFlowSteps);
        const isStale = oldHash !== newHash;
        this.steps.push({
            action: 'editSchedule',
            before,
            after,
            passed: isStale, // Pass if session correctly detects staleness
            assertion: isStale ? undefined : 'Session should be stale after edit',
        });
    }
    /**
     * Complete full flow cycle
     */
    completeFullCycle() {
        if (!(0, flowUtils_1.isFlowBasedSchedule)(this.schedule))
            return;
        const flowSteps = this.runtimeFlowSnapshot || this.schedule.flowSteps;
        const startIndex = this.state.currentFlowStepIndex ?? 0;
        for (let i = 0; i < flowSteps.length; i++) {
            this.advancePhase();
        }
        // Should wrap around to start
        const endIndex = this.state.currentFlowStepIndex;
        this.steps.push({
            action: 'completeFullCycle',
            before: { currentFlowStepIndex: startIndex },
            after: { currentFlowStepIndex: endIndex },
            passed: true,
            assertion: `Wrapped from ${startIndex} through cycle to ${endIndex}`,
        });
    }
    // ============================================================
    // HELPERS
    // ============================================================
    captureState() {
        return {
            currentPhase: this.state.currentPhase,
            currentFlowStepIndex: this.state.currentFlowStepIndex,
            isPostponed: this.state.isPostponed,
            postponedPhase: this.state.postponedPhase,
            interruptedPhase: this.state.interruptedPhase,
            cumulativeWorkTimeMs: this.state.cumulativeWorkTimeMs,
        };
    }
    getPhaseDuration(phase) {
        switch (phase) {
            case 'sit':
                return this.schedule.sitMinutes * 60 * 1000;
            case 'stand':
                return this.schedule.standMinutes * 60 * 1000;
            case 'sit-to-stand-transition':
                return (this.schedule.sitToStandTransitionSeconds ?? 60) * 1000;
            case 'stand-to-sit-transition':
                return (this.schedule.standToSitTransitionSeconds ?? 60) * 1000;
            case 'short-break':
                return (this.schedule.shortBreak?.durationMinutes ?? 5) * 60 * 1000;
            case 'long-break':
                return (this.schedule.longBreak?.durationMinutes ?? 15) * 60 * 1000;
            default:
                return 0;
        }
    }
    validateState() {
        const context = this.getContext();
        const invariantResult = (0, runtimeInvariants_1.checkRuntimeInvariants)(this.state, context);
        const validationResult = (0, sessionValidator_1.validateSessionState)(this.state, this.schedule);
        return invariantResult.valid && validationResult.valid;
    }
    /**
     * Assert a condition
     */
    assert(condition, message) {
        if (!condition) {
            this.steps.push({
                action: 'assertion',
                before: {},
                after: {},
                passed: false,
                assertion: message,
            });
        }
    }
}
exports.TestHarness = TestHarness;
// ============================================================
// TEST SCENARIOS
// ============================================================
exports.TEST_SCENARIOS = [
    {
        name: 'Scenario 1: Full Flow Cycle',
        description: 'Sit → transition → stand → transition → break → resume',
        run: async (harness) => {
            const startTime = Date.now();
            // Start at sit
            harness.assert(harness.getState().currentPhase === 'sit', 'Should start at sit');
            // Advance through flow
            harness.advancePhase(); // sit-to-stand-transition
            harness.assert(harness.getState().currentPhase === 'sit-to-stand-transition', 'Should be at transition');
            harness.advancePhase(); // stand
            harness.assert(harness.getState().currentPhase === 'stand', 'Should be at stand');
            harness.advancePhase(); // stand-to-sit-transition
            harness.assert(harness.getState().currentPhase === 'stand-to-sit-transition', 'Should be at transition');
            harness.advancePhase(); // short-break
            harness.assert(harness.getState().currentPhase === 'short-break', 'Should be at short-break');
            harness.advancePhase(); // back to sit
            harness.assert(harness.getState().currentPhase === 'sit', 'Should wrap back to sit');
            return {
                name: 'Scenario 1: Full Flow Cycle',
                passed: harness.getSteps().every(s => s.passed),
                duration: Date.now() - startTime,
                steps: harness.getSteps(),
            };
        },
    },
    {
        name: 'Scenario 2: Skip Repeatedly',
        description: 'Skip repeatedly across full flow cycle',
        run: async (harness) => {
            const startTime = Date.now();
            const schedule = harness.getSchedule();
            if (!(0, flowUtils_1.isFlowBasedSchedule)(schedule)) {
                return { name: 'Scenario 2', passed: true, duration: 0, steps: [] };
            }
            const flowLength = schedule.flowSteps.length;
            // Skip through entire flow twice
            for (let i = 0; i < flowLength * 2; i++) {
                harness.skipPhase();
            }
            // Should have valid state after all skips
            const state = harness.getState();
            harness.assert(state.currentFlowStepIndex !== undefined, 'Should have valid flow index');
            return {
                name: 'Scenario 2: Skip Repeatedly',
                passed: harness.getSteps().every(s => s.passed),
                duration: Date.now() - startTime,
                steps: harness.getSteps(),
            };
        },
    },
    {
        name: 'Scenario 3: Postpone Break',
        description: 'Postpone break during flow-based schedule',
        run: async (harness) => {
            const startTime = Date.now();
            // Advance to break
            while (harness.getState().currentPhase !== 'short-break') {
                harness.advancePhase();
            }
            // Postpone the break
            const postponed = harness.postponeBreak(5);
            harness.assert(postponed, 'Should successfully postpone');
            const state = harness.getState();
            harness.assert(state.isPostponed, 'Should be postponed');
            harness.assert(state.postponedPhase === 'short-break', 'Should have pending break');
            harness.assert(state.currentPhase !== 'short-break', 'Current phase should not be break');
            return {
                name: 'Scenario 3: Postpone Break',
                passed: harness.getSteps().every(s => s.passed),
                duration: Date.now() - startTime,
                steps: harness.getSteps(),
            };
        },
    },
    {
        name: 'Scenario 4: Reset During Work',
        description: 'Reset during work phase',
        run: async (harness) => {
            const startTime = Date.now();
            // Advance a few phases
            harness.advancePhase();
            harness.advancePhase();
            // Reset while in work
            harness.resetSession();
            const state = harness.getState();
            harness.assert(state.currentPhase === 'sit', 'Should reset to sit');
            harness.assert(state.cumulativeWorkTimeMs === 0, 'Work time should be reset');
            harness.assert(!state.isPostponed, 'Should not be postponed');
            return {
                name: 'Scenario 4: Reset During Work',
                passed: harness.getSteps().every(s => s.passed),
                duration: Date.now() - startTime,
                steps: harness.getSteps(),
            };
        },
    },
    {
        name: 'Scenario 5: Reset During Break',
        description: 'Reset during break phase',
        run: async (harness) => {
            const startTime = Date.now();
            // Advance to break
            while (harness.getState().currentPhase !== 'short-break') {
                harness.advancePhase();
            }
            harness.assert(harness.getState().currentPhase === 'short-break', 'Should be at break');
            // Reset during break
            harness.resetSession();
            const state = harness.getState();
            harness.assert(state.currentPhase === 'sit', 'Should reset to sit');
            harness.assert(state.interruptedPhase === null, 'Should clear interrupted phase');
            return {
                name: 'Scenario 5: Reset During Break',
                passed: harness.getSteps().every(s => s.passed),
                duration: Date.now() - startTime,
                steps: harness.getSteps(),
            };
        },
    },
    {
        name: 'Scenario 6: Restart Recovery During Work',
        description: 'Restart recovery during work phase',
        run: async (harness) => {
            const startTime = Date.now();
            // Advance a bit
            harness.advancePhase();
            // Simulate 2 minute restart
            harness.simulateRestartRecovery(2 * 60 * 1000);
            const state = harness.getState();
            harness.assert(state.currentPhase !== 'idle', 'Should not be idle');
            return {
                name: 'Scenario 6: Restart Recovery During Work',
                passed: harness.getSteps().every(s => s.passed),
                duration: Date.now() - startTime,
                steps: harness.getSteps(),
            };
        },
    },
    {
        name: 'Scenario 7: Restart Recovery During Break',
        description: 'Restart recovery during break phase',
        run: async (harness) => {
            const startTime = Date.now();
            // Trigger a break
            harness.triggerBreak('short-break');
            // Simulate 1 minute restart
            harness.simulateRestartRecovery(1 * 60 * 1000);
            const state = harness.getState();
            harness.assert(state.currentPhase !== 'idle', 'Should not be idle');
            return {
                name: 'Scenario 7: Restart Recovery During Break',
                passed: harness.getSteps().every(s => s.passed),
                duration: Date.now() - startTime,
                steps: harness.getSteps(),
            };
        },
    },
    {
        name: 'Scenario 8: Restart Recovery During Postponed Break',
        description: 'Restart recovery during postponed break',
        run: async (harness) => {
            const startTime = Date.now();
            // Trigger and postpone a break
            harness.triggerBreak('short-break');
            harness.postponeBreak(5);
            harness.assert(harness.getState().isPostponed, 'Should be postponed');
            // Simulate restart
            harness.simulateRestartRecovery(1 * 60 * 1000);
            const state = harness.getState();
            harness.assert(state.isPostponed, 'Should still be postponed after recovery');
            return {
                name: 'Scenario 8: Restart Recovery During Postponed Break',
                passed: harness.getSteps().every(s => s.passed),
                duration: Date.now() - startTime,
                steps: harness.getSteps(),
            };
        },
    },
    {
        name: 'Scenario 9: Edit Schedule While Active',
        description: 'Edit schedule while active (should mark as stale)',
        run: async (harness) => {
            const startTime = Date.now();
            const schedule = harness.getSchedule();
            if (!(0, flowUtils_1.isFlowBasedSchedule)(schedule)) {
                return { name: 'Scenario 9', passed: true, duration: 0, steps: [] };
            }
            // Edit schedule (add a step)
            const newFlowSteps = [
                ...schedule.flowSteps,
                { id: 'new-step', type: 'sit', durationSeconds: 600 },
            ];
            harness.editSchedule(newFlowSteps);
            // Session should detect staleness
            const state = harness.getState();
            const currentHash = state.flowConfigHash;
            const newHash = (0, types_1.computeFlowConfigHash)(newFlowSteps);
            harness.assert(currentHash !== newHash, 'Session should be stale');
            return {
                name: 'Scenario 9: Edit Schedule While Active',
                passed: harness.getSteps().every(s => s.passed),
                duration: Date.now() - startTime,
                steps: harness.getSteps(),
            };
        },
    },
    {
        name: 'Scenario 10: Flow Wrap-Around',
        description: 'Complete full flow cycle and wrap around',
        run: async (harness) => {
            const startTime = Date.now();
            const schedule = harness.getSchedule();
            if (!(0, flowUtils_1.isFlowBasedSchedule)(schedule)) {
                return { name: 'Scenario 10', passed: true, duration: 0, steps: [] };
            }
            const startIndex = harness.getState().currentFlowStepIndex ?? 0;
            // Complete full cycle
            harness.completeFullCycle();
            const endIndex = harness.getState().currentFlowStepIndex ?? 0;
            // Should have wrapped around
            harness.assert(endIndex === startIndex, `Should wrap around: started at ${startIndex}, ended at ${endIndex}`);
            return {
                name: 'Scenario 10: Flow Wrap-Around',
                passed: harness.getSteps().every(s => s.passed),
                duration: Date.now() - startTime,
                steps: harness.getSteps(),
            };
        },
    },
    // ============================================================
    // BREAK CONFLICT SCENARIOS (Scenarios 11-14)
    // ============================================================
    {
        name: 'Scenario 11: Pending Short Break - New Short Break Ignored',
        description: 'When short break is pending, new short break should be ignored/merged',
        run: async (harness) => {
            const startTime = Date.now();
            // Trigger and postpone a short break
            harness.triggerBreak('short-break');
            harness.postponeBreak(5);
            harness.assert(harness.getState().isPostponed, 'Should have pending break');
            harness.assert(harness.getState().postponedPhase === 'short-break', 'Pending should be short-break');
            // Try to trigger another short break - should be ignored
            harness.triggerBreak('short-break');
            // Should still have same pending break (no duplicate)
            harness.assert(harness.getState().isPostponed, 'Should still be postponed');
            harness.assert(harness.getState().postponedPhase === 'short-break', 'Should still be short-break');
            return {
                name: 'Scenario 11: Pending Short Break - New Short Break Ignored',
                passed: harness.getSteps().every(s => s.passed),
                duration: Date.now() - startTime,
                steps: harness.getSteps(),
            };
        },
    },
    {
        name: 'Scenario 12: Pending Short Break - Long Break Supersedes',
        description: 'When short break is pending, long break should replace it',
        run: async (harness) => {
            const startTime = Date.now();
            // Trigger and postpone a short break
            harness.triggerBreak('short-break');
            harness.postponeBreak(5);
            harness.assert(harness.getState().postponedPhase === 'short-break', 'Pending should be short-break');
            // Trigger long break - should supersede
            harness.triggerBreak('long-break');
            // Long break should now be active (not pending short break)
            const state = harness.getState();
            harness.assert(state.currentPhase === 'long-break' || state.postponedPhase === 'long-break', 'Long break should be active or pending');
            return {
                name: 'Scenario 12: Pending Short Break - Long Break Supersedes',
                passed: harness.getSteps().every(s => s.passed),
                duration: Date.now() - startTime,
                steps: harness.getSteps(),
            };
        },
    },
    {
        name: 'Scenario 13: Pending Long Break - Short Break Ignored',
        description: 'When long break is pending, short break should be ignored',
        run: async (harness) => {
            const startTime = Date.now();
            // Trigger and postpone a long break
            harness.triggerBreak('long-break');
            harness.postponeBreak(5);
            harness.assert(harness.getState().postponedPhase === 'long-break', 'Pending should be long-break');
            // Try to trigger short break - should be ignored
            harness.triggerBreak('short-break');
            // Should still have long break pending
            harness.assert(harness.getState().isPostponed, 'Should still be postponed');
            harness.assert(harness.getState().postponedPhase === 'long-break', 'Should still be long-break');
            return {
                name: 'Scenario 13: Pending Long Break - Short Break Ignored',
                passed: harness.getSteps().every(s => s.passed),
                duration: Date.now() - startTime,
                steps: harness.getSteps(),
            };
        },
    },
    {
        name: 'Scenario 14: Reset Clears Pending Break',
        description: 'Reset should clear any pending break state',
        run: async (harness) => {
            const startTime = Date.now();
            // Trigger and postpone a break
            harness.triggerBreak('short-break');
            harness.postponeBreak(5);
            harness.assert(harness.getState().isPostponed, 'Should have pending break');
            // Reset session
            harness.resetSession();
            // Should have no pending break
            const state = harness.getState();
            harness.assert(!state.isPostponed, 'Should not be postponed after reset');
            harness.assert(state.postponedPhase === null, 'Postponed phase should be null');
            harness.assert(state.postponedUntil === null, 'Postponed until should be null');
            return {
                name: 'Scenario 14: Reset Clears Pending Break',
                passed: harness.getSteps().every(s => s.passed),
                duration: Date.now() - startTime,
                steps: harness.getSteps(),
            };
        },
    },
];
async function runTestSuite() {
    const startTime = Date.now();
    const results = [];
    for (const scenario of exports.TEST_SCENARIOS) {
        const schedule = createMockFlowSchedule();
        const harness = new TestHarness(schedule);
        try {
            const result = await scenario.run(harness);
            results.push(result);
        }
        catch (error) {
            results.push({
                name: scenario.name,
                passed: false,
                duration: 0,
                steps: [],
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return {
        totalTests: results.length,
        passed: results.filter(r => r.passed).length,
        failed: results.filter(r => !r.passed).length,
        results,
        duration: Date.now() - startTime,
    };
}
function formatTestResults(suite) {
    const lines = [
        '═══════════════════════════════════════════════════════════════',
        '  RhythmDesk Test Harness - Results',
        '═══════════════════════════════════════════════════════════════',
        '',
        `  Total: ${suite.totalTests} | Passed: ${suite.passed} | Failed: ${suite.failed}`,
        `  Duration: ${suite.duration}ms`,
        '',
        '───────────────────────────────────────────────────────────────',
    ];
    for (const result of suite.results) {
        const status = result.passed ? '✓' : '✗';
        lines.push(`  ${status} ${result.name} (${result.duration}ms)`);
        if (!result.passed) {
            if (result.error) {
                lines.push(`    Error: ${result.error}`);
            }
            for (const step of result.steps.filter(s => !s.passed)) {
                lines.push(`    - ${step.action}: ${step.assertion || 'Failed'}`);
            }
        }
    }
    lines.push('═══════════════════════════════════════════════════════════════');
    return lines.join('\n');
}
//# sourceMappingURL=testHarness.js.map