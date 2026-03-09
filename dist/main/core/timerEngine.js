"use strict";
/**
 * PostureGuard Timer Engine
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
const timeUtils_1 = require("../shared/timeUtils");
const constants_1 = require("../shared/constants");
const configService_1 = __importDefault(require("./configService"));
const scheduleResolver_1 = require("./scheduleResolver");
class TimerEngine extends events_1.EventEmitter {
    constructor() {
        super();
        this.currentSchedule = null;
        this.tickInterval = null;
        this.lastTickTime = 0;
        this.state = configService_1.default.getSessionState();
        this.validateAndResetPostponeCount();
    }
    /**
     * Reset postpone count if it's a new day
     */
    validateAndResetPostponeCount() {
        const today = (0, timeUtils_1.getTodayDateString)();
        if (this.state.postponeResetDate !== today) {
            this.state.postponeCountToday = 0;
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
        this.lastTickTime = Date.now();
        this.tickInterval = setInterval(() => this.tick(), constants_1.TIMER_TICK_INTERVAL_MS);
        this.tick(); // Initial tick
    }
    /**
     * Stop the timer engine
     */
    stop() {
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }
    }
    /**
     * Main timer tick - called every second
     */
    tick() {
        const now = Date.now();
        const deltaMs = now - this.lastTickTime;
        this.lastTickTime = now;
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
     */
    checkBreakTriggers() {
        if (!this.currentSchedule)
            return;
        if (!this.isWorkPhase(this.state.currentPhase))
            return;
        const workTimeMs = this.state.cumulativeWorkTimeMs;
        // Check long break first (highest priority)
        if (this.currentSchedule.longBreakEnabled) {
            const longBreakThreshold = (0, timeUtils_1.minutesToMs)(this.currentSchedule.longBreakEveryMinutes);
            const timeSinceLastLongBreak = workTimeMs - this.state.lastLongBreakAtWorkTimeMs;
            if (timeSinceLastLongBreak >= longBreakThreshold) {
                this.triggerBreak('long-break');
                return;
            }
        }
        // Check short break
        if (this.currentSchedule.shortBreakEnabled) {
            const shortBreakThreshold = (0, timeUtils_1.minutesToMs)(this.currentSchedule.shortBreakEveryMinutes);
            const timeSinceLastShortBreak = workTimeMs - this.state.lastShortBreakAtWorkTimeMs;
            if (timeSinceLastShortBreak >= shortBreakThreshold) {
                this.triggerBreak('short-break');
                return;
            }
        }
    }
    /**
     * Trigger a break, interrupting current phase
     */
    triggerBreak(breakType) {
        // Store remaining time in current phase to resume after break
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
                // Return to sit (could be smarter, but this is deterministic)
                nextPhase = 'sit';
                break;
            case 'long-break':
                this.state.lastLongBreakAtWorkTimeMs = this.state.cumulativeWorkTimeMs;
                nextPhase = 'sit';
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
        this.state.currentPhase = phase;
        this.state.phaseStartedAt = Date.now();
        this.state.phaseRemainingMs = this.getPhaseDurationMs(phase);
        this.emit('phaseChange', { prevPhase, newPhase: phase });
        this.saveState();
    }
    /**
     * Get duration for a phase in milliseconds
     */
    getPhaseDurationMs(phase) {
        if (!this.currentSchedule)
            return 0;
        switch (phase) {
            case 'sit':
                return (0, timeUtils_1.minutesToMs)(this.currentSchedule.sitMinutes);
            case 'stand':
                return (0, timeUtils_1.minutesToMs)(this.currentSchedule.standMinutes);
            case 'sit-to-stand-transition':
                return (0, timeUtils_1.secondsToMs)(this.currentSchedule.sitToStandTransitionSeconds);
            case 'stand-to-sit-transition':
                return (0, timeUtils_1.secondsToMs)(this.currentSchedule.standToSitTransitionSeconds);
            case 'short-break':
                return (0, timeUtils_1.minutesToMs)(this.currentSchedule.shortBreakDurationMinutes);
            case 'long-break':
                return (0, timeUtils_1.minutesToMs)(this.currentSchedule.longBreakDurationMinutes);
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
        this.state.phaseRemainingMs = 0;
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
     */
    postpone(minutes) {
        if (!this.currentSchedule)
            return false;
        if (!this.currentSchedule.allowPostpone)
            return false;
        if (this.state.postponeCountToday >= this.currentSchedule.maxPostponesPerDay) {
            return false;
        }
        this.state.isPostponed = true;
        this.state.postponedUntil = Date.now() + (0, timeUtils_1.minutesToMs)(minutes);
        this.state.postponedPhase = this.state.currentPhase;
        this.state.postponeCountToday++;
        this.saveState();
        return true;
    }
    /**
     * Skip the current phase (if allowed)
     */
    skipPhase() {
        if (!this.currentSchedule)
            return;
        // Only allow skipping non-strict mode or non-work phases
        if (this.currentSchedule.strictModeEnabled && this.isWorkPhase(this.state.currentPhase)) {
            return;
        }
        this.advancePhase();
    }
    /**
     * Complete current phase (user acknowledges they're done)
     */
    completePhase() {
        this.advancePhase();
    }
    /**
     * Emit tick event with current state
     */
    emitTick() {
        const tick = {
            scheduleId: this.currentSchedule?.id || null,
            scheduleName: this.currentSchedule?.name || null,
            currentPhase: this.state.currentPhase,
            phaseRemainingMs: this.state.phaseRemainingMs,
            phaseTotalMs: this.getPhaseDurationMs(this.state.currentPhase),
            nextPhase: this.getNextPhase(),
            cumulativeWorkTimeMs: this.state.cumulativeWorkTimeMs,
            isPaused: this.state.isPaused,
            isPostponed: this.state.isPostponed,
            postponeCountToday: this.state.postponeCountToday,
            maxPostponesPerDay: this.currentSchedule?.maxPostponesPerDay || 0,
            canPostpone: this.canPostpone(),
            postponeOptions: this.currentSchedule?.postponeOptionsMinutes || [],
            isStrictMode: this.currentSchedule?.strictModeEnabled || false,
        };
        this.emit('tick', tick);
    }
    /**
     * Check if postpone is currently allowed
     */
    canPostpone() {
        if (!this.currentSchedule)
            return false;
        if (!this.currentSchedule.allowPostpone)
            return false;
        if (this.state.postponeCountToday >= this.currentSchedule.maxPostponesPerDay)
            return false;
        if (this.state.isPostponed)
            return false;
        return true;
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
     * Save state to persistence
     */
    saveState() {
        configService_1.default.saveSessionState(this.state);
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