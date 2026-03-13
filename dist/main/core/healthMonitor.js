"use strict";
/**
 * RhythmDesk Health Monitor - Phase 5 Stability Lockdown
 *
 * Lightweight runtime health monitor that checks system health
 * every N seconds and triggers recovery on anomalies.
 *
 * CHECKS:
 * - Timer engine alive (ticks occurring)
 * - Overlay window responsive
 * - Session state valid
 * - Snapshot persistence functioning
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthMonitor = void 0;
exports.getHealthMonitor = getHealthMonitor;
const events_1 = require("events");
const logger_1 = __importDefault(require("./logger"));
const watchdog_1 = require("./watchdog");
const failsafe_1 = require("./failsafe");
const failsafe_2 = require("./failsafe");
const traceLogger_1 = require("./traceLogger");
const DEFAULT_CONFIG = {
    checkIntervalMs: 30000, // Check every 30 seconds
    enabled: true,
};
class HealthMonitor extends events_1.EventEmitter {
    constructor(config = {}) {
        super();
        this.checkInterval = null;
        this.startTime = Date.now();
        this.lastHealth = null;
        this.isRunning = false;
        // Track consecutive failures for each check
        this.failureCounts = {};
        this.maxFailures = 3;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Start health monitoring
     */
    start() {
        if (!this.config.enabled || this.isRunning)
            return;
        this.isRunning = true;
        this.startTime = Date.now();
        // Run initial check
        this.runHealthChecks();
        // Schedule periodic checks
        this.checkInterval = setInterval(() => {
            this.runHealthChecks();
        }, this.config.checkIntervalMs);
        logger_1.default.info('HealthMonitor', 'Started', {
            checkIntervalMs: this.config.checkIntervalMs,
        });
    }
    /**
     * Stop health monitoring
     */
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.isRunning = false;
        logger_1.default.info('HealthMonitor', 'Stopped');
    }
    /**
     * Run all health checks
     */
    runHealthChecks() {
        const checks = [];
        const now = Date.now();
        // Check 1: Timer engine
        checks.push(this.checkTimerEngine());
        // Check 2: Overlay watchdog
        checks.push(this.checkOverlayHealth());
        // Check 3: Session state
        checks.push(this.checkSessionState());
        // Check 4: Performance
        checks.push(this.checkPerformance());
        // Calculate overall status
        const hasUnhealthy = checks.some(c => c.status === 'unhealthy');
        const hasDegraded = checks.some(c => c.status === 'degraded');
        let overall = 'healthy';
        if (hasUnhealthy) {
            overall = 'unhealthy';
        }
        else if (hasDegraded) {
            overall = 'degraded';
        }
        const health = {
            overall,
            checks,
            lastFullCheck: now,
            uptimeMs: now - this.startTime,
        };
        this.lastHealth = health;
        // Log if status changed
        if (overall !== 'healthy') {
            logger_1.default.warn('HealthMonitor', `System health: ${overall}`, {
                checks: checks.filter(c => c.status !== 'healthy'),
            });
            this.emit('health:degraded', health);
            // Attempt recovery for unhealthy checks
            for (const check of checks) {
                if (check.status === 'unhealthy') {
                    this.attemptRecovery(check.name);
                }
            }
        }
        else {
            logger_1.default.debug('HealthMonitor', 'System healthy');
        }
    }
    /**
     * Check timer engine health
     */
    checkTimerEngine() {
        const timerWatchdog = (0, watchdog_1.getTimerWatchdog)();
        const state = timerWatchdog.getState();
        let status = 'healthy';
        let message;
        if (state.consecutiveStalls > 0) {
            if (state.consecutiveStalls >= 2) {
                status = 'unhealthy';
                message = `${state.consecutiveStalls} consecutive stalls`;
            }
            else {
                status = 'degraded';
                message = 'Timer stall detected';
            }
        }
        return {
            name: 'timer_engine',
            status,
            message,
            lastCheck: Date.now(),
        };
    }
    /**
     * Check overlay health
     * NOTE: OverlayWatchdog is currently disabled for regular overlays due to
     * infinite reload loops. The OverlaySyncService handles rest block monitoring.
     * This check now only reports issues when the watchdog is actively monitoring.
     */
    checkOverlayHealth() {
        const overlayWatchdog = (0, watchdog_1.getOverlayWatchdog)();
        const state = overlayWatchdog.getState();
        // Only check if watchdog is actively monitoring (i.e., isMonitoring is true)
        // If not monitoring, always report healthy
        if (!state.isMonitoring) {
            return {
                name: 'overlay',
                status: 'healthy',
                lastCheck: Date.now(),
            };
        }
        let status = 'healthy';
        let message;
        if (state.isOverlayActive && state.missedHeartbeats > 0) {
            if (state.missedHeartbeats >= 3) {
                status = 'unhealthy';
                message = `${state.missedHeartbeats} missed heartbeats`;
            }
            else {
                status = 'degraded';
                message = 'Overlay heartbeat delayed';
            }
        }
        return {
            name: 'overlay',
            status,
            message,
            lastCheck: Date.now(),
        };
    }
    /**
     * Check session state
     */
    checkSessionState() {
        const failsafe = (0, failsafe_1.getFailsafeManager)();
        const state = failsafe.getState();
        let status = 'healthy';
        let message;
        if (state.isInFailsafeMode) {
            status = 'unhealthy';
            message = 'Failsafe mode active';
        }
        else if (state.consecutiveValidationFailures > 0) {
            status = 'degraded';
            message = `${state.consecutiveValidationFailures} validation failures`;
        }
        return {
            name: 'session_state',
            status,
            message,
            lastCheck: Date.now(),
        };
    }
    /**
     * Check performance
     */
    checkPerformance() {
        const perfGuard = (0, failsafe_2.getPerformanceGuard)();
        const check = perfGuard.checkPerformance();
        let status = 'healthy';
        let message;
        if (!check.healthy) {
            status = 'degraded';
            message = check.warnings.join(', ');
        }
        return {
            name: 'performance',
            status,
            message,
            lastCheck: Date.now(),
        };
    }
    /**
     * Attempt recovery for a failed check
     */
    attemptRecovery(checkName) {
        this.failureCounts[checkName] = (this.failureCounts[checkName] || 0) + 1;
        if (this.failureCounts[checkName] >= this.maxFailures) {
            logger_1.default.error('HealthMonitor', `Too many failures for ${checkName} - triggering failsafe`);
            traceLogger_1.trace.recovery(`health_monitor:${checkName}`, { action: 'failsafe' });
            const failsafe = (0, failsafe_1.getFailsafeManager)();
            failsafe.reportValidationFailure({ reason: `Health check failed: ${checkName}` });
            // Reset counter
            this.failureCounts[checkName] = 0;
        }
        else {
            logger_1.default.warn('HealthMonitor', `Recovery attempt for ${checkName}`, {
                attempt: this.failureCounts[checkName],
            });
            traceLogger_1.trace.recovery(`health_monitor:${checkName}`, {
                action: 'attempt',
                attempt: this.failureCounts[checkName],
            });
        }
    }
    /**
     * Reset failure count for a check (call on successful recovery)
     */
    resetFailureCount(checkName) {
        this.failureCounts[checkName] = 0;
    }
    /**
     * Get current health status
     */
    getHealth() {
        return this.lastHealth;
    }
    /**
     * Get uptime in milliseconds
     */
    getUptime() {
        return Date.now() - this.startTime;
    }
    /**
     * Check if running
     */
    isHealthy() {
        return this.lastHealth?.overall === 'healthy';
    }
}
exports.HealthMonitor = HealthMonitor;
// ============================================================
// SINGLETON
// ============================================================
let healthMonitorInstance = null;
function getHealthMonitor() {
    if (!healthMonitorInstance) {
        healthMonitorInstance = new HealthMonitor();
    }
    return healthMonitorInstance;
}
//# sourceMappingURL=healthMonitor.js.map