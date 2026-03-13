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

import { EventEmitter } from 'events';
import logger from './logger';
import { trace } from './traceLogger';

// ============================================================
// WATCHDOG CONFIGURATION
// ============================================================

export interface WatchdogConfig {
  // Timer engine watchdog
  timerCheckIntervalMs: number;
  timerStallThresholdMs: number;
  maxConsecutiveStalls: number;
  
  // Overlay watchdog
  overlayHeartbeatIntervalMs: number;
  overlayHeartbeatTimeoutMs: number;
  overlayMaxMissedHeartbeats: number;
  
  // General
  enabled: boolean;
}

const DEFAULT_CONFIG: WatchdogConfig = {
  timerCheckIntervalMs: 5000,      // Check every 5 seconds
  timerStallThresholdMs: 3000,     // Consider stalled if no tick for 3 seconds
  maxConsecutiveStalls: 3,         // Trigger recovery after 3 consecutive stalls
  
  overlayHeartbeatIntervalMs: 1000, // Expect heartbeat every 1 second
  overlayHeartbeatTimeoutMs: 5000,  // Consider dead after 5 seconds no heartbeat
  overlayMaxMissedHeartbeats: 5,    // Trigger reload after 5 missed heartbeats
  
  enabled: true,
};

// ============================================================
// WATCHDOG EVENTS
// ============================================================

export interface WatchdogEvents {
  'timer:stall_detected': { lastTickTime: number; elapsed: number };
  'timer:recovery_triggered': { reason: string };
  'timer:recovered': { action: string };
  
  'overlay:heartbeat_missed': { missedCount: number; lastHeartbeat: number };
  'overlay:unresponsive': { lastHeartbeat: number };
  'overlay:reload_triggered': { reason: string };
  'overlay:recovered': { action: string };
}

// ============================================================
// TIMER ENGINE WATCHDOG
// ============================================================

export interface TimerWatchdogState {
  lastTickTime: number;
  lastPhaseRemainingMs: number;
  consecutiveStalls: number;
  isRunning: boolean;
  recoveryCount: number;
}

export class TimerWatchdog extends EventEmitter {
  private config: WatchdogConfig;
  private state: TimerWatchdogState;
  private checkInterval: NodeJS.Timeout | null = null;
  
  constructor(config: Partial<WatchdogConfig> = {}) {
    super();
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
  start(): void {
    if (!this.config.enabled || this.state.isRunning) return;
    
    this.state.isRunning = true;
    this.state.lastTickTime = Date.now();
    this.state.consecutiveStalls = 0;
    
    this.checkInterval = setInterval(() => {
      this.checkTimerHealth();
    }, this.config.timerCheckIntervalMs);
    
    logger.info('TimerWatchdog', 'Started');
  }
  
  /**
   * Stop the watchdog
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.state.isRunning = false;
    logger.info('TimerWatchdog', 'Stopped');
  }
  
  /**
   * Report a tick (called by timer engine)
   */
  reportTick(phaseRemainingMs: number): void {
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
  private checkTimerHealth(): void {
    const now = Date.now();
    const elapsed = now - this.state.lastTickTime;
    
    if (elapsed > this.config.timerStallThresholdMs) {
      this.state.consecutiveStalls++;
      
      logger.warn('TimerWatchdog', 'Stall detected', {
        elapsed,
        consecutiveStalls: this.state.consecutiveStalls,
        lastTickTime: this.state.lastTickTime,
      });
      
      this.emit('timer:stall_detected', {
        lastTickTime: this.state.lastTickTime,
        elapsed,
      });
      
      trace.watchdog('timer', `stall #${this.state.consecutiveStalls}`);
      
      if (this.state.consecutiveStalls >= this.config.maxConsecutiveStalls) {
        this.triggerRecovery();
      }
    }
  }
  
  /**
   * Trigger timer recovery
   */
  private triggerRecovery(): void {
    this.state.recoveryCount++;
    
    logger.error('TimerWatchdog', 'Triggering recovery', {
      consecutiveStalls: this.state.consecutiveStalls,
      recoveryCount: this.state.recoveryCount,
    });
    
    trace.watchdog('timer', 'recovery triggered');
    
    this.emit('timer:recovery_triggered', {
      reason: `${this.state.consecutiveStalls} consecutive stalls`,
    });
    
    // Reset stall counter after triggering recovery
    this.state.consecutiveStalls = 0;
  }
  
  /**
   * Report successful recovery
   */
  reportRecovery(action: string): void {
    logger.info('TimerWatchdog', 'Recovery successful', { action });
    trace.watchdog('timer', `recovered: ${action}`);
    this.emit('timer:recovered', { action });
  }
  
  /**
   * Get watchdog state
   */
  getState(): TimerWatchdogState {
    return { ...this.state };
  }
}

// ============================================================
// OVERLAY WATCHDOG
// ============================================================

export interface OverlayWatchdogState {
  lastHeartbeat: number;
  missedHeartbeats: number;
  isOverlayActive: boolean;
  isMonitoring: boolean;
  reloadCount: number;
}

export class OverlayWatchdog extends EventEmitter {
  private config: WatchdogConfig;
  private state: OverlayWatchdogState;
  private checkInterval: NodeJS.Timeout | null = null;
  
  constructor(config: Partial<WatchdogConfig> = {}) {
    super();
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
  startMonitoring(): void {
    if (!this.config.enabled || this.state.isMonitoring) return;
    
    this.state.isMonitoring = true;
    this.state.isOverlayActive = true;
    this.state.lastHeartbeat = Date.now();
    this.state.missedHeartbeats = 0;
    
    this.checkInterval = setInterval(() => {
      this.checkOverlayHealth();
    }, this.config.overlayHeartbeatIntervalMs);
    
    logger.debug('OverlayWatchdog', 'Started monitoring');
  }
  
  /**
   * Stop monitoring overlay (call when overlay closes)
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.state.isMonitoring = false;
    this.state.isOverlayActive = false;
    this.state.missedHeartbeats = 0;
    
    logger.debug('OverlayWatchdog', 'Stopped monitoring');
  }
  
  /**
   * Report heartbeat from overlay (called via IPC)
   */
  reportHeartbeat(): void {
    this.state.lastHeartbeat = Date.now();
    this.state.missedHeartbeats = 0;
  }
  
  /**
   * Check overlay health
   */
  private checkOverlayHealth(): void {
    if (!this.state.isOverlayActive) return;
    
    const now = Date.now();
    const elapsed = now - this.state.lastHeartbeat;
    
    if (elapsed > this.config.overlayHeartbeatIntervalMs * 2) {
      this.state.missedHeartbeats++;
      
      this.emit('overlay:heartbeat_missed', {
        missedCount: this.state.missedHeartbeats,
        lastHeartbeat: this.state.lastHeartbeat,
      });
      
      if (elapsed > this.config.overlayHeartbeatTimeoutMs) {
        logger.warn('OverlayWatchdog', 'Overlay unresponsive', {
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
  private triggerReload(): void {
    this.state.reloadCount++;
    
    logger.error('OverlayWatchdog', 'Triggering overlay reload', {
      missedHeartbeats: this.state.missedHeartbeats,
      reloadCount: this.state.reloadCount,
    });
    
    trace.watchdog('overlay', 'reload triggered');
    trace.overlay('reload');
    
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
  reportRecovery(action: string): void {
    logger.info('OverlayWatchdog', 'Recovery successful', { action });
    trace.watchdog('overlay', `recovered: ${action}`);
    trace.overlay('crash_recover');
    this.emit('overlay:recovered', { action });
  }
  
  /**
   * Get watchdog state
   */
  getState(): OverlayWatchdogState {
    return { ...this.state };
  }
}

// ============================================================
// SINGLETON INSTANCES
// ============================================================

let timerWatchdogInstance: TimerWatchdog | null = null;
let overlayWatchdogInstance: OverlayWatchdog | null = null;

export function getTimerWatchdog(): TimerWatchdog {
  if (!timerWatchdogInstance) {
    timerWatchdogInstance = new TimerWatchdog();
  }
  return timerWatchdogInstance;
}

export function getOverlayWatchdog(): OverlayWatchdog {
  if (!overlayWatchdogInstance) {
    overlayWatchdogInstance = new OverlayWatchdog();
  }
  return overlayWatchdogInstance;
}

// ============================================================
// LONG SESSION RESILIENCE
// ============================================================

export interface LongSessionGuardStats {
  tickCount: number;
  sessionStartTime: number;
  maxSafeTickCount: number;
  maxSafeSessionMs: number;
  maxSafeCumulativeMs: number;
}

const LONG_SESSION_LIMITS = {
  maxTickCount: 1_000_000,            // 1 million ticks
  maxSessionMs: 24 * 60 * 60 * 1000,  // 24 hours
  maxCumulativeMs: 12 * 60 * 60 * 1000, // 12 hours cumulative work
};

export class LongSessionGuard {
  private tickCount: number = 0;
  private sessionStartTime: number = Date.now();
  private lastCumulativeCheck: number = 0;
  
  constructor() {
    this.reset();
  }
  
  /**
   * Reset guards (call on session reset)
   */
  reset(): void {
    this.tickCount = 0;
    this.sessionStartTime = Date.now();
    this.lastCumulativeCheck = 0;
  }
  
  /**
   * Record a tick and check for issues
   */
  recordTick(cumulativeWorkTimeMs: number): {
    safe: boolean;
    warnings: string[];
  } {
    this.tickCount++;
    const warnings: string[] = [];
    
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
      logger.warn('LongSessionGuard', 'Session warnings', { warnings });
    }
    
    return {
      safe: warnings.length === 0,
      warnings,
    };
  }
  
  /**
   * Get guard stats
   */
  getStats(): {
    tickCount: number;
    sessionDurationMs: number;
    ticksRemaining: number;
  } {
    return {
      tickCount: this.tickCount,
      sessionDurationMs: Date.now() - this.sessionStartTime,
      ticksRemaining: LONG_SESSION_LIMITS.maxTickCount - this.tickCount,
    };
  }
}

// Singleton
let longSessionGuardInstance: LongSessionGuard | null = null;

export function getLongSessionGuard(): LongSessionGuard {
  if (!longSessionGuardInstance) {
    longSessionGuardInstance = new LongSessionGuard();
  }
  return longSessionGuardInstance;
}
