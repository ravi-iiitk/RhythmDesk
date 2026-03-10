"use strict";
/**
 * RhythmDesk Timer Engine
 * Core business logic for tracking work phases, breaks, and transitions
 *
 * IMPORTANT RULES:
 * - Active work time = sit + stand phases ONLY
 * - Transitions, short breaks, long breaks do NOT count as work time
 * - Short/long breaks trigger based on cumulative work time thresholds
 * - Long break has highest priority, then short break, then transition
 * - Paused/postponed time does NOT count toward work time
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
const timeUtils_1 = require("../shared/timeUtils");
const constants_1 = require("../shared/constants");
const configService_1 = __importDefault(require("./configService"));
const scheduleResolver_1 = require("./scheduleResolver");
const overlayPolicy_1 = require("./overlayPolicy");
const logger_1 = __importDefault(require("./logger"));
const TIME_JUMP_THRESHOLD_MS = 5000; // 5 seconds - indicates sleep/wake or time jump
const STATE_SAVE_DEBOUNCE_MS = 5000; // Save state every 5 seconds max
class TimerEngine extends events_1.EventEmitter {
    constructor() {
        super();
        this.currentSchedule = null;
        this.tickInterval = null;
        this.lastTickTime = 0;
        this.lastStateSaveTime = 0;
        this.stateChanged = false;
        // Track the phase we were in before a break interrupted
        this.preBreakPhase = null;
        this.state = configService_1.default.getSessionState();
        this.validateAndResetPostponeCount();
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
     */
    recoverStateFromTimestamps() {
        const now = Date.now();
        // Skip if idle
        if (this.state.currentPhase === 'idle')
            return;
        // If paused, nothing to recover
        if (this.state.isPaused)
            return;
        // If postponed, check if postpone has ended
        if (this.state.isPostponed && this.state.postponedUntil) {
            if (now >= this.state.postponedUntil) {
                this.state.isPostponed = false;
                this.state.postponedUntil = null;
                if (this.state.postponedPhase) {
                    this.startPhase(this.state.postponedPhase);
                }
                this.state.postponedPhase = null;
                return;
            }
        }
        // Recalculate phase remaining from phaseEndsAt
        if (this.state.phaseEndsAt > 0) {
            const remaining = this.state.phaseEndsAt - now;
            if (remaining <= 0) {
                // Phase should have ended - advance
                logger_1.default.info('TimerEngine', 'Phase ended during sleep/wake - advancing', {
                    phase: this.state.currentPhase,
                    phaseEndsAt: this.state.phaseEndsAt,
                    now,
                });
                this.advancePhase();
            }
            else {
                this.state.phaseRemainingMs = remaining;
            }
        }
    }
    /**
     * Reset postpone counts if it's a new day
     */
    validateAndResetPostponeCount() {
        const today = (0, timeUtils_1.getTodayDateString)();
        if (this.state.postponeResetDate !== today) {
            // Reset all per-break-type counters
            this.state.postponeCountsToday = { ...types_1.INITIAL_POSTPONE_COUNTS };
            this.state.postponeResetDate = today;
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
     */
    tick() {
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
        this.validateAndResetPostponeCount();
        // Check for schedule changes
        this.checkScheduleChange();
        if (!this.currentSchedule) {
            this.setIdleState();
            this.emitTick();
            return;
        }
        // Handle postponed state
        if (this.state.isPostponed && this.state.postponedUntil) {
            if (now >= this.state.postponedUntil) {
                // Postpone ended, resume the postponed phase
                this.state.isPostponed = false;
                this.state.postponedUntil = null;
                if (this.state.postponedPhase) {
                    this.startPhase(this.state.postponedPhase);
                }
                this.state.postponedPhase = null;
            }
            else {
                // Still postponed
                this.state.phaseRemainingMs = this.state.postponedUntil - now;
                this.emitTick();
                this.saveState();
                return;
            }
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
        // Track cumulative work time (only for sit/stand phases)
        if (this.isWorkPhase(this.state.currentPhase)) {
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
     */
    checkScheduleChange() {
        const schedules = configService_1.default.getSchedules();
        const activeSchedule = (0, scheduleResolver_1.resolveActiveSchedule)(schedules);
        if (activeSchedule?.id !== this.currentSchedule?.id) {
            this.currentSchedule = activeSchedule;
            if (activeSchedule) {
                // Starting a new schedule
                this.state.activeScheduleId = activeSchedule.id;
                this.state.cumulativeWorkTimeMs = 0;
                this.state.lastShortBreakAtWorkTimeMs = 0;
                this.state.lastLongBreakAtWorkTimeMs = 0;
                this.startPhase('sit'); // Always start with sitting
            }
            else {
                this.setIdleState();
            }
            this.emit('scheduleChange', this.currentSchedule);
        }
    }
    /**
     * Check if a break should be triggered based on cumulative work time
     * Priority: long break > short break
     * RULE: Only trigger breaks during sit/stand phases, never during transitions
     */
    checkBreakTriggers() {
        if (!this.currentSchedule)
            return;
        // Only trigger breaks during actual work phases (sit/stand), not transitions
        if (!this.isWorkPhase(this.state.currentPhase))
            return;
        const workTimeMs = this.state.cumulativeWorkTimeMs;
        const schedule = this.currentSchedule;
        // Check long break first (highest priority)
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
        // Check short break
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
    /**
     * Trigger a break, interrupting current phase
     * Stores current phase info to resume after break completes
     */
    triggerBreak(breakType) {
        // Store current phase to resume after break
        this.preBreakPhase = this.state.currentPhase;
        this.emit('breakDue', breakType);
        this.startPhase(breakType);
    }
    /**
     * Advance to the next phase when current phase completes
     */
    advancePhase() {
        const prevPhase = this.state.currentPhase;
        let nextPhase;
        switch (prevPhase) {
            case 'sit':
                nextPhase = 'sit-to-stand-transition';
                break;
            case 'sit-to-stand-transition':
                nextPhase = 'stand';
                break;
            case 'stand':
                nextPhase = 'stand-to-sit-transition';
                break;
            case 'stand-to-sit-transition':
                nextPhase = 'sit';
                break;
            case 'short-break':
                this.state.lastShortBreakAtWorkTimeMs = this.state.cumulativeWorkTimeMs;
                // Resume to pre-break phase if we interrupted a work phase
                if (this.preBreakPhase && this.isWorkPhase(this.preBreakPhase)) {
                    nextPhase = this.preBreakPhase;
                }
                else {
                    nextPhase = 'sit';
                }
                this.preBreakPhase = null;
                break;
            case 'long-break':
                this.state.lastLongBreakAtWorkTimeMs = this.state.cumulativeWorkTimeMs;
                // After long break, always start fresh with sit
                // (Long break is a full reset point)
                nextPhase = 'sit';
                this.preBreakPhase = null;
                break;
            default:
                nextPhase = 'sit';
        }
        this.startPhase(nextPhase);
    }
    /**
     * Start a specific phase
     */
    startPhase(phase) {
        const prevPhase = this.state.currentPhase;
        const now = Date.now();
        const duration = this.getPhaseDurationMs(phase);
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
     * Check if phase counts as active work time
     */
    isWorkPhase(phase) {
        return phase === 'sit' || phase === 'stand';
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
     */
    getNextPhase() {
        if (!this.currentSchedule)
            return 'idle';
        switch (this.state.currentPhase) {
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
                return 'sit';
            default:
                return 'idle';
        }
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
     * Postpone current phase
     * Uses per-break-type postpone limits
     */
    postpone(minutes) {
        if (!this.currentSchedule)
            return false;
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
        this.state.isPostponed = true;
        this.state.postponedUntil = Date.now() + (0, timeUtils_1.minutesToMs)(minutes);
        this.state.postponedPhase = this.state.currentPhase;
        this.state.postponedBreakType = breakType;
        this.state.postponeCountsToday[breakType]++;
        this.saveState();
        // Emit event so main process can close overlay
        this.emit('postponed', { minutes, phase: this.state.postponedPhase, breakType });
        return true;
    }
    /**
     * Check if postpone is allowed for a break type
     */
    isPostponeAllowedForBreakType(breakType) {
        if (!this.currentSchedule)
            return false;
        const schedule = this.currentSchedule;
        switch (breakType) {
            case 'sitToStandTransition':
                return schedule.transitions?.sitToStand?.allowPostpone ?? schedule.allowPostpone ?? false;
            case 'standToSitTransition':
                return schedule.transitions?.standToSit?.allowPostpone ?? schedule.allowPostpone ?? false;
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
     */
    skipPhase() {
        if (!this.currentSchedule)
            return;
        // Only allow skipping if not in strict mode for current phase
        const isStrictMode = this.getStrictModeForCurrentPhase();
        if (isStrictMode)
            return;
        this.advancePhase();
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
     * Resets:
     * - Current phase to sitting work
     * - All phase progress
     * - Cumulative work time
     * - Work time toward breaks (lastShortBreakAtWorkTimeMs, lastLongBreakAtWorkTimeMs)
     * - Postponed state
     * - Interrupted phase state
     * - Paused state
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
        logger_1.default.info('TimerEngine', `Resetting session for schedule: ${this.currentSchedule.name}`);
        const now = Date.now();
        const sitDurationMs = (0, timeUtils_1.minutesToMs)(this.currentSchedule.sitMinutes);
        // Reset all session state
        this.state.currentPhase = 'sit';
        this.state.phaseStartedAt = now;
        this.state.phaseEndsAt = now + sitDurationMs;
        this.state.phaseRemainingMs = sitDurationMs;
        this.state.phaseTotalMs = sitDurationMs;
        // Reset cumulative work time
        this.state.cumulativeWorkTimeMs = 0;
        // Reset break tracking - all breaks start fresh
        this.state.lastShortBreakAtWorkTimeMs = 0;
        this.state.lastLongBreakAtWorkTimeMs = 0;
        // Clear interrupted phase
        this.state.interruptedPhase = null;
        this.state.interruptedPhaseRemainingMs = 0;
        // Clear postponed state
        this.state.isPostponed = false;
        this.state.postponedUntil = null;
        this.state.postponedPhase = null;
        this.state.postponedBreakType = null;
        // Clear paused state
        this.state.isPaused = false;
        this.state.pausedAt = null;
        this.state.pauseResumeAt = null;
        // Clear pre-break tracking
        this.preBreakPhase = null;
        // Update tick time
        this.lastTickTime = now;
        // Save state and emit tick
        this.saveState();
        this.emitTick();
        logger_1.default.info('TimerEngine', 'Session reset complete - starting fresh in Sitting Work phase');
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
        // Save state and emit tick
        this.saveState();
        this.emitTick();
        logger_1.default.info('TimerEngine', 'Today\'s counters reset complete');
    }
    /**
     * Calculate break progress information
     */
    calculateBreakProgress() {
        const schedule = this.currentSchedule;
        const workTimeMs = this.state.cumulativeWorkTimeMs;
        // Short break settings
        const shortBreakEnabled = schedule?.shortBreak?.enabled ?? schedule?.shortBreakEnabled ?? false;
        const shortBreakEveryMinutes = schedule?.shortBreak?.everyMinutes ?? schedule?.shortBreakEveryMinutes ?? 60;
        const shortBreakDurationMinutes = schedule?.shortBreak?.durationMinutes ?? schedule?.shortBreakDurationMinutes ?? 5;
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
        // Calculate break progress
        const breakProgress = this.calculateBreakProgress();
        // Get configured durations
        const configuredDurations = this.getConfiguredDurations();
        const tick = {
            scheduleId: schedule?.id || null,
            scheduleName: schedule?.name || null,
            currentPhase: this.state.currentPhase,
            phaseRemainingMs: this.state.phaseRemainingMs,
            phaseTotalMs: this.state.phaseTotalMs,
            nextPhase: this.getNextPhase(),
            cumulativeWorkTimeMs: this.state.cumulativeWorkTimeMs,
            isPaused: this.state.isPaused,
            isPostponed: this.state.isPostponed,
            postponeCountToday: totalPostponeCount,
            maxPostponesPerDay: maxPostpones,
            canPostpone: this.canPostpone(),
            postponeOptions,
            isStrictMode,
            officeFocusLock: officeFocusLockService.getState(),
            breakProgress,
            configuredDurations,
        };
        this.emit('tick', tick);
    }
    /**
     * Get configured durations from active schedule
     */
    getConfiguredDurations() {
        const schedule = this.currentSchedule;
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
     */
    saveStateImmediately() {
        if (this.stateChanged || true) { // Always save for reliability
            configService_1.default.saveSessionState(this.state);
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