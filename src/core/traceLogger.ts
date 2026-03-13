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

import { PhaseType } from '../shared/types';
import logger from './logger';

// ============================================================
// TRACE CONFIGURATION
// ============================================================

export interface TraceConfig {
  enabled: boolean;
  maxEntries: number;
  includeTimestamps: boolean;
  includePhaseMs: boolean;
}

const DEFAULT_TRACE_CONFIG: TraceConfig = {
  enabled: process.env.NODE_ENV === 'development',
  maxEntries: 1000,
  includeTimestamps: true,
  includePhaseMs: true,
};

// ============================================================
// TRACE ENTRY TYPES
// ============================================================

export type TraceEventType = 
  | 'phase_change'
  | 'skip'
  | 'postpone'
  | 'postpone_resume'
  | 'break_start'
  | 'break_end'
  | 'reset'
  | 'pause'
  | 'resume'
  | 'recovery'
  | 'schedule_change'
  | 'flow_stale'
  | 'invariant_violation'
  | 'watchdog_trigger'
  | 'overlay_action'
  | 'tick';

export interface TraceEntry {
  timestamp: number;
  event: TraceEventType;
  message: string;
  data?: Record<string, unknown>;
}

// ============================================================
// TRACE LOGGER
// ============================================================

class TraceLogger {
  private config: TraceConfig;
  private entries: TraceEntry[] = [];
  private tickCount: number = 0;
  private sessionStartTime: number = Date.now();
  
  constructor(config: Partial<TraceConfig> = {}) {
    this.config = { ...DEFAULT_TRACE_CONFIG, ...config };
  }
  
  /**
   * Enable or disable tracing
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (enabled) {
      this.log('system', 'Trace logging enabled');
    }
  }
  
  /**
   * Check if tracing is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
  
  /**
   * Log a trace entry
   */
  private log(event: TraceEventType | 'system', message: string, data?: Record<string, unknown>): void {
    if (!this.config.enabled && event !== 'system') return;
    
    const entry: TraceEntry = {
      timestamp: Date.now(),
      event: event as TraceEventType,
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
    
    logger.debug('TRACE', `[TRACE] ${timeStr} ${message}`, data);
  }
  
  // ============================================================
  // TRACE EVENT METHODS
  // ============================================================
  
  /**
   * Log phase change
   */
  tracePhaseChange(fromPhase: PhaseType, toPhase: PhaseType, flowIndex?: number): void {
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
  traceSkip(fromPhase: PhaseType, toPhase: PhaseType): void {
    this.log('skip', `skip ${fromPhase} → ${toPhase}`, { fromPhase, toPhase });
  }
  
  /**
   * Log postpone action
   */
  tracePostpone(breakType: PhaseType, minutes: number): void {
    this.log('postpone', `break=${breakType} postponed ${minutes}min`, { breakType, minutes });
  }
  
  /**
   * Log postpone resume
   */
  tracePostponeResume(breakType: PhaseType): void {
    this.log('postpone_resume', `break=${breakType} resumed`, { breakType });
  }
  
  /**
   * Log break start
   */
  traceBreakStart(breakType: PhaseType, interruptedPhase: PhaseType | null): void {
    this.log('break_start', `break=${breakType} started`, { breakType, interruptedPhase });
  }
  
  /**
   * Log break end
   */
  traceBreakEnd(breakType: PhaseType, resumePhase: PhaseType): void {
    this.log('break_end', `break=${breakType} ended → ${resumePhase}`, { breakType, resumePhase });
  }
  
  /**
   * Log session reset
   */
  traceReset(reason?: string): void {
    this.log('reset', `reset session${reason ? ` (${reason})` : ''}`, { reason });
  }
  
  /**
   * Log pause
   */
  tracePause(): void {
    this.log('pause', 'session paused');
  }
  
  /**
   * Log resume
   */
  traceResume(): void {
    this.log('resume', 'session resumed');
  }
  
  /**
   * Log recovery
   */
  traceRecovery(action: string, details?: Record<string, unknown>): void {
    this.log('recovery', `recovery: ${action}`, details);
  }
  
  /**
   * Log schedule change
   */
  traceScheduleChange(scheduleId: string | null, action: 'activated' | 'deactivated' | 'edited'): void {
    this.log('schedule_change', `schedule ${action}: ${scheduleId || 'none'}`, { scheduleId, action });
  }
  
  /**
   * Log flow stale detection
   */
  traceFlowStale(): void {
    this.log('flow_stale', 'flow config stale (pending reset)');
  }
  
  /**
   * Log invariant violation
   */
  traceInvariantViolation(invariant: string, details?: Record<string, unknown>): void {
    this.log('invariant_violation', `invariant: ${invariant}`, details);
  }
  
  /**
   * Log watchdog trigger
   */
  traceWatchdogTrigger(type: 'timer' | 'overlay', action: string): void {
    this.log('watchdog_trigger', `watchdog:${type} → ${action}`, { type, action });
  }
  
  /**
   * Log overlay action
   */
  traceOverlayAction(action: 'show' | 'hide' | 'reload' | 'crash_recover'): void {
    this.log('overlay_action', `overlay:${action}`);
  }
  
  /**
   * Log tick (compact - only every N ticks)
   */
  traceTick(phaseRemainingMs: number): void {
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
  getEntries(): TraceEntry[] {
    return [...this.entries];
  }
  
  /**
   * Get recent entries
   */
  getRecentEntries(count: number = 50): TraceEntry[] {
    return this.entries.slice(-count);
  }
  
  /**
   * Get entries by event type
   */
  getEntriesByType(type: TraceEventType): TraceEntry[] {
    return this.entries.filter(e => e.event === type);
  }
  
  /**
   * Get entries since timestamp
   */
  getEntriesSince(timestamp: number): TraceEntry[] {
    return this.entries.filter(e => e.timestamp >= timestamp);
  }
  
  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
    this.tickCount = 0;
  }
  
  /**
   * Reset session start time (call on session reset)
   */
  resetSessionTime(): void {
    this.sessionStartTime = Date.now();
    this.tickCount = 0;
  }
  
  /**
   * Get session stats
   */
  getStats(): {
    totalEntries: number;
    tickCount: number;
    sessionDurationMs: number;
    entriesByType: Record<string, number>;
  } {
    const entriesByType: Record<string, number> = {};
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
  formatTimeline(maxEntries: number = 100): string {
    const entries = this.getRecentEntries(maxEntries);
    const lines: string[] = [];
    
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

let traceLoggerInstance: TraceLogger | null = null;

export function getTraceLogger(): TraceLogger {
  if (!traceLoggerInstance) {
    traceLoggerInstance = new TraceLogger();
  }
  return traceLoggerInstance;
}

export function enableTracing(enabled: boolean = true): void {
  getTraceLogger().setEnabled(enabled);
}

export function isTracingEnabled(): boolean {
  return getTraceLogger().isEnabled();
}

// Export trace methods for convenience
export const trace = {
  phaseChange: (from: PhaseType, to: PhaseType, idx?: number) => 
    getTraceLogger().tracePhaseChange(from, to, idx),
  skip: (from: PhaseType, to: PhaseType) => 
    getTraceLogger().traceSkip(from, to),
  postpone: (breakType: PhaseType, minutes: number) => 
    getTraceLogger().tracePostpone(breakType, minutes),
  postponeResume: (breakType: PhaseType) => 
    getTraceLogger().tracePostponeResume(breakType),
  breakStart: (breakType: PhaseType, interrupted: PhaseType | null) => 
    getTraceLogger().traceBreakStart(breakType, interrupted),
  breakEnd: (breakType: PhaseType, resume: PhaseType) => 
    getTraceLogger().traceBreakEnd(breakType, resume),
  reset: (reason?: string) => 
    getTraceLogger().traceReset(reason),
  pause: () => 
    getTraceLogger().tracePause(),
  resume: () => 
    getTraceLogger().traceResume(),
  recovery: (action: string, details?: Record<string, unknown>) => 
    getTraceLogger().traceRecovery(action, details),
  scheduleChange: (id: string | null, action: 'activated' | 'deactivated' | 'edited') => 
    getTraceLogger().traceScheduleChange(id, action),
  flowStale: () => 
    getTraceLogger().traceFlowStale(),
  invariantViolation: (inv: string, details?: Record<string, unknown>) => 
    getTraceLogger().traceInvariantViolation(inv, details),
  watchdog: (type: 'timer' | 'overlay', action: string) => 
    getTraceLogger().traceWatchdogTrigger(type, action),
  overlay: (action: 'show' | 'hide' | 'reload' | 'crash_recover') => 
    getTraceLogger().traceOverlayAction(action),
  tick: (remaining: number) => 
    getTraceLogger().traceTick(remaining),
};
