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

import { SessionState, Schedule, INITIAL_SESSION_STATE } from '../shared/types';
import { computeResetState } from './transitions';
import logger from './logger';
import { trace } from './traceLogger';

// ============================================================
// FAILSAFE CONFIGURATION
// ============================================================

export interface FailsafeConfig {
  // Maximum consecutive validation failures before failsafe
  maxValidationFailures: number;
  
  // Maximum consecutive normalization attempts
  maxNormalizationAttempts: number;
  
  // Maximum recovery attempts per session
  maxRecoveryAttemptsPerSession: number;
  
  // Cooldown between failsafe triggers (ms)
  failsafeCooldownMs: number;
}

const DEFAULT_CONFIG: FailsafeConfig = {
  maxValidationFailures: 5,
  maxNormalizationAttempts: 3,
  maxRecoveryAttemptsPerSession: 10,
  failsafeCooldownMs: 60000, // 1 minute
};

// ============================================================
// FAILSAFE STATE
// ============================================================

export interface FailsafeState {
  consecutiveValidationFailures: number;
  consecutiveNormalizationAttempts: number;
  recoveryAttemptsThisSession: number;
  lastFailsafeTime: number;
  totalFailsafeCount: number;
  isInFailsafeMode: boolean;
}

// ============================================================
// FAILSAFE RESULT
// ============================================================

export interface FailsafeResult {
  triggered: boolean;
  action: 'none' | 'normalize' | 'reset' | 'force_idle';
  newState: SessionState | null;
  reason: string;
  userMessage: string | null;
}

// ============================================================
// FAILSAFE MANAGER
// ============================================================

export class FailsafeManager {
  private config: FailsafeConfig;
  private state: FailsafeState;
  
  constructor(config: Partial<FailsafeConfig> = {}) {
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
  reportValidationFailure(details?: Record<string, unknown>): void {
    this.state.consecutiveValidationFailures++;
    
    logger.warn('Failsafe', 'Validation failure reported', {
      consecutiveFailures: this.state.consecutiveValidationFailures,
      ...details,
    });
    
    trace.invariantViolation('validation_failure', details);
  }
  
  /**
   * Report successful validation (resets failure counter)
   */
  reportValidationSuccess(): void {
    if (this.state.consecutiveValidationFailures > 0) {
      logger.debug('Failsafe', 'Validation recovered', {
        previousFailures: this.state.consecutiveValidationFailures,
      });
    }
    this.state.consecutiveValidationFailures = 0;
    this.state.consecutiveNormalizationAttempts = 0;
  }
  
  /**
   * Report a normalization attempt
   */
  reportNormalizationAttempt(success: boolean): void {
    if (success) {
      this.state.consecutiveNormalizationAttempts = 0;
    } else {
      this.state.consecutiveNormalizationAttempts++;
      logger.warn('Failsafe', 'Normalization failed', {
        attempts: this.state.consecutiveNormalizationAttempts,
      });
    }
  }
  
  /**
   * Check if failsafe should trigger and return appropriate action
   */
  checkFailsafe(
    currentState: SessionState,
    schedule: Schedule | null
  ): FailsafeResult {
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
  private triggerReset(
    _currentState: SessionState,
    schedule: Schedule | null,
    reason: string
  ): FailsafeResult {
    this.state.lastFailsafeTime = Date.now();
    this.state.totalFailsafeCount++;
    this.state.recoveryAttemptsThisSession++;
    this.state.isInFailsafeMode = true;
    
    logger.error('Failsafe', 'FAILSAFE TRIGGERED - Resetting session', {
      reason,
      totalFailsafeCount: this.state.totalFailsafeCount,
      validationFailures: this.state.consecutiveValidationFailures,
      normalizationAttempts: this.state.consecutiveNormalizationAttempts,
    });
    
    trace.reset(`failsafe: ${reason}`);
    
    if (!schedule) {
      return this.forceIdle(reason);
    }
    
    // Compute clean reset state
    const resetState = computeResetState(schedule);
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];
    
    const newState: SessionState = {
      ...INITIAL_SESSION_STATE,
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
  private forceIdle(reason: string): FailsafeResult {
    this.state.lastFailsafeTime = Date.now();
    this.state.totalFailsafeCount++;
    this.state.isInFailsafeMode = true;
    
    logger.error('Failsafe', 'FAILSAFE: Forcing idle state', { reason });
    trace.reset(`failsafe-idle: ${reason}`);
    
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];
    
    const newState: SessionState = {
      ...INITIAL_SESSION_STATE,
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
  resetSessionCounters(): void {
    this.state.recoveryAttemptsThisSession = 0;
    this.state.consecutiveValidationFailures = 0;
    this.state.consecutiveNormalizationAttempts = 0;
    this.state.isInFailsafeMode = false;
  }
  
  /**
   * Get failsafe state
   */
  getState(): FailsafeState {
    return { ...this.state };
  }
  
  /**
   * Check if in failsafe mode
   */
  isInFailsafeMode(): boolean {
    return this.state.isInFailsafeMode;
  }
  
  /**
   * Clear failsafe mode
   */
  clearFailsafeMode(): void {
    this.state.isInFailsafeMode = false;
  }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

let failsafeManagerInstance: FailsafeManager | null = null;

export function getFailsafeManager(): FailsafeManager {
  if (!failsafeManagerInstance) {
    failsafeManagerInstance = new FailsafeManager();
  }
  return failsafeManagerInstance;
}

// ============================================================
// PERFORMANCE GUARDS
// ============================================================

export interface PerformanceMetrics {
  tickHandlerAvgMs: number;
  tickHandlerMaxMs: number;
  trayUpdateCount: number;
  overlayRefreshCount: number;
  snapshotWriteCount: number;
  lastMetricsReset: number;
}

export class PerformanceGuard {
  private tickDurations: number[] = [];
  private trayUpdateCount: number = 0;
  private overlayRefreshCount: number = 0;
  private snapshotWriteCount: number = 0;
  private lastMetricsReset: number = Date.now();
  private readonly maxSamples = 100;
  
  // Thresholds
  private readonly tickThresholdMs = 50;        // Warn if tick takes >50ms
  private readonly trayUpdateThresholdPerMin = 60; // Warn if >60 tray updates/min
  private readonly snapshotThresholdPerMin = 20;   // Warn if >20 snapshots/min
  
  /**
   * Record tick handler duration
   */
  recordTickDuration(durationMs: number): void {
    this.tickDurations.push(durationMs);
    if (this.tickDurations.length > this.maxSamples) {
      this.tickDurations.shift();
    }
    
    if (durationMs > this.tickThresholdMs) {
      logger.warn('PerformanceGuard', 'Slow tick handler', { durationMs });
    }
  }
  
  /**
   * Record tray update
   */
  recordTrayUpdate(): void {
    this.trayUpdateCount++;
  }
  
  /**
   * Record overlay refresh
   */
  recordOverlayRefresh(): void {
    this.overlayRefreshCount++;
  }
  
  /**
   * Record snapshot write
   */
  recordSnapshotWrite(): void {
    this.snapshotWriteCount++;
  }
  
  /**
   * Get performance metrics
   */
  getMetrics(): PerformanceMetrics {
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
  checkPerformance(): { healthy: boolean; warnings: string[] } {
    const warnings: string[] = [];
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
  reset(): void {
    this.tickDurations = [];
    this.trayUpdateCount = 0;
    this.overlayRefreshCount = 0;
    this.snapshotWriteCount = 0;
    this.lastMetricsReset = Date.now();
  }
}

// Singleton
let performanceGuardInstance: PerformanceGuard | null = null;

export function getPerformanceGuard(): PerformanceGuard {
  if (!performanceGuardInstance) {
    performanceGuardInstance = new PerformanceGuard();
  }
  return performanceGuardInstance;
}
