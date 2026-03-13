"use strict";
/**
 * RhythmDesk Timer Engine
 * Core business logic for tracking work phases, breaks, and transitions
 *
 * IMPORTANT RULES:
 * - Cumulative work time = sit + stand + transitions + short breaks
 * - Only long breaks reset cumulative work time
 * - Long breaks trigger based on cumulative work time threshold
 * - Long break has highest priority, then short break, then transition
 * - Paused/postponed time does NOT count toward cumulative time
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimerEngine = void 0;
exports.getTimerEngine = getTimerEngine;
const events_1 = require("events");
const electron_1 = require("electron");
const types_1 = require("../shared/types");
const officeFocusLockService_1 = require("./officeFocusLockService");
const restBlockService_1 = require("./restBlockService");
const timeUtils_1 = require("../shared/timeUtils");
const constants_1 = require("../shared/constants");
const configService_1 = __importDefault(require("./configService"));
const scheduleResolver_1 = require("./scheduleResolver");
const overlayPolicy_1 = require("./overlayPolicy");
const logger_1 = __importDefault(require("./logger"));
const flowUtils_1 = require("./flowUtils");
const transitions_1 = require("./transitions");
const breakConflict_1 = require("./breakConflict");
const sessionValidator_1 = require("./sessionValidator");
const sessionDebug_1 = require("./sessionDebug");
const runtimeInvariants_1 = require("./runtimeInvariants");
const traceLogger_1 = require("./traceLogger");
const TIME_JUMP_THRESHOLD_MS = 5000; // 5 seconds - indicates sleep/wake or time jump
const STATE_SAVE_DEBOUNCE_MS = 5000; // Save state every 5 seconds max
class TimerEngine extends events_1.EventEmitter {
    /**
     * PHASE 1.5: Get the runtime flow steps (frozen snapshot)
     * Returns the frozen snapshot if available, otherwise falls back to config
     * This ensures config edits don't affect active runtime until reset
     */
    getRuntimeFlowSteps() {
        // Use frozen snapshot if available
        if (this.runtimeFlowSnapshot && this.runtimeFlowSnapshot.length > 0) {
            return this.runtimeFlowSnapshot;
        }
        // Fall back to schedule config (for recovery/initial state)
        return this.currentSchedule?.flowSteps;
    }
    /**
     * PHASE 1.5: Freeze the current flow config as runtime snapshot
     * Called when session starts or is explicitly reset
     */
    freezeFlowSnapshot() {
        if (this.currentSchedule && (0, flowUtils_1.isFlowBasedSchedule)(this.currentSchedule)) {
            // Deep copy to prevent mutation
            this.runtimeFlowSnapshot = JSON.parse(JSON.stringify(this.currentSchedule.flowSteps));
            logger_1.default.info('TimerEngine', 'Flow snapshot frozen', {
                stepCount: this.runtimeFlowSnapshot?.length,
                hash: this.runtimeFlowSnapshot ? (0, types_1.computeFlowConfigHash)(this.runtimeFlowSnapshot) : undefined,
            });
        }
        else {
            this.runtimeFlowSnapshot = null;
        }
    }
    /**
     * ARCHITECTURE HARDENING: Create transition context for invariant checks
     */
    getTransitionContext() {
        return {
            schedule: this.currentSchedule,
            runtimeFlowSnapshot: this.runtimeFlowSnapshot,
        };
    }
    /**
     * ARCHITECTURE HARDENING: Validate current state against runtime invariants
     * Called before committing state changes to prevent invalid states
     */
    validateStateInvariants(label) {
        const context = this.getTransitionContext();
        const result = (0, runtimeInvariants_1.checkRuntimeInvariants)(this.state, context);
        if (!result.valid) {
            (0, runtimeInvariants_1.logInvariantViolations)(result.violations, label);
            return false;
        }
        return true;
    }
    /**
     * ARCHITECTURE HARDENING: Validate preconditions before transition
     */
    canPerformTransition(transitionType) {
        const context = this.getTransitionContext();
        const result = (0, runtimeInvariants_1.validateTransitionPreconditions)(transitionType, this.state, context);
        if (!result.valid) {
            logger_1.default.debug('TimerEngine', `Transition ${transitionType} blocked`, {
                failedPreconditions: result.failedPreconditions,
            });
            return { allowed: false, reason: result.failedPreconditions[0] };
        }
        return { allowed: true };
    }
    constructor() {
        super();
        this.currentSchedule = null;
        this.tickInterval = null;
        this.lastTickTime = 0;
        this.lastStateSaveTime = 0;
        this.stateChanged = false;
        // Track the phase we were in before a break interrupted
        this.preBreakPhase = null;
        // PHASE 1.5: Frozen flow snapshot for active runtime
        // This prevents config edits from leaking into active session
        // Only updated on session start or explicit reset
        this.runtimeFlowSnapshot = null;
        this.state = configService_1.default.getSessionState();
        this.validateAndResetDailyCounters();
        this.recoverStateFromTimestamps();
        this.setupPowerMonitor();
    }
    /**
     * Setup power monitor for sleep/wake events
     */
    setupPowerMonitor() {
        electron_1.powerMonitor.on('suspend', () => {
            logger_1.default.info('TimerEngine', 'System suspending - saving state');
            this.saveStateImmediately();
        });
        electron_1.powerMonitor.on('resume', () => {
            logger_1.default.info('TimerEngine', 'System resuming - recovering state');
            this.recoverStateFromTimestamps();
        });
        electron_1.powerMonitor.on('lock-screen', () => {
            logger_1.default.debug('TimerEngine', 'Screen locked');
        });
        electron_1.powerMonitor.on('unlock-screen', () => {
            logger_1.default.debug('TimerEngine', 'Screen unlocked - checking state');
            this.recoverStateFromTimestamps();
        });
    }
    /**
     * Recover state from persisted timestamps
     * Used after sleep/wake, time jumps, or app restart
     *
     * RECOVERY BEHAVIOR:
     * - Validates session state against current schedule
     * - Normalizes any inconsistencies (flow index, postpone state, etc.)
     * - Handles stale phases (>5 min old) by resetting to idle
     * - Preserves postponed breaks correctly
     */
    recoverStateFromTimestamps() {
        const now = Date.now();
        // Phase 1.5: Log recovery start
        (0, sessionDebug_1.logSessionEvent)({
            event: 'restartRecovery',
            phase: this.state.currentPhase,
            index: this.state.currentFlowStepIndex,
            pendingBreak: this.state.postponedPhase,
            postponeUntil: this.state.postponedUntil,
            cumulativeWorkMs: this.state.cumulativeWorkTimeMs,
            scheduleId: this.state.activeScheduleId,
        });
        // Skip if idle
        if (this.state.currentPhase === 'idle')
            return;
        // If paused, nothing to recover
        if (this.state.isPaused)
            return;
        // Validate and normalize state first
        const schedules = configService_1.default.getSchedules();
        const activeSchedule = this.state.activeScheduleId
            ? schedules.find(s => s.id === this.state.activeScheduleId)
            : null;
        // Validate state
        const validation = (0, sessionValidator_1.validateSessionState)(this.state, activeSchedule ?? null);
        if (!validation.valid || validation.warnings.length > 0) {
            (0, sessionValidator_1.logValidationResult)(validation, 'Recovery - before normalization');
            // Normalize state to fix inconsistencies
            const normalized = (0, sessionValidator_1.normalizeSessionState)(this.state, activeSchedule ?? null);
            if (normalized.changed) {
                this.state = normalized.state;
                logger_1.default.info('TimerEngine', 'Recovery: normalized state', { changes: normalized.changes });
            }
        }
        // Verify flow index is valid for flow-based schedules
        if (activeSchedule && (0, flowUtils_1.isFlowBasedSchedule)(activeSchedule)) {
            const flowSteps = activeSchedule.flowSteps;
            if (!(0, transitions_1.isValidFlowIndex)(this.state.currentFlowStepIndex, flowSteps)) {
                logger_1.default.warn('TimerEngine', 'Recovery: invalid flow index, resyncing');
                const correctIndex = (0, transitions_1.findPhaseIndex)(flowSteps, this.state.currentPhase);
                this.state.currentFlowStepIndex = correctIndex !== -1 ? correctIndex : (0, transitions_1.findFirstWorkPhaseIndex)(flowSteps);
            }
            // PHASE 1.5: Initialize runtime flow snapshot on recovery
            // Use the session's flowConfigHash to determine if we need fresh snapshot
            if (!this.runtimeFlowSnapshot) {
                this.currentSchedule = activeSchedule;
                this.freezeFlowSnapshot();
                logger_1.default.info('TimerEngine', 'Recovery: initialized runtime flow snapshot');
            }
        }
        // If postponed, check if postpone has ended
        if (this.state.isPostponed && this.state.postponedUntil) {
            if (now >= this.state.postponedUntil) {
                (0, transitions_1.logTransition)(transitions_1.TransitionType.POSTPONE_ENDED, {
                    postponedPhase: this.state.postponedPhase,
                });
                this.state.isPostponed = false;
                this.state.postponedUntil = null;
                if (this.state.postponedPhase) {
                    this.startPhase(this.state.postponedPhase);
                }
                this.state.postponedPhase = null;
                this.state.postponedBreakType = null;
                return;
            }
        }
        // Recalculate phase remaining from phaseEndsAt
        if (this.state.phaseEndsAt > 0) {
            const remaining = this.state.phaseEndsAt - now;
            const timeSincePhaseEnded = -remaining;
            if (remaining <= 0) {
                // Phase ended - check how long ago
                // If it ended more than 5 minutes ago, reset session instead of advancing
                // This prevents weird state after app restart with stale state
                const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
                if (timeSincePhaseEnded > STALE_THRESHOLD_MS) {
                    logger_1.default.info('TimerEngine', 'Phase ended long ago - resetting to idle', {
                        phase: this.state.currentPhase,
                        phaseEndsAt: this.state.phaseEndsAt,
                        timeSinceEndedMs: timeSincePhaseEnded,
                    });
                    // Reset to fresh state - will be handled by checkScheduleChange in first tick
                    this.state.currentPhase = 'idle';
                    this.state.phaseEndsAt = 0;
                    this.state.phaseRemainingMs = 0;
                    this.state.currentFlowStepIndex = undefined;
                    this.saveState();
                }
                else {
                    // Phase ended recently - advance normally
                    logger_1.default.info('TimerEngine', 'Phase ended during sleep/wake - advancing', {
                        phase: this.state.currentPhase,
                        phaseEndsAt: this.state.phaseEndsAt,
                        now,
                    });
                    this.advancePhase();
                }
            }
            else {
                this.state.phaseRemainingMs = remaining;
            }
        }
    }
    /**
     * Reset daily counters (postpones and break counts) if it's a new day
     */
    validateAndResetDailyCounters() {
        const today = (0, timeUtils_1.getTodayDateString)();
        let changed = false;
        // Reset postpone counts
        if (this.state.postponeResetDate !== today) {
            this.state.postponeCountsToday = { ...types_1.INITIAL_POSTPONE_COUNTS };
            this.state.postponeResetDate = today;
            changed = true;
        }
        // Reset break counts
        if ((this.state.breakCountResetDate ?? '') !== today) {
            this.state.shortBreakCountToday = 0;
            this.state.longBreakCountToday = 0;
            this.state.breakCountResetDate = today;
            changed = true;
        }
        if (changed) {
            this.saveState();
        }
    }
    /**
     * Start the timer engine
     */
    start() {
        if (this.tickInterval)
            return;
        logger_1.default.info('TimerEngine', 'Starting timer engine');
        this.lastTickTime = Date.now();
        this.lastStateSaveTime = Date.now();
        this.tickInterval = setInterval(() => this.tick(), constants_1.TIMER_TICK_INTERVAL_MS);
        this.tick(); // Initial tick
    }
    /**
     * Stop the timer engine
     */
    stop() {
        logger_1.default.info('TimerEngine', 'Stopping timer engine');
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }
        this.saveStateImmediately();
    }
    /**
     * Get the effective delta time, applying simulate mode speed if enabled
     */
    getEffectiveDelta(realDeltaMs) {
        const settings = configService_1.default.getGeneralSettings();
        if (settings.simulateMode) {
            return realDeltaMs * constants_1.SIMULATE_MODE_SPEED;
        }
        return realDeltaMs;
    }
    /**
     * Main timer tick - called every second
     * Wrapped in try-catch to prevent interval from stopping on exception
     */
    tick() {
        try {
            this.tickInternal();
        }
        catch (error) {
            // CRITICAL: Log but don't crash - keep the timer running
            logger_1.default.error('TimerEngine', 'Exception in tick - timer continues', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
        }
    }
    /**
     * Internal tick implementation
     */
    tickInternal() {
        const now = Date.now();
        const realDeltaMs = now - this.lastTickTime;
        this.lastTickTime = now;
        // Detect time jump (sleep/wake or system time change)
        if (realDeltaMs > TIME_JUMP_THRESHOLD_MS) {
            logger_1.default.warn('TimerEngine', `Time jump detected: ${realDeltaMs}ms - recovering state`);
            this.recoverStateFromTimestamps();
        }
        // Apply simulate mode speed multiplier
        const deltaMs = this.getEffectiveDelta(realDeltaMs);
        this.validateAndResetDailyCounters();
        // Check for schedule changes
        this.checkScheduleChange();
        if (!this.currentSchedule) {
            this.setIdleState();
            this.emitTick();
            return;
        }
        // Handle postponed break - WORK CONTINUES during postpone!
        // Check if postponed break should now trigger
        if (this.state.isPostponed && this.state.postponedUntil) {
            if (now >= this.state.postponedUntil) {
                // Postpone period ended - trigger the pending break with overlay
                const pendingBreak = this.state.postponedPhase;
                // Clear postpone state BEFORE starting break
                this.state.isPostponed = false;
                this.state.postponedUntil = null;
                this.state.postponedPhase = null;
                this.state.postponedBreakType = null;
                // Store current work phase so we can resume after break
                if (this.isWorkPhase(this.state.currentPhase)) {
                    this.state.interruptedPhase = this.state.currentPhase;
                    this.state.interruptedPhaseRemainingMs = this.state.phaseRemainingMs;
                    this.preBreakPhase = this.state.currentPhase;
                }
                if (pendingBreak) {
                    logger_1.default.info('TimerEngine', `Postponed break triggering: ${pendingBreak}`);
                    // Start the break - this will trigger phaseChange event which shows overlay
                    this.startPhase(pendingBreak);
                    this.emitTick();
                    this.saveState();
                    return;
                }
            }
            // If still in postpone period, work continues normally (fall through to normal tick logic)
        }
        // Handle paused state
        if (this.state.isPaused) {
            if (this.state.pauseResumeAt && now >= this.state.pauseResumeAt) {
                this.resume();
            }
            else {
                this.emitTick();
                return;
            }
        }
        // Update phase remaining time
        this.state.phaseRemainingMs -= deltaMs;
        // Track cumulative work time for long break triggers
        // Includes: sit, stand, transitions, short breaks (all count toward long break threshold)
        if (this.countsToCumulativeWorkTime(this.state.currentPhase)) {
            this.state.cumulativeWorkTimeMs += deltaMs;
        }
        // Check if current phase is complete
        if (this.state.phaseRemainingMs <= 0) {
            this.advancePhase();
        }
        else {
            // Check for break triggers based on cumulative work time
            this.checkBreakTriggers();
        }
        this.emitTick();
        this.saveState();
    }
    /**
     * Check if we need to switch to a different schedule
     * Also refreshes schedule config if the same schedule was edited
     */
    checkScheduleChange() {
        const schedules = configService_1.default.getSchedules();
        const activeSchedule = (0, scheduleResolver_1.resolveActiveSchedule)(schedules);
        if (activeSchedule?.id !== this.currentSchedule?.id) {
            // Schedule changed completely (different ID or became null/active)
            const prevPhase = this.state.currentPhase;
            this.currentSchedule = activeSchedule;
            if (activeSchedule) {
                // Starting a new schedule
                this.state.activeScheduleId = activeSchedule.id;
                this.state.cumulativeWorkTimeMs = 0;
                this.state.lastShortBreakAtWorkTimeMs = 0;
                this.state.lastLongBreakAtWorkTimeMs = 0;
                // Initialize flow step index for flow-based schedules
                if ((0, flowUtils_1.isFlowBasedSchedule)(activeSchedule)) {
                    this.state.currentFlowStepIndex = 0;
                    this.state.flowConfigHash = (0, types_1.computeFlowConfigHash)(activeSchedule.flowSteps);
                    // PHASE 1.5: Freeze flow snapshot for active runtime
                    this.freezeFlowSnapshot();
                    const firstStep = activeSchedule.flowSteps[0];
                    this.startPhase(firstStep.type);
                }
                else {
                    this.state.currentFlowStepIndex = undefined;
                    this.state.flowConfigHash = undefined;
                    this.runtimeFlowSnapshot = null;
                    this.startPhase('sit'); // Rule-based: always start with sitting
                }
            }
            else {
                // CRITICAL FIX: When schedule ends (becomes null), emit phaseChange
                // so the overlay is properly closed. This prevents blank overlay freeze.
                this.setIdleState();
                this.emit('phaseChange', { prevPhase, newPhase: 'idle' });
                logger_1.default.info('TimerEngine', 'Schedule ended - emitting phaseChange to close overlay', { prevPhase });
            }
            this.emit('scheduleChange', this.currentSchedule);
        }
        else if (activeSchedule && this.currentSchedule) {
            // Same schedule ID - config might have been edited
            // PHASE 1.5 FIX: Do NOT refresh runtime schedule from config
            // Keep using the frozen snapshot until explicit reset
            // Only update non-flow settings that are safe to change mid-session
            // (e.g., strictMode, sound settings, but NOT flowSteps or durations)
            // 
            // The isFlowSessionStale() check will detect config changes
            // and dashboard will show "flow stale" notification
            // User must explicitly reset to apply changes
            //
            // NOTE: We intentionally do NOT do: this.currentSchedule = activeSchedule
            // This prevents config edits from leaking into active runtime
        }
    }
    /**
     * Check if the current flow-based session is stale (flow config changed since session started)
     */
    isFlowSessionStale() {
        if (!this.currentSchedule || !(0, flowUtils_1.isFlowBasedSchedule)(this.currentSchedule)) {
            return false;
        }
        const currentHash = (0, types_1.computeFlowConfigHash)(this.currentSchedule.flowSteps);
        const sessionHash = this.state.flowConfigHash;
        // Stale if we have a session hash that doesn't match current config
        return sessionHash !== undefined && sessionHash !== currentHash;
    }
    /**
     * Check if a break should be triggered based on cumulative work time
     * Priority: long break > short break
     * RULE: Only trigger breaks during sit/stand phases, never during transitions
     * NOTE: In flow-based mode, only long breaks are triggered as interrupts
     *       (short breaks are part of the configured flow)
     */
    checkBreakTriggers() {
        if (!this.currentSchedule)
            return;
        // Only trigger breaks during actual work phases (sit/stand), not transitions
        if (!this.isWorkPhase(this.state.currentPhase))
            return;
        // Don't trigger new breaks if there's already a postponed break pending
        if (this.state.isPostponed && this.state.postponedPhase)
            return;
        const workTimeMs = this.state.cumulativeWorkTimeMs;
        const schedule = this.currentSchedule;
        const isFlowMode = (0, flowUtils_1.isFlowBasedSchedule)(schedule);
        // Check long break first (highest priority) - works in both modes
        const longBreakEnabled = schedule.longBreak?.enabled ?? schedule.longBreakEnabled ?? false;
        if (longBreakEnabled) {
            const longBreakEvery = schedule.longBreak?.everyMinutes ?? schedule.longBreakEveryMinutes ?? 150;
            const longBreakThreshold = (0, timeUtils_1.minutesToMs)(longBreakEvery);
            const timeSinceLastLongBreak = workTimeMs - this.state.lastLongBreakAtWorkTimeMs;
            if (timeSinceLastLongBreak >= longBreakThreshold) {
                this.triggerBreak('long-break');
                return;
            }
        }
        // Check short break - only in rule-based mode
        // In flow-based mode, short breaks are part of the configured flow
        if (!isFlowMode) {
            const shortBreakEnabled = schedule.shortBreak?.enabled ?? schedule.shortBreakEnabled ?? false;
            if (shortBreakEnabled) {
                const shortBreakEvery = schedule.shortBreak?.everyMinutes ?? schedule.shortBreakEveryMinutes ?? 60;
                const shortBreakThreshold = (0, timeUtils_1.minutesToMs)(shortBreakEvery);
                const timeSinceLastShortBreak = workTimeMs - this.state.lastShortBreakAtWorkTimeMs;
                if (timeSinceLastShortBreak >= shortBreakThreshold) {
                    this.triggerBreak('short-break');
                    return;
                }
            }
        }
    }
    /**
     * Get current break state for conflict resolution
     */
    getBreakState() {
        const activeBreak = (0, breakConflict_1.isBreakPhase)(this.state.currentPhase)
            ? this.state.currentPhase
            : null;
        const pendingBreak = this.state.isPostponed && this.state.postponedPhase
            ? ((0, breakConflict_1.isBreakPhase)(this.state.postponedPhase) ? this.state.postponedPhase : null)
            : null;
        return {
            activeBreak,
            pendingBreak,
            pendingBreakDueAt: this.state.postponedUntil,
        };
    }
    /**
     * Trigger a break, interrupting current phase
     * Stores current phase info to resume after break completes
     *
     * BREAK CONFLICT POLICY:
     * - Check for conflicts before triggering
     * - Long break supersedes short break
     * - Don't stack duplicate breaks
     *
     * PHASE 1.5 FIX: Also stores interrupted flow index for proper restoration
     */
    triggerBreak(breakType) {
        // BREAK CONFLICT RESOLUTION: Check for conflicts before triggering
        const breakState = this.getBreakState();
        const resolution = (0, breakConflict_1.resolveBreakConflict)(breakState, breakType);
        logger_1.default.info('TimerEngine', 'Break conflict resolution', {
            breakType,
            resolution: resolution.action,
            reason: resolution.reason,
            activeBreak: breakState.activeBreak,
            pendingBreak: breakState.pendingBreak,
        });
        // Handle resolution
        switch (resolution.action) {
            case 'skip':
            case 'merge':
                // Don't trigger the break - conflict exists
                logger_1.default.info('TimerEngine', `Skipping ${breakType}: ${resolution.reason}`);
                return;
            case 'replace':
                // Replace pending break with higher priority break
                if (resolution.shouldClearPending) {
                    logger_1.default.info('TimerEngine', `Replacing pending ${breakState.pendingBreak} with ${breakType}`);
                    this.state.isPostponed = false;
                    this.state.postponedPhase = null;
                    this.state.postponedUntil = null;
                    this.state.postponedBreakType = null;
                }
                break;
            case 'allow':
                // No conflict, proceed normally
                break;
        }
        // Store current phase to resume after break
        this.preBreakPhase = this.state.currentPhase;
        // PHASE 1.5: Track interrupted flow index for flow-based schedules
        // This ensures we can restore the correct flow position after break/postpone
        if ((0, flowUtils_1.isFlowBasedSchedule)(this.currentSchedule)) {
            this.state.interruptedFlowIndex = this.state.currentFlowStepIndex;
        }
        // Phase 1.5: Log break start
        (0, sessionDebug_1.logSessionEvent)({
            event: 'breakStart',
            phase: breakType,
            fromPhase: this.state.currentPhase,
            cumulativeWorkMs: this.state.cumulativeWorkTimeMs,
            index: this.state.currentFlowStepIndex,
            interruptedIndex: this.state.interruptedFlowIndex,
            scheduleId: this.currentSchedule?.id,
        });
        // Increment break count
        if (breakType === 'short-break') {
            this.state.shortBreakCountToday = (this.state.shortBreakCountToday ?? 0) + 1;
        }
        else {
            this.state.longBreakCountToday = (this.state.longBreakCountToday ?? 0) + 1;
        }
        this.stateChanged = true;
        this.emit('breakDue', breakType);
        this.startPhase(breakType);
    }
    /**
     * Advance to the next phase when current phase completes
     */
    advancePhase() {
        const prevPhase = this.state.currentPhase;
        const prevIndex = this.state.currentFlowStepIndex;
        // Handle flow-based mode
        if ((0, flowUtils_1.isFlowBasedSchedule)(this.currentSchedule)) {
            this.advanceFlowBasedPhase(prevPhase);
        }
        else {
            // Rule-based mode (existing behavior)
            this.advanceRuleBasedPhase(prevPhase);
        }
        // Phase 1.5: Log phase transition
        (0, sessionDebug_1.logSessionEvent)({
            event: 'phaseTransition',
            fromPhase: prevPhase,
            toPhase: this.state.currentPhase,
            indexBefore: prevIndex,
            indexAfter: this.state.currentFlowStepIndex,
            next: this.getNextPhase(),
            cumulativeWorkMs: this.state.cumulativeWorkTimeMs,
            scheduleId: this.currentSchedule?.id,
        });
    }
    /**
     * Advance phase in flow-based mode
     *
     * Uses transition model for computing next phase to ensure consistency.
     * INVARIANT: After this method, currentPhase MUST match flowSteps[currentFlowStepIndex].type
     *
     * PHASE 1.5: Uses getRuntimeFlowSteps() to use frozen snapshot, not live config
     */
    advanceFlowBasedPhase(prevPhase) {
        // PHASE 1.5: Use runtime flow snapshot instead of live config
        const flowSteps = this.getRuntimeFlowSteps();
        if (!flowSteps || flowSteps.length === 0) {
            this.advanceRuleBasedPhase(prevPhase);
            return;
        }
        // Handle long break completion (long break is still rule-based interrupt)
        if (prevPhase === 'long-break') {
            this.state.lastLongBreakAtWorkTimeMs = this.state.cumulativeWorkTimeMs;
            // Phase 1.5: Log break end
            (0, sessionDebug_1.logSessionEvent)({
                event: 'breakEnd',
                phase: prevPhase,
                cumulativeWorkMs: this.state.cumulativeWorkTimeMs,
                scheduleId: this.currentSchedule?.id,
            });
            // Use transition model: after long break, restart from first step
            const result = (0, transitions_1.computeNextFlowPhase)(0, flowSteps, true /* isAfterLongBreak */);
            this.state.currentFlowStepIndex = result.nextIndex;
            this.startPhase(result.nextPhase);
            return;
        }
        // Track short break completion for cumulative time tracking
        if (prevPhase === 'short-break') {
            this.state.lastShortBreakAtWorkTimeMs = this.state.cumulativeWorkTimeMs;
            // Phase 1.5: Log break end
            (0, sessionDebug_1.logSessionEvent)({
                event: 'breakEnd',
                phase: prevPhase,
                cumulativeWorkMs: this.state.cumulativeWorkTimeMs,
                scheduleId: this.currentSchedule?.id,
            });
        }
        // Get current index, validating it's within bounds
        let currentIndex = this.state.currentFlowStepIndex ?? 0;
        // Validate and resync if needed
        if (!(0, transitions_1.isValidFlowIndex)(currentIndex, flowSteps)) {
            logger_1.default.warn('TimerEngine', 'advanceFlowBasedPhase: invalid index, resyncing', {
                currentIndex,
                flowLength: flowSteps.length,
            });
            // Find correct index for current phase
            const correctIndex = (0, transitions_1.findPhaseIndex)(flowSteps, prevPhase);
            currentIndex = correctIndex !== -1 ? correctIndex : 0;
            this.state.currentFlowStepIndex = currentIndex;
        }
        // Check for phase-index desync (skip for short-break which is in flow)
        const expectedPhaseAtIndex = flowSteps[currentIndex]?.type;
        if (expectedPhaseAtIndex !== prevPhase && prevPhase !== 'short-break') {
            logger_1.default.warn('TimerEngine', 'Flow index desync detected', {
                prevPhase,
                currentIndex,
                expectedPhaseAtIndex,
            });
            // Try to find correct index
            const correctIndex = (0, transitions_1.findPhaseIndex)(flowSteps, prevPhase);
            if (correctIndex !== -1) {
                currentIndex = correctIndex;
                this.state.currentFlowStepIndex = currentIndex;
                logger_1.default.info('TimerEngine', 'Resynced to correct index', { correctIndex });
            }
        }
        // Use transition model to compute next phase
        let result = (0, transitions_1.computeNextFlowPhase)(currentIndex, flowSteps, false);
        // BREAK CONFLICT RESOLUTION: Skip break steps if a pending break exists
        // This prevents stacking breaks when flow reaches a break step while
        // a postponed break is pending
        if ((0, breakConflict_1.isBreakPhase)(result.nextPhase)) {
            const pendingBreak = this.state.isPostponed && this.state.postponedPhase
                ? ((0, breakConflict_1.isBreakPhase)(this.state.postponedPhase) ? this.state.postponedPhase : null)
                : null;
            if (pendingBreak) {
                const skipCheck = (0, breakConflict_1.shouldSkipFlowBreakStep)(pendingBreak, result.nextPhase);
                if (skipCheck.skip) {
                    logger_1.default.info('TimerEngine', 'Skipping flow break step due to pending break', {
                        flowBreakStep: result.nextPhase,
                        pendingBreak,
                        reason: skipCheck.reason,
                    });
                    // Skip to the next non-break step
                    let skipIndex = result.nextIndex;
                    let attempts = 0;
                    const maxAttempts = flowSteps.length;
                    while (attempts < maxAttempts) {
                        const nextResult = (0, transitions_1.computeNextFlowPhase)(skipIndex, flowSteps, false);
                        skipIndex = nextResult.nextIndex;
                        if (!(0, breakConflict_1.isBreakPhase)(nextResult.nextPhase)) {
                            // Found a non-break step
                            result = nextResult;
                            logger_1.default.info('TimerEngine', 'Found next work step after skipping break', {
                                newIndex: result.nextIndex,
                                newPhase: result.nextPhase,
                            });
                            break;
                        }
                        attempts++;
                    }
                    if (attempts >= maxAttempts) {
                        // All steps are breaks (shouldn't happen), just proceed
                        logger_1.default.warn('TimerEngine', 'Could not find non-break step, proceeding with break');
                    }
                }
            }
        }
        this.state.currentFlowStepIndex = result.nextIndex;
        logger_1.default.info('TimerEngine', 'advanceFlowBasedPhase - advancing', {
            prevPhase,
            fromIndex: currentIndex,
            toIndex: result.nextIndex,
            newPhase: result.nextPhase,
        });
        this.startPhase(result.nextPhase);
    }
    /**
     * Advance phase in rule-based mode
     * Uses transition model for computing next phase
     */
    advanceRuleBasedPhase(prevPhase) {
        // Track break completion for cumulative time tracking
        if (prevPhase === 'short-break') {
            this.state.lastShortBreakAtWorkTimeMs = this.state.cumulativeWorkTimeMs;
        }
        else if (prevPhase === 'long-break') {
            this.state.lastLongBreakAtWorkTimeMs = this.state.cumulativeWorkTimeMs;
        }
        // Use transition model to compute next phase
        const nextPhase = (0, transitions_1.computeNextRuleBasedPhase)(prevPhase, this.preBreakPhase);
        // Clear pre-break phase after breaks
        if ((0, transitions_1.isBreakPhase)(prevPhase)) {
            this.preBreakPhase = null;
        }
        this.startPhase(nextPhase);
    }
    /**
     * Start a specific phase
     *
     * BREAK CONFLICT POLICY:
     * When entering a break phase, check if pending break should be cleared
     * to prevent conflicting break states (active + pending of same type)
     */
    startPhase(phase) {
        const prevPhase = this.state.currentPhase;
        const now = Date.now();
        const duration = this.getPhaseDurationMs(phase);
        // BREAK CONFLICT RESOLUTION: Clear pending break when entering a break phase
        // This prevents the "active break + same-type pending break" conflict
        if ((0, breakConflict_1.isBreakPhase)(phase) && this.state.isPostponed && this.state.postponedPhase) {
            const pendingBreak = (0, breakConflict_1.isBreakPhase)(this.state.postponedPhase)
                ? this.state.postponedPhase
                : null;
            if (pendingBreak) {
                const clearCheck = (0, breakConflict_1.shouldClearPendingOnBreakEntry)(pendingBreak, phase);
                if (clearCheck.clear) {
                    logger_1.default.info('TimerEngine', 'Clearing pending break on break entry', {
                        enteringPhase: phase,
                        pendingBreak,
                        reason: clearCheck.reason,
                    });
                    this.state.isPostponed = false;
                    this.state.postponedPhase = null;
                    this.state.postponedUntil = null;
                    this.state.postponedBreakType = null;
                }
                else {
                    logger_1.default.info('TimerEngine', 'Keeping pending break on break entry', {
                        enteringPhase: phase,
                        pendingBreak,
                        reason: clearCheck.reason,
                    });
                }
            }
        }
        this.state.currentPhase = phase;
        this.state.phaseStartedAt = now;
        this.state.phaseEndsAt = now + duration;
        this.state.phaseRemainingMs = duration;
        this.state.phaseTotalMs = duration;
        logger_1.default.info('TimerEngine', `Phase started: ${phase}`, {
            duration,
            endsAt: this.state.phaseEndsAt,
        });
        this.emit('phaseChange', { prevPhase, newPhase: phase });
        this.saveStateImmediately(); // Save immediately on phase change
    }
    /**
     * Get duration for a phase in milliseconds
     * Uses new nested config with fallback to legacy fields
     */
    getPhaseDurationMs(phase) {
        if (!this.currentSchedule)
            return 0;
        const schedule = this.currentSchedule;
        // Flow-based mode: get duration from current flow step (except for long-break)
        if ((0, flowUtils_1.isFlowBasedSchedule)(schedule) && phase !== 'long-break') {
            const flowSteps = schedule.flowSteps;
            const currentIndex = this.state.currentFlowStepIndex ?? 0;
            const currentStep = flowSteps[currentIndex];
            if (currentStep && currentStep.type === phase) {
                return (0, flowUtils_1.getFlowStepDurationMs)(currentStep);
            }
        }
        // Rule-based mode or long-break (always rule-based)
        switch (phase) {
            case 'sit':
                return (0, timeUtils_1.minutesToMs)(schedule.sitMinutes);
            case 'stand':
                return (0, timeUtils_1.minutesToMs)(schedule.standMinutes);
            case 'sit-to-stand-transition':
                return (0, timeUtils_1.secondsToMs)(schedule.transitions?.sitToStand?.durationSeconds ??
                    schedule.sitToStandTransitionSeconds ??
                    60);
            case 'stand-to-sit-transition':
                return (0, timeUtils_1.secondsToMs)(schedule.transitions?.standToSit?.durationSeconds ??
                    schedule.standToSitTransitionSeconds ??
                    60);
            case 'short-break':
                return (0, timeUtils_1.minutesToMs)(schedule.shortBreak?.durationMinutes ??
                    schedule.shortBreakDurationMinutes ??
                    5);
            case 'long-break':
                return (0, timeUtils_1.minutesToMs)(schedule.longBreak?.durationMinutes ??
                    schedule.longBreakDurationMinutes ??
                    15);
            default:
                return 0;
        }
    }
    /**
     * Get duration for a specific phase (not necessarily current phase)
     * Used for tooltip display of next/then phase durations
     */
    getPhaseDurationMsForPhase(phase) {
        if (!this.currentSchedule || phase === 'idle')
            return 0;
        const schedule = this.currentSchedule;
        // For flow-based, we need to look ahead in flow steps
        if ((0, flowUtils_1.isFlowBasedSchedule)(schedule) && phase !== 'long-break') {
            const flowSteps = schedule.flowSteps;
            // Find the next occurrence of this phase type in flow
            const currentIndex = this.state.currentFlowStepIndex ?? 0;
            for (let i = currentIndex; i < flowSteps.length + currentIndex; i++) {
                const step = flowSteps[i % flowSteps.length];
                if (step.type === phase) {
                    return (0, flowUtils_1.getFlowStepDurationMs)(step);
                }
            }
        }
        // Rule-based mode durations
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
    /**
     * Get the phase that comes after nextPhase (for tooltip "then" display)
     *
     * INVARIANT 7: then is ALWAYS derived from session state, never stored
     */
    getThenPhase(nextPhase) {
        if (!this.currentSchedule || nextPhase === 'idle')
            return 'idle';
        const schedule = this.currentSchedule;
        // Flow-based mode: use transition model
        if ((0, flowUtils_1.isFlowBasedSchedule)(schedule)) {
            const flowSteps = schedule.flowSteps;
            const currentIndex = this.state.currentFlowStepIndex ?? 0;
            const result = (0, transitions_1.computeThenFlowPhase)(currentIndex, flowSteps);
            return result.nextPhase;
        }
        // Rule-based mode: use transition model
        return (0, transitions_1.computeThenRuleBasedPhase)(nextPhase);
    }
    /**
     * Check if phase counts as active work time (sit/stand only)
     */
    isWorkPhase(phase) {
        return phase === 'sit' || phase === 'stand';
    }
    /**
     * Check if phase should count toward cumulative work time for long break triggers
     * Sit/Stand always count. Transitions and short breaks are configurable.
     * Long breaks never count (they reset the counter)
     */
    countsToCumulativeWorkTime(phase) {
        if (phase === 'long-break' || phase === 'idle')
            return false;
        if (phase === 'sit' || phase === 'stand')
            return true;
        const schedule = this.currentSchedule;
        if (!schedule)
            return false;
        // Check if transitions count
        if (phase === 'sit-to-stand-transition' || phase === 'stand-to-sit-transition') {
            return schedule.transitionsCountAsCumulativeWork ?? true;
        }
        // Check if short breaks count
        if (phase === 'short-break') {
            return schedule.shortBreaksCountAsCumulativeWork ?? true;
        }
        return false;
    }
    /**
     * Set idle state when no schedule is active
     */
    setIdleState() {
        this.state.activeScheduleId = null;
        this.state.currentPhase = 'idle';
        this.state.phaseStartedAt = 0;
        this.state.phaseEndsAt = 0;
        this.state.phaseRemainingMs = 0;
        this.state.phaseTotalMs = 0;
    }
    /**
     * Get the next phase after current (for display purposes)
     *
     * INVARIANT 7: next is ALWAYS derived from session state, never stored
     * PHASE 1.5: Uses runtime flow snapshot, not live config
     */
    getNextPhase() {
        if (!this.currentSchedule)
            return 'idle';
        // Flow-based mode: use transition model with runtime snapshot
        if ((0, flowUtils_1.isFlowBasedSchedule)(this.currentSchedule)) {
            // PHASE 1.5: Use runtime flow snapshot instead of live config
            const flowSteps = this.getRuntimeFlowSteps();
            if (!flowSteps || flowSteps.length === 0) {
                return (0, transitions_1.computeNextRuleBasedPhase)(this.state.currentPhase, this.preBreakPhase);
            }
            // If currently in long break (rule-based interrupt), next is first step
            if (this.state.currentPhase === 'long-break') {
                return flowSteps[0].type;
            }
            const currentIndex = this.state.currentFlowStepIndex ?? 0;
            const result = (0, transitions_1.computeNextFlowPhase)(currentIndex, flowSteps, false);
            return result.nextPhase;
        }
        // Rule-based mode: use transition model
        return (0, transitions_1.computeNextRuleBasedPhase)(this.state.currentPhase, this.preBreakPhase);
    }
    /**
     * Pause the timer
     */
    pause() {
        if (this.state.isPaused)
            return;
        this.state.isPaused = true;
        this.state.pausedAt = Date.now();
        this.state.pauseResumeAt = null;
        this.saveState();
    }
    /**
     * Pause for a specific duration in minutes
     */
    pauseForDuration(minutes) {
        if (this.state.isPaused)
            return;
        this.state.isPaused = true;
        this.state.pausedAt = Date.now();
        this.state.pauseResumeAt = Date.now() + (0, timeUtils_1.minutesToMs)(minutes);
        this.saveState();
    }
    /**
     * Resume from pause
     */
    resume() {
        if (!this.state.isPaused)
            return;
        this.state.isPaused = false;
        this.state.pausedAt = null;
        this.state.pauseResumeAt = null;
        this.saveState();
    }
    /**
     * Postpone current phase (break)
     *
     * CRITICAL BEHAVIOR:
     * When a break is postponed, work CONTINUES - the break does NOT become active.
     * The break is stored as "pending" and will re-trigger after the postpone duration.
     *
     * State changes:
     * - currentPhase -> restored to pre-break work phase
     * - postponedPhase -> the break that was postponed (pending)
     * - isPostponed -> true (indicates a pending break exists)
     * - postponedUntil -> when the pending break should trigger
     */
    postpone(minutes) {
        if (!this.currentSchedule)
            return false;
        // ARCHITECTURE HARDENING: Pre-transition validation
        const precondCheck = this.canPerformTransition('postpone');
        if (!precondCheck.allowed) {
            logger_1.default.debug('TimerEngine', 'Postpone blocked by precondition', { reason: precondCheck.reason });
            return false;
        }
        const breakType = (0, overlayPolicy_1.phaseToBreakType)(this.state.currentPhase);
        if (!breakType)
            return false; // Can only postpone breaks/transitions
        // Check if postpone is allowed for this break type
        const allowPostpone = this.isPostponeAllowedForBreakType(breakType);
        if (!allowPostpone)
            return false;
        // Check per-break-type limit
        const maxPostpones = (0, overlayPolicy_1.getMaxPostponesForBreakType)(this.currentSchedule, breakType);
        const currentCount = this.state.postponeCountsToday[breakType];
        if (currentCount >= maxPostpones)
            return false;
        // Store the pending break
        const postponedBreakPhase = this.state.currentPhase;
        this.state.postponedPhase = postponedBreakPhase;
        this.state.postponedBreakType = breakType;
        this.state.isPostponed = true;
        this.state.postponedUntil = Date.now() + (0, timeUtils_1.minutesToMs)(minutes);
        this.state.postponeCountsToday[breakType]++;
        // CRITICAL FIX: Restore work phase - do NOT keep break as current phase
        // Use preBreakPhase (set when break was triggered) or interruptedPhase
        const workPhaseToRestore = this.preBreakPhase || this.state.interruptedPhase || 'sit';
        const workPhaseRemainingMs = this.state.interruptedPhaseRemainingMs || this.getPhaseDurationMs(workPhaseToRestore);
        // PHASE 1.5 FIX: Also restore the flow index to match the work phase
        const flowIndexToRestore = this.state.interruptedFlowIndex;
        // Save what work phase we're restoring (for after postponed break completes)
        this.state.prePostponeWorkPhase = workPhaseToRestore;
        this.state.prePostponeWorkPhaseRemainingMs = workPhaseRemainingMs;
        this.state.prePostponeFlowIndex = flowIndexToRestore;
        // Restore work phase as current phase
        this.state.currentPhase = workPhaseToRestore;
        this.state.phaseRemainingMs = workPhaseRemainingMs;
        this.state.phaseTotalMs = this.getPhaseDurationMs(workPhaseToRestore);
        this.state.phaseStartedAt = Date.now();
        this.state.phaseEndsAt = Date.now() + workPhaseRemainingMs;
        // PHASE 1.5 FIX: Restore flow index to match restored work phase
        // This ensures currentPhase and currentFlowStepIndex are consistent
        if ((0, flowUtils_1.isFlowBasedSchedule)(this.currentSchedule) && flowIndexToRestore !== undefined) {
            this.state.currentFlowStepIndex = flowIndexToRestore;
        }
        // Phase 1.5: Structured postpone logging
        (0, sessionDebug_1.logSessionEvent)({
            event: 'postponeBreak',
            phase: workPhaseToRestore,
            pendingBreak: postponedBreakPhase,
            postponeUntil: this.state.postponedUntil,
            cumulativeWorkMs: this.state.cumulativeWorkTimeMs,
            scheduleId: this.currentSchedule?.id,
            restoredFlowIndex: flowIndexToRestore,
        });
        // Phase 5: Trace logging
        traceLogger_1.trace.postpone(postponedBreakPhase, minutes);
        // ARCHITECTURE HARDENING: Post-transition invariant validation
        this.validateStateInvariants('After postpone');
        // Validate postpone state safety
        const nextPhase = this.getNextPhase();
        const validation = (0, sessionDebug_1.validateRuntimeState)(this.state, this.currentSchedule, nextPhase);
        if (!validation.valid) {
            (0, sessionDebug_1.logSessionEvent)({
                event: 'validationError',
                reason: 'Invalid state after postpone',
                phase: this.state.currentPhase,
                pendingBreak: this.state.postponedPhase,
            });
        }
        this.saveState();
        // Emit event so main process can close overlay
        this.emit('postponed', { minutes, phase: postponedBreakPhase, breakType });
        return true;
    }
    /**
     * Check if postpone is allowed for a break type
     * NOTE: Postpone is only allowed for breaks, NOT for transitions
     */
    isPostponeAllowedForBreakType(breakType) {
        if (!this.currentSchedule)
            return false;
        const schedule = this.currentSchedule;
        switch (breakType) {
            case 'sitToStandTransition':
            case 'standToSitTransition':
                // Transitions cannot be postponed - only breaks can
                return false;
            case 'shortBreak':
                return schedule.shortBreak?.allowPostpone ?? schedule.allowPostpone ?? false;
            case 'longBreak':
                return schedule.longBreak?.allowPostpone ?? schedule.allowPostpone ?? false;
            default:
                return false;
        }
    }
    /**
     * Skip the current phase (if allowed)
     *
     * SKIP SEMANTICS:
     * - Rule-based: advances to next phase in sit→trans→stand→trans cycle
     * - Flow-based: advances currentFlowStepIndex and updates currentPhase to match
     * - Breaks: advances out of break, resumes work or continues flow
     *
     * SKIP SAFETY (Phase 1.5):
     * 1. Advance flow index by exactly one step
     * 2. Normalize index using normalizeFlowIndex
     * 3. Update currentPhase
     * 4. Recompute next and then
     * 5. Emit state update
     *
     * INVARIANT: After skip, currentPhase MUST match flowSteps[currentFlowStepIndex] (in flow mode)
     */
    skipPhase() {
        if (!this.currentSchedule)
            return;
        if (this.currentSchedule.noSkipEnabled)
            return;
        // ARCHITECTURE HARDENING: Pre-transition validation
        const precondCheck = this.canPerformTransition('skip');
        if (!precondCheck.allowed) {
            logger_1.default.debug('TimerEngine', 'Skip blocked by precondition', { reason: precondCheck.reason });
            return;
        }
        const indexBefore = this.state.currentFlowStepIndex;
        const phaseBefore = this.state.currentPhase;
        // For flow-based mode, ensure index is synced before advancing
        if ((0, flowUtils_1.isFlowBasedSchedule)(this.currentSchedule)) {
            // PHASE 1.5: Use runtime flow snapshot instead of live config
            const flowSteps = this.getRuntimeFlowSteps();
            if (flowSteps && flowSteps.length > 0) {
                // Normalize index before skip
                const normalizedIndex = (0, sessionDebug_1.normalizeFlowIndex)(indexBefore, flowSteps.length);
                if (normalizedIndex !== indexBefore) {
                    this.state.currentFlowStepIndex = normalizedIndex;
                }
            }
        }
        // Advance phase
        this.advancePhase();
        // Get new state after advance
        const indexAfter = this.state.currentFlowStepIndex;
        const nextPhase = this.getNextPhase();
        // Log skip event with structured format
        (0, sessionDebug_1.logSessionEvent)({
            event: 'skipPhase',
            phase: this.state.currentPhase,
            fromPhase: phaseBefore,
            indexBefore,
            indexAfter,
            next: nextPhase,
            scheduleId: this.currentSchedule?.id,
        });
        // Phase 5: Trace logging
        traceLogger_1.trace.skip(phaseBefore, this.state.currentPhase);
        // Validate and recover if needed (flow mode)
        if ((0, flowUtils_1.isFlowBasedSchedule)(this.currentSchedule)) {
            const validation = (0, sessionDebug_1.validateRuntimeState)(this.state, this.currentSchedule, nextPhase);
            if (!validation.valid) {
                const recovery = (0, sessionDebug_1.attemptSafeRecovery)(this.state, this.currentSchedule);
                if (recovery.recovered && recovery.newIndex !== undefined) {
                    this.state.currentFlowStepIndex = recovery.newIndex;
                }
            }
        }
        // Emit tick immediately after skip to update UI
        this.emitTick();
    }
    /**
     * Complete current phase (user acknowledges they're done)
     */
    completePhase() {
        this.advancePhase();
    }
    /**
     * Reset the active session completely
     * Restarts from the beginning without changing schedule configuration
     *
     * RESET SEMANTICS (Invariant 6):
     * - After reset: currentPhase is first work phase (sit or stand)
     * - After reset: all postpone/pause/interrupted state is cleared
     * - After reset: cumulative work time is 0
     * - Reset does NOT mutate saved schedule config
     *
     * Does NOT reset:
     * - Postpone counts today (use resetTodayCounters for that)
     * - Schedule configuration
     */
    resetSession() {
        if (!this.currentSchedule) {
            logger_1.default.warn('TimerEngine', 'Cannot reset session - no active schedule');
            return;
        }
        // ARCHITECTURE HARDENING: Pre-transition validation
        const precondCheck = this.canPerformTransition('reset');
        if (!precondCheck.allowed) {
            logger_1.default.warn('TimerEngine', 'Reset blocked by precondition', { reason: precondCheck.reason });
            return;
        }
        (0, transitions_1.logTransition)(transitions_1.TransitionType.RESET_REQUESTED, {
            scheduleName: this.currentSchedule.name,
            currentPhase: this.state.currentPhase,
            scheduleMode: this.currentSchedule.mode,
        });
        // Phase 5: Trace logging
        traceLogger_1.trace.reset(`session reset: ${this.currentSchedule.name}`);
        // Reload schedule from config to restore original flow order
        // (shuffle/reverse may have modified the in-memory flowSteps)
        const schedules = configService_1.default.getSchedules();
        const originalSchedule = schedules.find(s => s.id === this.currentSchedule.id);
        if (originalSchedule) {
            this.currentSchedule = originalSchedule;
        }
        const now = Date.now();
        // Use transition model to compute clean reset state
        const resetState = (0, transitions_1.computeResetState)(this.currentSchedule);
        // Apply reset state
        this.state.currentPhase = resetState.currentPhase;
        this.state.currentFlowStepIndex = resetState.currentFlowStepIndex;
        this.state.phaseStartedAt = now;
        this.state.phaseEndsAt = now + resetState.phaseDurationMs;
        this.state.phaseRemainingMs = resetState.phaseDurationMs;
        this.state.phaseTotalMs = resetState.phaseDurationMs;
        // Update flow config hash for flow-based schedules
        if ((0, flowUtils_1.isFlowBasedSchedule)(this.currentSchedule)) {
            this.state.flowConfigHash = (0, types_1.computeFlowConfigHash)(this.currentSchedule.flowSteps);
            // PHASE 1.5: Re-freeze flow snapshot from fresh config
            this.freezeFlowSnapshot();
        }
        else {
            this.state.flowConfigHash = undefined;
            this.runtimeFlowSnapshot = null;
        }
        // Reset cumulative work time
        this.state.cumulativeWorkTimeMs = 0;
        // Reset break tracking - all breaks start fresh
        this.state.lastShortBreakAtWorkTimeMs = 0;
        this.state.lastLongBreakAtWorkTimeMs = 0;
        // Clear interrupted phase and flow index
        this.state.interruptedPhase = null;
        this.state.interruptedPhaseRemainingMs = 0;
        this.state.interruptedFlowIndex = undefined;
        // Clear postponed state (Invariant 3)
        this.state.isPostponed = false;
        this.state.postponedUntil = null;
        this.state.postponedPhase = null;
        this.state.postponedBreakType = null;
        this.state.prePostponeWorkPhase = null;
        this.state.prePostponeWorkPhaseRemainingMs = 0;
        this.state.prePostponeFlowIndex = undefined;
        // Clear paused state (Invariant 4)
        this.state.isPaused = false;
        this.state.pausedAt = null;
        this.state.pauseResumeAt = null;
        // Clear pre-break tracking
        this.preBreakPhase = null;
        // Update tick time
        this.lastTickTime = now;
        // ARCHITECTURE HARDENING: Post-transition invariant validation
        this.validateStateInvariants('After reset');
        // Validate reset state
        const validation = (0, sessionValidator_1.validateSessionState)(this.state, this.currentSchedule);
        if (!validation.valid) {
            (0, sessionValidator_1.logValidationResult)(validation, 'Reset Session - validation failed');
        }
        // Save state and emit tick
        this.saveState();
        this.emitTick();
        // Emit session reset event for sound and other handlers
        this.emit('sessionReset');
        // Phase 1.5: Structured reset logging
        (0, sessionDebug_1.logSessionEvent)({
            event: 'resetSession',
            phase: resetState.currentPhase,
            index: resetState.currentFlowStepIndex,
            cumulativeWorkMs: 0,
            pendingBreak: null,
            postponeUntil: null,
            scheduleId: this.currentSchedule?.id,
        });
    }
    /**
     * Reset today's counters without affecting current phase
     *
     * Resets:
     * - Cumulative work time today
     * - Postpone counts today
     *
     * Does NOT reset:
     * - Current phase or phase progress
     * - Work time toward breaks (those are relative to cumulative work time)
     */
    resetTodayCounters() {
        logger_1.default.info('TimerEngine', 'Resetting today\'s counters');
        const today = (0, timeUtils_1.getTodayDateString)();
        // Reset cumulative work time
        this.state.cumulativeWorkTimeMs = 0;
        // Reset break tracking markers to 0 (since cumulative work time is now 0)
        this.state.lastShortBreakAtWorkTimeMs = 0;
        this.state.lastLongBreakAtWorkTimeMs = 0;
        // Reset postpone counts
        this.state.postponeCountsToday = { ...types_1.INITIAL_POSTPONE_COUNTS };
        this.state.postponeResetDate = today;
        // Reset break counts
        this.state.shortBreakCountToday = 0;
        this.state.longBreakCountToday = 0;
        this.state.breakCountResetDate = today;
        // Save state and emit tick
        this.saveState();
        this.emitTick();
        logger_1.default.info('TimerEngine', 'Today\'s counters reset complete');
    }
    /**
     * Shuffle flow steps - toggle between Sit-first and Stand-first order.
     * Break always stays at the end.
     *
     * Normal order: Sit → sit-to-stand trans → Stand → stand-to-sit trans → Break
     * Shuffled:     Stand → stand-to-sit trans → Sit → sit-to-stand trans → Break
     *
     * If flow is messed up (e.g., break first), restores to normal Sit-first order.
     *
     * Saves to config file - user must click "Reset Now" to apply
     */
    shuffleFlow() {
        if (!this.currentSchedule || !(0, flowUtils_1.isFlowBasedSchedule)(this.currentSchedule)) {
            logger_1.default.warn('TimerEngine', 'Cannot shuffle - no flow-based schedule active');
            return { success: false, message: 'No flow-based schedule active' };
        }
        const flowSteps = this.currentSchedule.flowSteps;
        if (flowSteps.length < 4) {
            logger_1.default.warn('TimerEngine', 'Cannot shuffle - need at least 4 flow steps');
            return { success: false, message: 'Need at least 4 flow steps to shuffle' };
        }
        // Find work phases and breaks
        const sitStep = flowSteps.find(s => s.type === 'sit');
        const standStep = flowSteps.find(s => s.type === 'stand');
        const sitToStandTrans = flowSteps.find(s => s.type === 'sit-to-stand-transition');
        const standToSitTrans = flowSteps.find(s => s.type === 'stand-to-sit-transition');
        const breaks = flowSteps.filter(s => s.type === 'short-break');
        if (!sitStep || !standStep || !sitToStandTrans || !standToSitTrans) {
            logger_1.default.warn('TimerEngine', 'Cannot shuffle - missing required work phases');
            return { success: false, message: 'Missing required work phases (sit, stand, transitions)' };
        }
        const firstStep = flowSteps[0];
        let newSteps;
        let message;
        if (firstStep.type === 'sit') {
            // Currently Sit-first → change to Stand-first
            newSteps = [standStep, standToSitTrans, sitStep, sitToStandTrans, ...breaks];
            message = 'Flow shuffled to Stand-first! Click Reset Now to apply.';
            logger_1.default.info('TimerEngine', 'Shuffling: Sit-first → Stand-first');
        }
        else if (firstStep.type === 'stand') {
            // Currently Stand-first → change to Sit-first
            newSteps = [sitStep, sitToStandTrans, standStep, standToSitTrans, ...breaks];
            message = 'Flow shuffled to Sit-first! Click Reset Now to apply.';
            logger_1.default.info('TimerEngine', 'Shuffling: Stand-first → Sit-first');
        }
        else {
            // Flow is messed up (break or transition first) → restore to normal Sit-first
            newSteps = [sitStep, sitToStandTrans, standStep, standToSitTrans, ...breaks];
            message = 'Flow restored to normal (Sit-first)! Click Reset Now to apply.';
            logger_1.default.info('TimerEngine', 'Shuffling: Restoring to normal Sit-first order');
        }
        // Save to config file - this will trigger flow stale detection
        const updatedSchedule = { ...this.currentSchedule, flowSteps: newSteps };
        configService_1.default.saveSchedule(updatedSchedule);
        // Update in-memory schedule reference so tick shows updated state
        this.currentSchedule = updatedSchedule;
        // Emit schedule change event so UI updates
        this.emit('scheduleChange', updatedSchedule);
        // Emit tick so UI updates and shows "Flow Updated" banner
        this.emitTick();
        logger_1.default.info('TimerEngine', 'Flow shuffled in config', {
            newOrder: newSteps.map(s => s.type).join(' → ')
        });
        return { success: true, message };
    }
    /**
     * Reverse flow steps - true reversal, last step becomes first.
     *
     * Example: sit → trans → stand → trans → break
     * After reverse: break → trans → stand → trans → sit
     *
     * Saves to config file - user must click "Reset Now" to apply
     */
    reverseFlow() {
        if (!this.currentSchedule || !(0, flowUtils_1.isFlowBasedSchedule)(this.currentSchedule)) {
            logger_1.default.warn('TimerEngine', 'Cannot reverse - no flow-based schedule active');
            return { success: false, message: 'No flow-based schedule active' };
        }
        const flowSteps = this.currentSchedule.flowSteps;
        if (flowSteps.length < 2) {
            logger_1.default.warn('TimerEngine', 'Cannot reverse - need at least 2 flow steps');
            return { success: false, message: 'Need at least 2 flow steps to reverse' };
        }
        logger_1.default.info('TimerEngine', 'Reversing flow steps - saving to config');
        // True reversal - last becomes first, even if it's a break
        const newSteps = [...flowSteps].reverse();
        // Save to config file - this will trigger flow stale detection
        const updatedSchedule = { ...this.currentSchedule, flowSteps: newSteps };
        configService_1.default.saveSchedule(updatedSchedule);
        // Update in-memory schedule reference so tick shows updated state
        this.currentSchedule = updatedSchedule;
        // Emit schedule change event so UI updates
        this.emit('scheduleChange', updatedSchedule);
        // Emit tick so UI updates and shows "Flow Updated" banner
        this.emitTick();
        logger_1.default.info('TimerEngine', 'Flow reversed in config - user should click Reset Now to apply', {
            newOrder: newSteps.map(s => s.type).join(' → ')
        });
        return { success: true, message: 'Flow reversed! Click Reset Now to apply.' };
    }
    /**
     * Called when a schedule is updated externally (e.g., via settings UI).
     * Updates the in-memory schedule reference if it's the active schedule,
     * which allows isFlowSessionStale() to detect changes.
     */
    onScheduleUpdated(schedule) {
        if (!this.currentSchedule)
            return;
        // Only update if this is the active schedule
        if (this.currentSchedule.id !== schedule.id)
            return;
        logger_1.default.info('TimerEngine', 'Active schedule updated externally', {
            scheduleId: schedule.id,
            scheduleName: schedule.name,
        });
        // Update the in-memory reference
        this.currentSchedule = schedule;
        // Emit events so UI updates
        this.emit('scheduleChange', schedule);
        this.emitTick();
    }
    /**
     * Calculate break progress information
     */
    calculateBreakProgress() {
        const schedule = this.currentSchedule;
        const workTimeMs = this.state.cumulativeWorkTimeMs;
        // In flow-based mode, calculate short break timing from flow cycle
        let shortBreakEveryMinutes = schedule?.shortBreak?.everyMinutes ?? schedule?.shortBreakEveryMinutes ?? 60;
        let shortBreakDurationMinutes = schedule?.shortBreak?.durationMinutes ?? schedule?.shortBreakDurationMinutes ?? 5;
        let shortBreakEnabled = schedule?.shortBreak?.enabled ?? schedule?.shortBreakEnabled ?? false;
        if (schedule && (0, flowUtils_1.isFlowBasedSchedule)(schedule)) {
            const flowSteps = schedule.flowSteps;
            // In flow mode, short breaks are part of the flow
            // Calculate total cycle time (all steps including short break)
            let totalCycleSeconds = 0;
            let hasShortBreak = false;
            for (const step of flowSteps) {
                totalCycleSeconds += step.durationSeconds;
                if (step.type === 'short-break') {
                    hasShortBreak = true;
                    shortBreakDurationMinutes = Math.round(step.durationSeconds / 60);
                }
            }
            // Short break "every" is the total cycle time minus the break duration
            // (time between short breaks)
            if (hasShortBreak) {
                shortBreakEnabled = true;
                const cycleMinutes = Math.round(totalCycleSeconds / 60);
                shortBreakEveryMinutes = cycleMinutes - shortBreakDurationMinutes;
            }
            else {
                shortBreakEnabled = false;
            }
        }
        const shortBreakThresholdMs = (0, timeUtils_1.minutesToMs)(shortBreakEveryMinutes);
        // Long break settings
        const longBreakEnabled = schedule?.longBreak?.enabled ?? schedule?.longBreakEnabled ?? false;
        const longBreakEveryMinutes = schedule?.longBreak?.everyMinutes ?? schedule?.longBreakEveryMinutes ?? 150;
        const longBreakDurationMinutes = schedule?.longBreak?.durationMinutes ?? schedule?.longBreakDurationMinutes ?? 15;
        const longBreakThresholdMs = (0, timeUtils_1.minutesToMs)(longBreakEveryMinutes);
        // Calculate time since last breaks
        const workTimeSinceShortBreakMs = workTimeMs - this.state.lastShortBreakAtWorkTimeMs;
        const workTimeSinceLongBreakMs = workTimeMs - this.state.lastLongBreakAtWorkTimeMs;
        // Calculate time until next breaks
        const msUntilNextShortBreak = shortBreakEnabled
            ? Math.max(0, shortBreakThresholdMs - workTimeSinceShortBreakMs)
            : Infinity;
        const msUntilNextLongBreak = longBreakEnabled
            ? Math.max(0, longBreakThresholdMs - workTimeSinceLongBreakMs)
            : Infinity;
        // Calculate progress (0-1)
        const shortBreakProgress = shortBreakEnabled && shortBreakThresholdMs > 0
            ? Math.min(1, workTimeSinceShortBreakMs / shortBreakThresholdMs)
            : 0;
        const longBreakProgress = longBreakEnabled && longBreakThresholdMs > 0
            ? Math.min(1, workTimeSinceLongBreakMs / longBreakThresholdMs)
            : 0;
        // Determine which break comes next
        let nextBreakType = null;
        let nextBreakInMs = Infinity;
        if (shortBreakEnabled && longBreakEnabled) {
            if (msUntilNextShortBreak <= msUntilNextLongBreak) {
                nextBreakType = 'short-break';
                nextBreakInMs = msUntilNextShortBreak;
            }
            else {
                nextBreakType = 'long-break';
                nextBreakInMs = msUntilNextLongBreak;
            }
        }
        else if (shortBreakEnabled) {
            nextBreakType = 'short-break';
            nextBreakInMs = msUntilNextShortBreak;
        }
        else if (longBreakEnabled) {
            nextBreakType = 'long-break';
            nextBreakInMs = msUntilNextLongBreak;
        }
        // Convert Infinity to 0 for disabled breaks
        return {
            shortBreakEnabled,
            shortBreakEveryMinutes,
            shortBreakDurationMinutes,
            workTimeSinceShortBreakMs,
            msUntilNextShortBreak: msUntilNextShortBreak === Infinity ? 0 : msUntilNextShortBreak,
            shortBreakProgress,
            longBreakEnabled,
            longBreakEveryMinutes,
            longBreakDurationMinutes,
            workTimeSinceLongBreakMs,
            msUntilNextLongBreak: msUntilNextLongBreak === Infinity ? 0 : msUntilNextLongBreak,
            longBreakProgress,
            nextBreakType,
            nextBreakInMs: nextBreakInMs === Infinity ? 0 : nextBreakInMs,
            shortBreakCountToday: this.state.shortBreakCountToday ?? 0,
            longBreakCountToday: this.state.longBreakCountToday ?? 0,
        };
    }
    /**
     * Emit tick event with current state
     */
    emitTick() {
        const officeFocusLockService = (0, officeFocusLockService_1.getOfficeFocusLockService)();
        const schedule = this.currentSchedule;
        const breakType = (0, overlayPolicy_1.phaseToBreakType)(this.state.currentPhase);
        // Calculate total postpone count across all break types
        const totalPostponeCount = Object.values(this.state.postponeCountsToday).reduce((a, b) => a + b, 0);
        // Get max postpones for current break type (or legacy global value)
        const maxPostpones = breakType
            ? (0, overlayPolicy_1.getMaxPostponesForBreakType)(schedule, breakType)
            : (schedule?.maxPostponesPerDay ?? 0);
        // Get postpone options for current break type
        const postponeOptions = this.getPostponeOptionsForCurrentPhase();
        // Get strict mode for current phase
        const isStrictMode = this.getStrictModeForCurrentPhase();
        // Get no skip setting from schedule
        const noSkipEnabled = schedule?.noSkipEnabled ?? false;
        // Calculate break progress
        const breakProgress = this.calculateBreakProgress();
        // Get configured durations
        const configuredDurations = this.getConfiguredDurations();
        // Get next and then phases with durations
        const nextPhase = this.getNextPhase();
        const nextPhaseDurationMs = this.getPhaseDurationMsForPhase(nextPhase);
        const thenPhase = this.getThenPhase(nextPhase);
        const thenPhaseDurationMs = this.getPhaseDurationMsForPhase(thenPhase);
        // CRITICAL: Verify flow state consistency in flow-based mode
        if (schedule && (0, flowUtils_1.isFlowBasedSchedule)(schedule)) {
            const flowSteps = schedule.flowSteps;
            const currentIndex = this.state.currentFlowStepIndex ?? 0;
            const expectedCurrentPhase = flowSteps[currentIndex]?.type;
            const currentPhase = this.state.currentPhase;
            // Check for desync: currentPhase should match the flow step at currentIndex
            // Exception: during breaks (long-break is not in flow, short-break might be)
            const isInBreak = currentPhase === 'long-break';
            if (!isInBreak && expectedCurrentPhase !== currentPhase) {
                logger_1.default.warn('TimerEngine', 'FLOW STATE DESYNC DETECTED in emitTick', {
                    currentPhase,
                    currentFlowStepIndex: currentIndex,
                    expectedCurrentPhase,
                    nextPhase,
                    flowSteps: flowSteps.map((s, i) => `${i}:${s.type}`).join(', '),
                });
                // Attempt to resync: find the correct index for currentPhase
                const correctIndex = flowSteps.findIndex(s => s.type === currentPhase);
                if (correctIndex !== -1 && correctIndex !== currentIndex) {
                    logger_1.default.info('TimerEngine', 'Resyncing flow index', {
                        oldIndex: currentIndex,
                        newIndex: correctIndex,
                        phase: currentPhase,
                    });
                    this.state.currentFlowStepIndex = correctIndex;
                }
            }
            // Also check: if current and next are same but flow doesn't have consecutive duplicates
            if (currentPhase === nextPhase && currentPhase !== 'idle') {
                const nextIndex = (currentIndex + 1) % flowSteps.length;
                if (flowSteps[currentIndex]?.type !== flowSteps[nextIndex]?.type) {
                    logger_1.default.error('TimerEngine', 'CRITICAL: current == next but flow has no consecutive duplicates', {
                        currentPhase,
                        nextPhase,
                        currentIndex,
                        nextIndex,
                        flowStepAtCurrent: flowSteps[currentIndex]?.type,
                        flowStepAtNext: flowSteps[nextIndex]?.type,
                    });
                }
            }
        }
        // Phase 1.5: Runtime validation before emit
        const runtimeValidation = (0, sessionDebug_1.validateRuntimeState)(this.state, schedule, nextPhase);
        if (!runtimeValidation.valid) {
            // Attempt safe recovery
            const recovery = (0, sessionDebug_1.attemptSafeRecovery)(this.state, schedule);
            if (recovery.recovered && recovery.newIndex !== undefined) {
                this.state.currentFlowStepIndex = recovery.newIndex;
                // Recalculate next phase after recovery
                const recoveredNextPhase = this.getNextPhase();
                (0, sessionDebug_1.logSessionEvent)({
                    event: 'flowDesync',
                    reason: recovery.reason,
                    index: recovery.newIndex,
                    phase: this.state.currentPhase,
                    next: recoveredNextPhase,
                });
            }
        }
        // Create debug snapshot for dashboard (dev mode)
        const debugSnapshot = (0, sessionDebug_1.createDebugSnapshot)(this.state, schedule, nextPhase, thenPhase);
        const tick = {
            scheduleId: schedule?.id || null,
            scheduleName: schedule?.name || null,
            scheduleMode: schedule?.mode || null,
            currentPhase: this.state.currentPhase,
            phaseRemainingMs: this.state.phaseRemainingMs,
            phaseTotalMs: this.state.phaseTotalMs,
            nextPhase,
            nextPhaseDurationMs,
            thenPhase,
            thenPhaseDurationMs,
            cumulativeWorkTimeMs: this.state.cumulativeWorkTimeMs,
            isPaused: this.state.isPaused,
            isPostponed: this.state.isPostponed,
            pendingBreakPhase: this.state.postponedPhase,
            pendingBreakInMs: this.state.postponedUntil ? Math.max(0, this.state.postponedUntil - Date.now()) : 0,
            isFlowStale: this.isFlowSessionStale(),
            postponeCountToday: totalPostponeCount,
            maxPostponesPerDay: maxPostpones,
            canPostpone: this.canPostpone(),
            postponeOptions,
            isStrictMode,
            noSkipEnabled,
            officeFocusLock: officeFocusLockService.getState(),
            restBlock: (0, restBlockService_1.getRestBlockService)().getState(),
            breakProgress,
            configuredDurations,
            // Phase 1.5: Include debug snapshot for dev mode dashboard
            debugSnapshot: {
                currentFlowStepIndex: debugSnapshot.currentFlowStepIndex,
                validationStatus: debugSnapshot.validationStatus,
                flowStepsCount: debugSnapshot.flowStepsCount,
            },
        };
        this.emit('tick', tick);
    }
    /**
     * Get configured durations from active schedule
     * In flow-based mode, reads durations from the flow steps
     */
    getConfiguredDurations() {
        const schedule = this.currentSchedule;
        // Flow-based mode: extract durations from flow steps
        if (schedule && (0, flowUtils_1.isFlowBasedSchedule)(schedule)) {
            const flowSteps = schedule.flowSteps;
            // Find durations from flow steps (use first occurrence of each type)
            let sitMinutes = 12;
            let standMinutes = 12;
            let sitToStandTransitionSeconds = 60;
            let standToSitTransitionSeconds = 60;
            let shortBreakDurationMinutes = 5;
            for (const step of flowSteps) {
                switch (step.type) {
                    case 'sit':
                        sitMinutes = Math.round(step.durationSeconds / 60);
                        break;
                    case 'stand':
                        standMinutes = Math.round(step.durationSeconds / 60);
                        break;
                    case 'sit-to-stand-transition':
                        sitToStandTransitionSeconds = step.durationSeconds;
                        break;
                    case 'stand-to-sit-transition':
                        standToSitTransitionSeconds = step.durationSeconds;
                        break;
                    case 'short-break':
                        shortBreakDurationMinutes = Math.round(step.durationSeconds / 60);
                        break;
                }
            }
            return {
                sitMinutes,
                standMinutes,
                sitToStandTransitionSeconds,
                standToSitTransitionSeconds,
                shortBreakDurationMinutes,
                longBreakDurationMinutes: schedule.longBreak?.durationMinutes
                    ?? schedule.longBreakDurationMinutes ?? 15,
            };
        }
        // Rule-based mode: use legacy fields
        return {
            sitMinutes: schedule?.sitMinutes ?? 12,
            standMinutes: schedule?.standMinutes ?? 8,
            sitToStandTransitionSeconds: schedule?.transitions?.sitToStand?.durationSeconds
                ?? schedule?.sitToStandTransitionSeconds ?? 60,
            standToSitTransitionSeconds: schedule?.transitions?.standToSit?.durationSeconds
                ?? schedule?.standToSitTransitionSeconds ?? 60,
            shortBreakDurationMinutes: schedule?.shortBreak?.durationMinutes
                ?? schedule?.shortBreakDurationMinutes ?? 5,
            longBreakDurationMinutes: schedule?.longBreak?.durationMinutes
                ?? schedule?.longBreakDurationMinutes ?? 15,
        };
    }
    /**
     * Get postpone options for current phase
     */
    getPostponeOptionsForCurrentPhase() {
        if (!this.currentSchedule)
            return [];
        const schedule = this.currentSchedule;
        const breakType = (0, overlayPolicy_1.phaseToBreakType)(this.state.currentPhase);
        if (!breakType)
            return schedule.postponeOptionsMinutes ?? [];
        switch (breakType) {
            case 'sitToStandTransition':
                return schedule.transitions?.sitToStand?.postponeOptionsMinutes ?? schedule.postponeOptionsMinutes ?? [];
            case 'standToSitTransition':
                return schedule.transitions?.standToSit?.postponeOptionsMinutes ?? schedule.postponeOptionsMinutes ?? [];
            case 'shortBreak':
                return schedule.shortBreak?.postponeOptionsMinutes ?? schedule.postponeOptionsMinutes ?? [];
            case 'longBreak':
                return schedule.longBreak?.postponeOptionsMinutes ?? schedule.postponeOptionsMinutes ?? [];
            default:
                return schedule.postponeOptionsMinutes ?? [];
        }
    }
    /**
     * Get strict mode for current phase
     */
    getStrictModeForCurrentPhase() {
        if (!this.currentSchedule)
            return false;
        const schedule = this.currentSchedule;
        const breakType = (0, overlayPolicy_1.phaseToBreakType)(this.state.currentPhase);
        // Work phases use global setting
        if (!breakType)
            return schedule.strictModeEnabled ?? false;
        switch (breakType) {
            case 'sitToStandTransition':
                return schedule.transitions?.sitToStand?.strictModeEnabled ?? schedule.strictModeEnabled ?? false;
            case 'standToSitTransition':
                return schedule.transitions?.standToSit?.strictModeEnabled ?? schedule.strictModeEnabled ?? false;
            case 'shortBreak':
                return schedule.shortBreak?.strictModeEnabled ?? schedule.strictModeEnabled ?? false;
            case 'longBreak':
                return schedule.longBreak?.strictModeEnabled ?? schedule.strictModeEnabled ?? false;
            default:
                return schedule.strictModeEnabled ?? false;
        }
    }
    /**
     * Check if postpone is currently allowed
     * Uses per-break-type limits
     */
    canPostpone() {
        if (!this.currentSchedule)
            return false;
        if (this.state.isPostponed)
            return false;
        const breakType = (0, overlayPolicy_1.phaseToBreakType)(this.state.currentPhase);
        if (!breakType)
            return false; // Can only postpone breaks/transitions
        // Check if postpone allowed for this break type
        if (!this.isPostponeAllowedForBreakType(breakType))
            return false;
        // Check per-break-type limit
        const maxPostpones = (0, overlayPolicy_1.getMaxPostponesForBreakType)(this.currentSchedule, breakType);
        const currentCount = this.state.postponeCountsToday[breakType];
        return currentCount < maxPostpones;
    }
    /**
     * Get current state (for IPC)
     */
    getState() {
        return { ...this.state };
    }
    /**
     * Get current schedule
     */
    getCurrentSchedule() {
        return this.currentSchedule;
    }
    /**
     * Save state to persistence (debounced)
     */
    saveState() {
        this.stateChanged = true;
        const now = Date.now();
        // Debounce: only save if enough time has passed
        if (now - this.lastStateSaveTime >= STATE_SAVE_DEBOUNCE_MS) {
            this.saveStateImmediately();
        }
    }
    /**
     * Save state immediately (bypass debounce)
     * Uses the immediate save method for critical state changes
     */
    saveStateImmediately() {
        if (this.stateChanged || true) { // Always save for reliability
            configService_1.default.saveSessionStateImmediate(this.state);
            this.lastStateSaveTime = Date.now();
            this.stateChanged = false;
        }
    }
}
exports.TimerEngine = TimerEngine;
// Singleton instance
let timerEngineInstance = null;
function getTimerEngine() {
    if (!timerEngineInstance) {
        timerEngineInstance = new TimerEngine();
    }
    return timerEngineInstance;
}
exports.default = getTimerEngine;
//# sourceMappingURL=timerEngine.js.map