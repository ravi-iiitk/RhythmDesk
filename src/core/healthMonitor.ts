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

import { EventEmitter } from 'events';
import logger from './logger';
import { getTimerWatchdog, getOverlayWatchdog } from './watchdog';
import { getFailsafeManager } from './failsafe';
import { getPerformanceGuard } from './failsafe';
import { trace } from './traceLogger';

// ============================================================
// HEALTH STATUS
// ============================================================

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message?: string;
  lastCheck: number;
}

export interface SystemHealth {
  overall: HealthStatus;
  checks: HealthCheckResult[];
  lastFullCheck: number;
  uptimeMs: number;
}

// ============================================================
// HEALTH MONITOR
// ============================================================

export interface HealthMonitorConfig {
  checkIntervalMs: number;
  enabled: boolean;
}

const DEFAULT_CONFIG: HealthMonitorConfig = {
  checkIntervalMs: 30000, // Check every 30 seconds
  enabled: true,
};

export class HealthMonitor extends EventEmitter {
  private config: HealthMonitorConfig;
  private checkInterval: NodeJS.Timeout | null = null;
  private startTime: number = Date.now();
  private lastHealth: SystemHealth | null = null;
  private isRunning: boolean = false;
  
  // Track consecutive failures for each check
  private failureCounts: Record<string, number> = {};
  private readonly maxFailures = 3;
  
  constructor(config: Partial<HealthMonitorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Start health monitoring
   */
  start(): void {
    if (!this.config.enabled || this.isRunning) return;
    
    this.isRunning = true;
    this.startTime = Date.now();
    
    // Run initial check
    this.runHealthChecks();
    
    // Schedule periodic checks
    this.checkInterval = setInterval(() => {
      this.runHealthChecks();
    }, this.config.checkIntervalMs);
    
    logger.info('HealthMonitor', 'Started', {
      checkIntervalMs: this.config.checkIntervalMs,
    });
  }
  
  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    logger.info('HealthMonitor', 'Stopped');
  }
  
  /**
   * Run all health checks
   */
  private runHealthChecks(): void {
    const checks: HealthCheckResult[] = [];
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
    
    let overall: HealthStatus = 'healthy';
    if (hasUnhealthy) {
      overall = 'unhealthy';
    } else if (hasDegraded) {
      overall = 'degraded';
    }
    
    const health: SystemHealth = {
      overall,
      checks,
      lastFullCheck: now,
      uptimeMs: now - this.startTime,
    };
    
    this.lastHealth = health;
    
    // Log if status changed
    if (overall !== 'healthy') {
      logger.warn('HealthMonitor', `System health: ${overall}`, {
        checks: checks.filter(c => c.status !== 'healthy'),
      });
      
      this.emit('health:degraded', health);
      
      // Attempt recovery for unhealthy checks
      for (const check of checks) {
        if (check.status === 'unhealthy') {
          this.attemptRecovery(check.name);
        }
      }
    } else {
      logger.debug('HealthMonitor', 'System healthy');
    }
  }
  
  /**
   * Check timer engine health
   */
  private checkTimerEngine(): HealthCheckResult {
    const timerWatchdog = getTimerWatchdog();
    const state = timerWatchdog.getState();
    
    let status: HealthStatus = 'healthy';
    let message: string | undefined;
    
    if (state.consecutiveStalls > 0) {
      if (state.consecutiveStalls >= 2) {
        status = 'unhealthy';
        message = `${state.consecutiveStalls} consecutive stalls`;
      } else {
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
  private checkOverlayHealth(): HealthCheckResult {
    const overlayWatchdog = getOverlayWatchdog();
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
    
    let status: HealthStatus = 'healthy';
    let message: string | undefined;
    
    if (state.isOverlayActive && state.missedHeartbeats > 0) {
      if (state.missedHeartbeats >= 3) {
        status = 'unhealthy';
        message = `${state.missedHeartbeats} missed heartbeats`;
      } else {
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
  private checkSessionState(): HealthCheckResult {
    const failsafe = getFailsafeManager();
    const state = failsafe.getState();
    
    let status: HealthStatus = 'healthy';
    let message: string | undefined;
    
    if (state.isInFailsafeMode) {
      status = 'unhealthy';
      message = 'Failsafe mode active';
    } else if (state.consecutiveValidationFailures > 0) {
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
  private checkPerformance(): HealthCheckResult {
    const perfGuard = getPerformanceGuard();
    const check = perfGuard.checkPerformance();
    
    let status: HealthStatus = 'healthy';
    let message: string | undefined;
    
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
  private attemptRecovery(checkName: string): void {
    this.failureCounts[checkName] = (this.failureCounts[checkName] || 0) + 1;
    
    if (this.failureCounts[checkName] >= this.maxFailures) {
      logger.error('HealthMonitor', `Too many failures for ${checkName} - triggering failsafe`);
      trace.recovery(`health_monitor:${checkName}`, { action: 'failsafe' });
      
      const failsafe = getFailsafeManager();
      failsafe.reportValidationFailure({ reason: `Health check failed: ${checkName}` });
      
      // Reset counter
      this.failureCounts[checkName] = 0;
    } else {
      logger.warn('HealthMonitor', `Recovery attempt for ${checkName}`, {
        attempt: this.failureCounts[checkName],
      });
      
      trace.recovery(`health_monitor:${checkName}`, { 
        action: 'attempt',
        attempt: this.failureCounts[checkName],
      });
    }
  }
  
  /**
   * Reset failure count for a check (call on successful recovery)
   */
  resetFailureCount(checkName: string): void {
    this.failureCounts[checkName] = 0;
  }
  
  /**
   * Get current health status
   */
  getHealth(): SystemHealth | null {
    return this.lastHealth;
  }
  
  /**
   * Get uptime in milliseconds
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }
  
  /**
   * Check if running
   */
  isHealthy(): boolean {
    return this.lastHealth?.overall === 'healthy';
  }
}

// ============================================================
// SINGLETON
// ============================================================

let healthMonitorInstance: HealthMonitor | null = null;

export function getHealthMonitor(): HealthMonitor {
  if (!healthMonitorInstance) {
    healthMonitorInstance = new HealthMonitor();
  }
  return healthMonitorInstance;
}
