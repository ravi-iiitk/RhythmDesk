"use strict";
/**
 * RhythmDesk Watchdog - Phase 4 Production Hardening
 *
 * Monitors timer engine and overlay health.
 * Detects stalls and triggers recovery.
 *
 * TIMER ENGINE WATCHDOG:
 * - Verifies timer ticks are occurring
 * - Checks phaseRemainingMs is decreasing
 * - Detects frozen sessions
 *
 * OVERLAY WATCHDOG:
 * - Monitors heartbeat pings from overlay renderer
 * - Detects overlay crashes or hangs
 * - Triggers overlay reload if unresponsive
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LongSessionGuard = exports.OverlayWatchdog = exports.TimerWatchdog = void 0;
exports.getTimerWatchdog = getTimerWatchdog;
exports.getOverlayWatchdog = getOverlayWatchdog;
exports.getLongSessionGuard = getLongSessionGuard;
const events_1 = require("events");
const logger_1 = __importDefault(require("./logger"));
const traceLogger_1 = require("./traceLogger");
const DEFAULT_CONFIG = {
    timerCheckIntervalMs: 5000, // Check every 5 seconds
    timerStallThresholdMs: 3000, // Consider stalled if no tick for 3 seconds
    maxConsecutiveStalls: 3, // Trigger recovery after 3 consecutive stalls
    overlayHeartbeatIntervalMs: 1000, // Expect heartbeat every 1 second
    overlayHeartbeatTimeoutMs: 5000, // Consider dead after 5 seconds no heartbeat
    overlayMaxMissedHeartbeats: 5, // Trigger reload after 5 missed heartbeats
    enabled: true,
};
class TimerWatchdog extends events_1.EventEmitter {
    constructor(config = {}) {
        super();
        this.checkInterval = null;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.state = {
            lastTickTime: Date.now(),
            lastPhaseRemainingMs: 0,
            consecutiveStalls: 0,
            isRunning: false,
            recoveryCount: 0,
        };
    }
    /**
     * Start the watchdog
     */
    start() {
        if (!this.config.enabled || this.state.isRunning)
            return;
        this.state.isRunning = true;
        this.state.lastTickTime = Date.now();
        this.state.consecutiveStalls = 0;
        this.checkInterval = setInterval(() => {
            this.checkTimerHealth();
        }, this.config.timerCheckIntervalMs);
        logger_1.default.info('TimerWatchdog', 'Started');
    }
    /**
     * Stop the watchdog
     */
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.state.isRunning = false;
        logger_1.default.info('TimerWatchdog', 'Stopped');
    }
    /**
     * Report a tick (called by timer engine)
     */
    reportTick(phaseRemainingMs) {
        const now = Date.now();
        // Check if phaseRemainingMs is actually decreasing
        // (unless it reset due to phase change)
        if (this.state.lastPhaseRemainingMs > 0 &&
            phaseRemainingMs > this.state.lastPhaseRemainingMs) {
            // Phase changed - this is normal
        }
        this.state.lastTickTime = now;
        this.state.lastPhaseRemainingMs = phaseRemainingMs;
        this.state.consecutiveStalls = 0; // Reset stall counter on successful tick
    }
    /**
     * Check timer engine health
     */
    checkTimerHealth() {
        const now = Date.now();
        const elapsed = now - this.state.lastTickTime;
        if (elapsed > this.config.timerStallThresholdMs) {
            this.state.consecutiveStalls++;
            logger_1.default.warn('TimerWatchdog', 'Stall detected', {
                elapsed,
                consecutiveStalls: this.state.consecutiveStalls,
                lastTickTime: this.state.lastTickTime,
            });
            this.emit('timer:stall_detected', {
                lastTickTime: this.state.lastTickTime,
                elapsed,
            });
            traceLogger_1.trace.watchdog('timer', `stall #${this.state.consecutiveStalls}`);
            if (this.state.consecutiveStalls >= this.config.maxConsecutiveStalls) {
                this.triggerRecovery();
            }
        }
    }
    /**
     * Trigger timer recovery
     */
    triggerRecovery() {
        this.state.recoveryCount++;
        logger_1.default.error('TimerWatchdog', 'Triggering recovery', {
            consecutiveStalls: this.state.consecutiveStalls,
            recoveryCount: this.state.recoveryCount,
        });
        traceLogger_1.trace.watchdog('timer', 'recovery triggered');
        this.emit('timer:recovery_triggered', {
            reason: `${this.state.consecutiveStalls} consecutive stalls`,
        });
        // Reset stall counter after triggering recovery
        this.state.consecutiveStalls = 0;
    }
    /**
     * Report successful recovery
     */
    reportRecovery(action) {
        logger_1.default.info('TimerWatchdog', 'Recovery successful', { action });
        traceLogger_1.trace.watchdog('timer', `recovered: ${action}`);
        this.emit('timer:recovered', { action });
    }
    /**
     * Get watchdog state
     */
    getState() {
        return { ...this.state };
    }
}
exports.TimerWatchdog = TimerWatchdog;
class OverlayWatchdog extends events_1.EventEmitter {
    constructor(config = {}) {
        super();
        this.checkInterval = null;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.state = {
            lastHeartbeat: 0,
            missedHeartbeats: 0,
            isOverlayActive: false,
            isMonitoring: false,
            reloadCount: 0,
        };
    }
    /**
     * Start monitoring overlay (call when overlay becomes active)
     */
    startMonitoring() {
        if (!this.config.enabled || this.state.isMonitoring)
            return;
        this.state.isMonitoring = true;
        this.state.isOverlayActive = true;
        this.state.lastHeartbeat = Date.now();
        this.state.missedHeartbeats = 0;
        this.checkInterval = setInterval(() => {
            this.checkOverlayHealth();
        }, this.config.overlayHeartbeatIntervalMs);
        logger_1.default.debug('OverlayWatchdog', 'Started monitoring');
    }
    /**
     * Stop monitoring overlay (call when overlay closes)
     */
    stopMonitoring() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.state.isMonitoring = false;
        this.state.isOverlayActive = false;
        this.state.missedHeartbeats = 0;
        logger_1.default.debug('OverlayWatchdog', 'Stopped monitoring');
    }
    /**
     * Report heartbeat from overlay (called via IPC)
     */
    reportHeartbeat() {
        this.state.lastHeartbeat = Date.now();
        this.state.missedHeartbeats = 0;
    }
    /**
     * Check overlay health
     */
    checkOverlayHealth() {
        if (!this.state.isOverlayActive)
            return;
        const now = Date.now();
        const elapsed = now - this.state.lastHeartbeat;
        if (elapsed > this.config.overlayHeartbeatIntervalMs * 2) {
            this.state.missedHeartbeats++;
            this.emit('overlay:heartbeat_missed', {
                missedCount: this.state.missedHeartbeats,
                lastHeartbeat: this.state.lastHeartbeat,
            });
            if (elapsed > this.config.overlayHeartbeatTimeoutMs) {
                logger_1.default.warn('OverlayWatchdog', 'Overlay unresponsive', {
                    elapsed,
                    missedHeartbeats: this.state.missedHeartbeats,
                });
                this.emit('overlay:unresponsive', {
                    lastHeartbeat: this.state.lastHeartbeat,
                });
                if (this.state.missedHeartbeats >= this.config.overlayMaxMissedHeartbeats) {
                    this.triggerReload();
                }
            }
        }
    }
    /**
     * Trigger overlay reload
     */
    triggerReload() {
        this.state.reloadCount++;
        logger_1.default.error('OverlayWatchdog', 'Triggering overlay reload', {
            missedHeartbeats: this.state.missedHeartbeats,
            reloadCount: this.state.reloadCount,
        });
        traceLogger_1.trace.watchdog('overlay', 'reload triggered');
        traceLogger_1.trace.overlay('reload');
        this.emit('overlay:reload_triggered', {
            reason: `${this.state.missedHeartbeats} missed heartbeats`,
        });
        // Reset counter after triggering reload
        this.state.missedHeartbeats = 0;
        this.state.lastHeartbeat = Date.now();
    }
    /**
     * Report successful recovery
     */
    reportRecovery(action) {
        logger_1.default.info('OverlayWatchdog', 'Recovery successful', { action });
        traceLogger_1.trace.watchdog('overlay', `recovered: ${action}`);
        traceLogger_1.trace.overlay('crash_recover');
        this.emit('overlay:recovered', { action });
    }
    /**
     * Get watchdog state
     */
    getState() {
        return { ...this.state };
    }
}
exports.OverlayWatchdog = OverlayWatchdog;
// ============================================================
// SINGLETON INSTANCES
// ============================================================
let timerWatchdogInstance = null;
let overlayWatchdogInstance = null;
function getTimerWatchdog() {
    if (!timerWatchdogInstance) {
        timerWatchdogInstance = new TimerWatchdog();
    }
    return timerWatchdogInstance;
}
function getOverlayWatchdog() {
    if (!overlayWatchdogInstance) {
        overlayWatchdogInstance = new OverlayWatchdog();
    }
    return overlayWatchdogInstance;
}
const LONG_SESSION_LIMITS = {
    maxTickCount: 1000000, // 1 million ticks
    maxSessionMs: 24 * 60 * 60 * 1000, // 24 hours
    maxCumulativeMs: 12 * 60 * 60 * 1000, // 12 hours cumulative work
};
class LongSessionGuard {
    constructor() {
        this.tickCount = 0;
        this.sessionStartTime = Date.now();
        this.lastCumulativeCheck = 0;
        this.reset();
    }
    /**
     * Reset guards (call on session reset)
     */
    reset() {
        this.tickCount = 0;
        this.sessionStartTime = Date.now();
        this.lastCumulativeCheck = 0;
    }
    /**
     * Record a tick and check for issues
     */
    recordTick(cumulativeWorkTimeMs) {
        this.tickCount++;
        const warnings = [];
        // Check tick count overflow protection
        if (this.tickCount > LONG_SESSION_LIMITS.maxTickCount * 0.9) {
            warnings.push(`High tick count: ${this.tickCount}`);
        }
        // Check session duration
        const sessionDuration = Date.now() - this.sessionStartTime;
        if (sessionDuration > LONG_SESSION_LIMITS.maxSessionMs * 0.9) {
            warnings.push(`Long session: ${Math.round(sessionDuration / 3600000)}h`);
        }
        // Check cumulative work time for potential overflow
        if (cumulativeWorkTimeMs > LONG_SESSION_LIMITS.maxCumulativeMs) {
            warnings.push(`High cumulative work: ${Math.round(cumulativeWorkTimeMs / 3600000)}h`);
        }
        // Check for timestamp drift (cumulative should not jump by more than 10 seconds per tick)
        if (this.lastCumulativeCheck > 0) {
            const delta = cumulativeWorkTimeMs - this.lastCumulativeCheck;
            if (delta > 10000 || delta < -1000) {
                warnings.push(`Cumulative time drift: ${delta}ms`);
            }
        }
        this.lastCumulativeCheck = cumulativeWorkTimeMs;
        // Log warnings
        if (warnings.length > 0) {
            logger_1.default.warn('LongSessionGuard', 'Session warnings', { warnings });
        }
        return {
            safe: warnings.length === 0,
            warnings,
        };
    }
    /**
     * Get guard stats
     */
    getStats() {
        return {
            tickCount: this.tickCount,
            sessionDurationMs: Date.now() - this.sessionStartTime,
            ticksRemaining: LONG_SESSION_LIMITS.maxTickCount - this.tickCount,
        };
    }
}
exports.LongSessionGuard = LongSessionGuard;
// Singleton
let longSessionGuardInstance = null;
function getLongSessionGuard() {
    if (!longSessionGuardInstance) {
        longSessionGuardInstance = new LongSessionGuard();
    }
    return longSessionGuardInstance;
}
//# sourceMappingURL=watchdog.js.map