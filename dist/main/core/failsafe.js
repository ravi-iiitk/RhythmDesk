"use strict";
/**
 * RhythmDesk Failsafe - Phase 4 Production Hardening
 *
 * User-safe failback behavior when runtime state becomes unrecoverable.
 * Prevents infinite invalid state loops and ensures user can always recover.
 *
 * FAILSAFE TRIGGERS:
 * - Repeated validation failures
 * - Invariant violations that cannot be normalized
 * - Watchdog recovery failures
 * - Corrupted snapshot data
 *
 * FAILSAFE ACTIONS:
 * - Force reset session to known good state
 * - Log detailed error for debugging
 * - Notify user with recovery message
 * - Clear potentially corrupted state
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerformanceGuard = exports.FailsafeManager = void 0;
exports.getFailsafeManager = getFailsafeManager;
exports.getPerformanceGuard = getPerformanceGuard;
const types_1 = require("../shared/types");
const transitions_1 = require("./transitions");
const logger_1 = __importDefault(require("./logger"));
const traceLogger_1 = require("./traceLogger");
const DEFAULT_CONFIG = {
    maxValidationFailures: 5,
    maxNormalizationAttempts: 3,
    maxRecoveryAttemptsPerSession: 10,
    failsafeCooldownMs: 60000, // 1 minute
};
// ============================================================
// FAILSAFE MANAGER
// ============================================================
class FailsafeManager {
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.state = {
            consecutiveValidationFailures: 0,
            consecutiveNormalizationAttempts: 0,
            recoveryAttemptsThisSession: 0,
            lastFailsafeTime: 0,
            totalFailsafeCount: 0,
            isInFailsafeMode: false,
        };
    }
    /**
     * Report a validation failure
     */
    reportValidationFailure(details) {
        this.state.consecutiveValidationFailures++;
        logger_1.default.warn('Failsafe', 'Validation failure reported', {
            consecutiveFailures: this.state.consecutiveValidationFailures,
            ...details,
        });
        traceLogger_1.trace.invariantViolation('validation_failure', details);
    }
    /**
     * Report successful validation (resets failure counter)
     */
    reportValidationSuccess() {
        if (this.state.consecutiveValidationFailures > 0) {
            logger_1.default.debug('Failsafe', 'Validation recovered', {
                previousFailures: this.state.consecutiveValidationFailures,
            });
        }
        this.state.consecutiveValidationFailures = 0;
        this.state.consecutiveNormalizationAttempts = 0;
    }
    /**
     * Report a normalization attempt
     */
    reportNormalizationAttempt(success) {
        if (success) {
            this.state.consecutiveNormalizationAttempts = 0;
        }
        else {
            this.state.consecutiveNormalizationAttempts++;
            logger_1.default.warn('Failsafe', 'Normalization failed', {
                attempts: this.state.consecutiveNormalizationAttempts,
            });
        }
    }
    /**
     * Check if failsafe should trigger and return appropriate action
     */
    checkFailsafe(currentState, schedule) {
        const now = Date.now();
        // Check cooldown
        if (now - this.state.lastFailsafeTime < this.config.failsafeCooldownMs) {
            return {
                triggered: false,
                action: 'none',
                newState: null,
                reason: 'In cooldown period',
                userMessage: null,
            };
        }
        // Check if too many recovery attempts
        if (this.state.recoveryAttemptsThisSession >= this.config.maxRecoveryAttemptsPerSession) {
            return this.forceIdle('Too many recovery attempts this session');
        }
        // Check validation failures threshold
        if (this.state.consecutiveValidationFailures >= this.config.maxValidationFailures) {
            return this.triggerReset(currentState, schedule, 'Repeated validation failures');
        }
        // Check normalization failures threshold
        if (this.state.consecutiveNormalizationAttempts >= this.config.maxNormalizationAttempts) {
            return this.triggerReset(currentState, schedule, 'Normalization failed repeatedly');
        }
        return {
            triggered: false,
            action: 'none',
            newState: null,
            reason: 'No failsafe needed',
            userMessage: null,
        };
    }
    /**
     * Trigger a session reset
     */
    triggerReset(_currentState, schedule, reason) {
        this.state.lastFailsafeTime = Date.now();
        this.state.totalFailsafeCount++;
        this.state.recoveryAttemptsThisSession++;
        this.state.isInFailsafeMode = true;
        logger_1.default.error('Failsafe', 'FAILSAFE TRIGGERED - Resetting session', {
            reason,
            totalFailsafeCount: this.state.totalFailsafeCount,
            validationFailures: this.state.consecutiveValidationFailures,
            normalizationAttempts: this.state.consecutiveNormalizationAttempts,
        });
        traceLogger_1.trace.reset(`failsafe: ${reason}`);
        if (!schedule) {
            return this.forceIdle(reason);
        }
        // Compute clean reset state
        const resetState = (0, transitions_1.computeResetState)(schedule);
        const now = Date.now();
        const today = new Date().toISOString().split('T')[0];
        const newState = {
            ...types_1.INITIAL_SESSION_STATE,
            activeScheduleId: schedule.id,
            currentPhase: resetState.currentPhase,
            currentFlowStepIndex: resetState.currentFlowStepIndex,
            phaseStartedAt: now,
            phaseEndsAt: now + resetState.phaseDurationMs,
            phaseRemainingMs: resetState.phaseDurationMs,
            phaseTotalMs: resetState.phaseDurationMs,
            breakCountResetDate: today,
            postponeResetDate: today,
        };
        // Reset failure counters
        this.state.consecutiveValidationFailures = 0;
        this.state.consecutiveNormalizationAttempts = 0;
        return {
            triggered: true,
            action: 'reset',
            newState,
            reason,
            userMessage: 'Session was automatically reset due to an unexpected state. Your progress has been preserved where possible.',
        };
    }
    /**
     * Force to idle state (last resort)
     */
    forceIdle(reason) {
        this.state.lastFailsafeTime = Date.now();
        this.state.totalFailsafeCount++;
        this.state.isInFailsafeMode = true;
        logger_1.default.error('Failsafe', 'FAILSAFE: Forcing idle state', { reason });
        traceLogger_1.trace.reset(`failsafe-idle: ${reason}`);
        const now = Date.now();
        const today = new Date().toISOString().split('T')[0];
        const newState = {
            ...types_1.INITIAL_SESSION_STATE,
            activeScheduleId: null,
            currentPhase: 'idle',
            phaseStartedAt: now,
            phaseEndsAt: 0,
            phaseRemainingMs: 0,
            phaseTotalMs: 0,
            breakCountResetDate: today,
            postponeResetDate: today,
        };
        // Reset all counters
        this.state.consecutiveValidationFailures = 0;
        this.state.consecutiveNormalizationAttempts = 0;
        return {
            triggered: true,
            action: 'force_idle',
            newState,
            reason,
            userMessage: 'RhythmDesk encountered an error and has been reset. Please select a schedule to continue.',
        };
    }
    /**
     * Reset session counters (call on manual session reset)
     */
    resetSessionCounters() {
        this.state.recoveryAttemptsThisSession = 0;
        this.state.consecutiveValidationFailures = 0;
        this.state.consecutiveNormalizationAttempts = 0;
        this.state.isInFailsafeMode = false;
    }
    /**
     * Get failsafe state
     */
    getState() {
        return { ...this.state };
    }
    /**
     * Check if in failsafe mode
     */
    isInFailsafeMode() {
        return this.state.isInFailsafeMode;
    }
    /**
     * Clear failsafe mode
     */
    clearFailsafeMode() {
        this.state.isInFailsafeMode = false;
    }
}
exports.FailsafeManager = FailsafeManager;
// ============================================================
// SINGLETON INSTANCE
// ============================================================
let failsafeManagerInstance = null;
function getFailsafeManager() {
    if (!failsafeManagerInstance) {
        failsafeManagerInstance = new FailsafeManager();
    }
    return failsafeManagerInstance;
}
class PerformanceGuard {
    constructor() {
        this.tickDurations = [];
        this.trayUpdateCount = 0;
        this.overlayRefreshCount = 0;
        this.snapshotWriteCount = 0;
        this.lastMetricsReset = Date.now();
        this.maxSamples = 100;
        // Thresholds
        this.tickThresholdMs = 50; // Warn if tick takes >50ms
        this.trayUpdateThresholdPerMin = 60; // Warn if >60 tray updates/min
        this.snapshotThresholdPerMin = 20; // Warn if >20 snapshots/min
    }
    /**
     * Record tick handler duration
     */
    recordTickDuration(durationMs) {
        this.tickDurations.push(durationMs);
        if (this.tickDurations.length > this.maxSamples) {
            this.tickDurations.shift();
        }
        if (durationMs > this.tickThresholdMs) {
            logger_1.default.warn('PerformanceGuard', 'Slow tick handler', { durationMs });
        }
    }
    /**
     * Record tray update
     */
    recordTrayUpdate() {
        this.trayUpdateCount++;
    }
    /**
     * Record overlay refresh
     */
    recordOverlayRefresh() {
        this.overlayRefreshCount++;
    }
    /**
     * Record snapshot write
     */
    recordSnapshotWrite() {
        this.snapshotWriteCount++;
    }
    /**
     * Get performance metrics
     */
    getMetrics() {
        const avg = this.tickDurations.length > 0
            ? this.tickDurations.reduce((a, b) => a + b, 0) / this.tickDurations.length
            : 0;
        const max = this.tickDurations.length > 0
            ? Math.max(...this.tickDurations)
            : 0;
        return {
            tickHandlerAvgMs: Math.round(avg * 100) / 100,
            tickHandlerMaxMs: max,
            trayUpdateCount: this.trayUpdateCount,
            overlayRefreshCount: this.overlayRefreshCount,
            snapshotWriteCount: this.snapshotWriteCount,
            lastMetricsReset: this.lastMetricsReset,
        };
    }
    /**
     * Check for performance issues
     */
    checkPerformance() {
        const warnings = [];
        const elapsedMin = (Date.now() - this.lastMetricsReset) / 60000;
        if (elapsedMin > 0) {
            const trayPerMin = this.trayUpdateCount / elapsedMin;
            const snapshotPerMin = this.snapshotWriteCount / elapsedMin;
            if (trayPerMin > this.trayUpdateThresholdPerMin) {
                warnings.push(`High tray update rate: ${Math.round(trayPerMin)}/min`);
            }
            if (snapshotPerMin > this.snapshotThresholdPerMin) {
                warnings.push(`High snapshot write rate: ${Math.round(snapshotPerMin)}/min`);
            }
        }
        const metrics = this.getMetrics();
        if (metrics.tickHandlerAvgMs > this.tickThresholdMs / 2) {
            warnings.push(`High tick handler avg: ${metrics.tickHandlerAvgMs}ms`);
        }
        return {
            healthy: warnings.length === 0,
            warnings,
        };
    }
    /**
     * Reset metrics
     */
    reset() {
        this.tickDurations = [];
        this.trayUpdateCount = 0;
        this.overlayRefreshCount = 0;
        this.snapshotWriteCount = 0;
        this.lastMetricsReset = Date.now();
    }
}
exports.PerformanceGuard = PerformanceGuard;
// Singleton
let performanceGuardInstance = null;
function getPerformanceGuard() {
    if (!performanceGuardInstance) {
        performanceGuardInstance = new PerformanceGuard();
    }
    return performanceGuardInstance;
}
//# sourceMappingURL=failsafe.js.map