"use strict";
/**
 * RhythmDesk Event Trace Logger - Phase 4 Production Hardening
 *
 * Lightweight debug tracing mode for session events.
 * When enabled, logs compact timeline entries for debugging long sessions.
 *
 * Format: [TRACE] event details
 *
 * Examples:
 * [TRACE] phase=sit → transition → stand
 * [TRACE] break=short postponed
 * [TRACE] break=short resumed
 * [TRACE] reset session
 * [TRACE] flow reversed (pending reset)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.trace = void 0;
exports.getTraceLogger = getTraceLogger;
exports.enableTracing = enableTracing;
exports.isTracingEnabled = isTracingEnabled;
const logger_1 = __importDefault(require("./logger"));
const DEFAULT_TRACE_CONFIG = {
    enabled: process.env.NODE_ENV === 'development',
    maxEntries: 1000,
    includeTimestamps: true,
    includePhaseMs: true,
};
// ============================================================
// TRACE LOGGER
// ============================================================
class TraceLogger {
    constructor(config = {}) {
        this.entries = [];
        this.tickCount = 0;
        this.sessionStartTime = Date.now();
        this.config = { ...DEFAULT_TRACE_CONFIG, ...config };
    }
    /**
     * Enable or disable tracing
     */
    setEnabled(enabled) {
        this.config.enabled = enabled;
        if (enabled) {
            this.log('system', 'Trace logging enabled');
        }
    }
    /**
     * Check if tracing is enabled
     */
    isEnabled() {
        return this.config.enabled;
    }
    /**
     * Log a trace entry
     */
    log(event, message, data) {
        if (!this.config.enabled && event !== 'system')
            return;
        const entry = {
            timestamp: Date.now(),
            event: event,
            message,
            data,
        };
        this.entries.push(entry);
        // Trim if exceeds max entries
        if (this.entries.length > this.config.maxEntries) {
            this.entries = this.entries.slice(-this.config.maxEntries);
        }
        // Also log to main logger in debug mode
        const timeStr = this.config.includeTimestamps
            ? `+${Math.round((Date.now() - this.sessionStartTime) / 1000)}s`
            : '';
        logger_1.default.debug('TRACE', `[TRACE] ${timeStr} ${message}`, data);
    }
    // ============================================================
    // TRACE EVENT METHODS
    // ============================================================
    /**
     * Log phase change
     */
    tracePhaseChange(fromPhase, toPhase, flowIndex) {
        const arrow = '→';
        let message = `phase=${fromPhase} ${arrow} ${toPhase}`;
        if (flowIndex !== undefined) {
            message += ` [idx=${flowIndex}]`;
        }
        this.log('phase_change', message, { fromPhase, toPhase, flowIndex });
    }
    /**
     * Log skip action
     */
    traceSkip(fromPhase, toPhase) {
        this.log('skip', `skip ${fromPhase} → ${toPhase}`, { fromPhase, toPhase });
    }
    /**
     * Log postpone action
     */
    tracePostpone(breakType, minutes) {
        this.log('postpone', `break=${breakType} postponed ${minutes}min`, { breakType, minutes });
    }
    /**
     * Log postpone resume
     */
    tracePostponeResume(breakType) {
        this.log('postpone_resume', `break=${breakType} resumed`, { breakType });
    }
    /**
     * Log break start
     */
    traceBreakStart(breakType, interruptedPhase) {
        this.log('break_start', `break=${breakType} started`, { breakType, interruptedPhase });
    }
    /**
     * Log break end
     */
    traceBreakEnd(breakType, resumePhase) {
        this.log('break_end', `break=${breakType} ended → ${resumePhase}`, { breakType, resumePhase });
    }
    /**
     * Log session reset
     */
    traceReset(reason) {
        this.log('reset', `reset session${reason ? ` (${reason})` : ''}`, { reason });
    }
    /**
     * Log pause
     */
    tracePause() {
        this.log('pause', 'session paused');
    }
    /**
     * Log resume
     */
    traceResume() {
        this.log('resume', 'session resumed');
    }
    /**
     * Log recovery
     */
    traceRecovery(action, details) {
        this.log('recovery', `recovery: ${action}`, details);
    }
    /**
     * Log schedule change
     */
    traceScheduleChange(scheduleId, action) {
        this.log('schedule_change', `schedule ${action}: ${scheduleId || 'none'}`, { scheduleId, action });
    }
    /**
     * Log flow stale detection
     */
    traceFlowStale() {
        this.log('flow_stale', 'flow config stale (pending reset)');
    }
    /**
     * Log invariant violation
     */
    traceInvariantViolation(invariant, details) {
        this.log('invariant_violation', `invariant: ${invariant}`, details);
    }
    /**
     * Log watchdog trigger
     */
    traceWatchdogTrigger(type, action) {
        this.log('watchdog_trigger', `watchdog:${type} → ${action}`, { type, action });
    }
    /**
     * Log overlay action
     */
    traceOverlayAction(action) {
        this.log('overlay_action', `overlay:${action}`);
    }
    /**
     * Log tick (compact - only every N ticks)
     */
    traceTick(phaseRemainingMs) {
        this.tickCount++;
        // Only log every 60 ticks (roughly every minute at 1s intervals)
        if (this.tickCount % 60 === 0) {
            this.log('tick', `tick #${this.tickCount} remaining=${Math.round(phaseRemainingMs / 1000)}s`);
        }
    }
    // ============================================================
    // TRACE RETRIEVAL
    // ============================================================
    /**
     * Get all trace entries
     */
    getEntries() {
        return [...this.entries];
    }
    /**
     * Get recent entries
     */
    getRecentEntries(count = 50) {
        return this.entries.slice(-count);
    }
    /**
     * Get entries by event type
     */
    getEntriesByType(type) {
        return this.entries.filter(e => e.event === type);
    }
    /**
     * Get entries since timestamp
     */
    getEntriesSince(timestamp) {
        return this.entries.filter(e => e.timestamp >= timestamp);
    }
    /**
     * Clear all entries
     */
    clear() {
        this.entries = [];
        this.tickCount = 0;
    }
    /**
     * Reset session start time (call on session reset)
     */
    resetSessionTime() {
        this.sessionStartTime = Date.now();
        this.tickCount = 0;
    }
    /**
     * Get session stats
     */
    getStats() {
        const entriesByType = {};
        for (const entry of this.entries) {
            entriesByType[entry.event] = (entriesByType[entry.event] || 0) + 1;
        }
        return {
            totalEntries: this.entries.length,
            tickCount: this.tickCount,
            sessionDurationMs: Date.now() - this.sessionStartTime,
            entriesByType,
        };
    }
    /**
     * Format entries as compact timeline string
     */
    formatTimeline(maxEntries = 100) {
        const entries = this.getRecentEntries(maxEntries);
        const lines = [];
        for (const entry of entries) {
            const relTime = Math.round((entry.timestamp - this.sessionStartTime) / 1000);
            lines.push(`[+${relTime}s] ${entry.message}`);
        }
        return lines.join('\n');
    }
}
// ============================================================
// SINGLETON INSTANCE
// ============================================================
let traceLoggerInstance = null;
function getTraceLogger() {
    if (!traceLoggerInstance) {
        traceLoggerInstance = new TraceLogger();
    }
    return traceLoggerInstance;
}
function enableTracing(enabled = true) {
    getTraceLogger().setEnabled(enabled);
}
function isTracingEnabled() {
    return getTraceLogger().isEnabled();
}
// Export trace methods for convenience
exports.trace = {
    phaseChange: (from, to, idx) => getTraceLogger().tracePhaseChange(from, to, idx),
    skip: (from, to) => getTraceLogger().traceSkip(from, to),
    postpone: (breakType, minutes) => getTraceLogger().tracePostpone(breakType, minutes),
    postponeResume: (breakType) => getTraceLogger().tracePostponeResume(breakType),
    breakStart: (breakType, interrupted) => getTraceLogger().traceBreakStart(breakType, interrupted),
    breakEnd: (breakType, resume) => getTraceLogger().traceBreakEnd(breakType, resume),
    reset: (reason) => getTraceLogger().traceReset(reason),
    pause: () => getTraceLogger().tracePause(),
    resume: () => getTraceLogger().traceResume(),
    recovery: (action, details) => getTraceLogger().traceRecovery(action, details),
    scheduleChange: (id, action) => getTraceLogger().traceScheduleChange(id, action),
    flowStale: () => getTraceLogger().traceFlowStale(),
    invariantViolation: (inv, details) => getTraceLogger().traceInvariantViolation(inv, details),
    watchdog: (type, action) => getTraceLogger().traceWatchdogTrigger(type, action),
    overlay: (action) => getTraceLogger().traceOverlayAction(action),
    tick: (remaining) => getTraceLogger().traceTick(remaining),
};
//# sourceMappingURL=traceLogger.js.map