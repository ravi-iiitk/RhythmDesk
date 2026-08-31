/**
 * ActivityLogService - Records user-facing activity log entries
 * 
 * Provides simple logging functions called from main.ts and IPC handlers.
 * Each function creates a human-readable log entry for the Activity Log page.
 */

import { v4 as uuidv4 } from 'uuid';
import { ActivityLogEntry, ActivityLogEventType, PhaseType } from '../shared/types';
import { activityLogStore } from './storage/activityLogStore';
import { PHASE_DISPLAY_NAMES } from '../shared/constants';

/**
 * Get a human-readable title for an event
 */
function getEventTitle(event: ActivityLogEventType, phase?: PhaseType, extra?: string): string {
  const phaseName = phase ? (PHASE_DISPLAY_NAMES[phase] || phase) : '';
  
  switch (event) {
    case 'schedule_started': return `Schedule Started${extra ? `: ${extra}` : ''}`;
    case 'schedule_stopped': return 'Schedule Stopped';
    case 'phase_started': return `${phaseName} Started`;
    case 'phase_completed': return `${phaseName} Completed`;
    case 'break_started': return `${phaseName || 'Break'} Started`;
    case 'break_completed': return `${phaseName || 'Break'} Completed`;
    case 'break_skipped': return `${phaseName || 'Break'} Skipped`;
    case 'break_postponed': return `Break Postponed${extra ? ` (${extra})` : ''}`;
    case 'session_reset': return 'Session Reset';
    case 'session_paused': return 'Schedule Paused';
    case 'session_resumed': return 'Schedule Resumed';
    case 'flow_shuffled': return 'Flow Order Shuffled';
    case 'flow_reversed': return 'Flow Order Reversed';
    case 'flow_order_applied': return 'Flow Order Applied';
    case 'focus_lock_started': return `Focus Lock Started${extra ? `: ${extra}` : ''}`;
    case 'focus_lock_ended': return 'Focus Lock Ended';
    case 'rest_block_started': return `Rest Block Started${extra ? `: ${extra}` : ''}`;
    case 'rest_block_ended': return 'Rest Block Ended';
    default: return event;
  }
}

/**
 * Create and store a log entry
 */
function logActivity(
  event: ActivityLogEventType,
  opts: {
    phase?: PhaseType;
    description?: string;
    durationMs?: number;
    scheduleName?: string;
    metadata?: Record<string, unknown>;
    extra?: string;
  } = {}
): void {
  const entry: ActivityLogEntry = {
    id: uuidv4(),
    timestamp: Date.now(),
    event,
    title: getEventTitle(event, opts.phase, opts.extra),
    description: opts.description,
    phase: opts.phase,
    scheduleName: opts.scheduleName || undefined,
    durationMs: opts.durationMs,
    metadata: opts.metadata,
  };

  activityLogStore.addEntry(entry);
}

// ============================================================
// PUBLIC API - Called from main.ts / ipc.ts
// ============================================================

export function logPhaseStarted(phase: PhaseType, scheduleName?: string, durationMs?: number): void {
  const isBreak = phase === 'short-break' || phase === 'long-break';
  const event: ActivityLogEventType = isBreak ? 'break_started' : 'phase_started';
  logActivity(event, {
    phase,
    scheduleName,
    description: durationMs ? `Duration: ${formatDurationShort(durationMs)}` : undefined,
    metadata: { configuredDurationMs: durationMs },
  });
}

export function logPhaseCompleted(phase: PhaseType, durationMs?: number, scheduleName?: string): void {
  const isBreak = phase === 'short-break' || phase === 'long-break';
  const event: ActivityLogEventType = isBreak ? 'break_completed' : 'phase_completed';
  logActivity(event, {
    phase,
    durationMs,
    scheduleName,
    description: durationMs ? `Lasted ${formatDurationShort(durationMs)}` : undefined,
  });
}

export function logBreakSkipped(phase?: PhaseType, scheduleName?: string): void {
  logActivity('break_skipped', {
    phase,
    scheduleName,
    description: 'Skipped by user',
  });
}

export function logBreakPostponed(minutes: number, phase?: PhaseType, scheduleName?: string): void {
  logActivity('break_postponed', {
    phase,
    scheduleName,
    extra: `${minutes} min`,
    description: `Postponed for ${minutes} minutes`,
    metadata: { postponeMinutes: minutes },
  });
}

export function logSessionPaused(phase?: PhaseType, scheduleName?: string): void {
  logActivity('session_paused', {
    phase,
    scheduleName,
    description: phase ? `Paused during ${PHASE_DISPLAY_NAMES[phase] || phase}` : undefined,
  });
}

export function logSessionResumed(pausedForMs?: number, scheduleName?: string): void {
  logActivity('session_resumed', {
    scheduleName,
    durationMs: pausedForMs,
    description: pausedForMs ? `Was paused for ${formatDurationShort(pausedForMs)}` : undefined,
  });
}

export function logSessionReset(scheduleName?: string): void {
  logActivity('session_reset', {
    scheduleName,
    description: 'Session was reset — all timers restarted',
  });
}

export function logScheduleStarted(scheduleName: string): void {
  logActivity('schedule_started', {
    extra: scheduleName,
    scheduleName,
    description: `Schedule "${scheduleName}" activated`,
  });
}

export function logScheduleStopped(scheduleName?: string): void {
  logActivity('schedule_stopped', {
    scheduleName,
    description: scheduleName ? `Schedule "${scheduleName}" deactivated` : 'Schedule stopped',
  });
}

export function logFlowShuffled(newOrder?: string, scheduleName?: string): void {
  logActivity('flow_shuffled', {
    scheduleName,
    description: newOrder ? `New order: ${newOrder}` : 'Flow order was shuffled',
  });
}

export function logFlowReversed(newOrder?: string, scheduleName?: string): void {
  logActivity('flow_reversed', {
    scheduleName,
    description: newOrder ? `New order: ${newOrder}` : 'Flow order was reversed',
  });
}

export function logFlowOrderApplied(scheduleName?: string): void {
  logActivity('flow_order_applied', {
    scheduleName,
    description: 'New flow order applied without resetting break timers',
  });
}

export function logFocusLockStarted(label: string, durationMs?: number): void {
  logActivity('focus_lock_started', {
    extra: label,
    durationMs,
    description: durationMs ? `Duration: ${formatDurationShort(durationMs)}` : undefined,
    metadata: { label },
  });
}

export function logFocusLockEnded(durationMs?: number): void {
  logActivity('focus_lock_ended', {
    durationMs,
    description: durationMs ? `Lasted ${formatDurationShort(durationMs)}` : undefined,
  });
}

export function logRestBlockStarted(name: string, durationMs?: number): void {
  logActivity('rest_block_started', {
    extra: name,
    durationMs,
    description: durationMs ? `Duration: ${formatDurationShort(durationMs)}` : undefined,
    metadata: { name },
  });
}

export function logRestBlockEnded(name?: string, durationMs?: number): void {
  logActivity('rest_block_ended', {
    durationMs,
    description: name ? `"${name}" ended` : 'Rest block ended',
  });
}

/**
 * Prune old log entries based on retention setting
 */
export function pruneActivityLog(retentionDays: number): void {
  activityLogStore.pruneOldEntries(retentionDays);
}

/**
 * Get all log entries
 */
export function getActivityLogEntries(fromTimestamp?: number, toTimestamp?: number): ActivityLogEntry[] {
  return activityLogStore.getEntries(fromTimestamp, toTimestamp);
}

/**
 * Clear all log entries
 */
export function clearActivityLog(): void {
  activityLogStore.clear();
}

/**
 * Format duration to short human-readable string
 */
function formatDurationShort(ms: number): string {
  if (ms < 1000) return '<1s';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}
