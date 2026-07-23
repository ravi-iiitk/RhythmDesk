/**
 * RhythmDesk Activity Log Page
 * Beautiful, stylish user-facing event log
 */

import { useState, useEffect, useCallback } from 'react';
import { ActivityLogEntry, ActivityLogEventType } from '../../shared/types';

// Event type visual config
const EVENT_CONFIG: Record<ActivityLogEventType, { icon: string; color: string; bgColor: string }> = {
  schedule_started: { icon: '🚀', color: '#22c55e', bgColor: 'rgba(34, 197, 94, 0.1)' },
  schedule_stopped: { icon: '🛑', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.1)' },
  phase_started: { icon: '▶️', color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.1)' },
  phase_completed: { icon: '✅', color: '#10b981', bgColor: 'rgba(16, 185, 129, 0.1)' },
  break_started: { icon: '☕', color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.1)' },
  break_completed: { icon: '💪', color: '#6366f1', bgColor: 'rgba(99, 102, 241, 0.1)' },
  break_skipped: { icon: '⏭️', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.1)' },
  break_postponed: { icon: '⏰', color: '#f97316', bgColor: 'rgba(249, 115, 22, 0.1)' },
  session_reset: { icon: '🔄', color: '#06b6d4', bgColor: 'rgba(6, 182, 212, 0.1)' },
  session_paused: { icon: '⏸️', color: '#64748b', bgColor: 'rgba(100, 116, 139, 0.1)' },
  session_resumed: { icon: '▶️', color: '#22c55e', bgColor: 'rgba(34, 197, 94, 0.1)' },
  flow_shuffled: { icon: '🔀', color: '#a855f7', bgColor: 'rgba(168, 85, 247, 0.1)' },
  flow_reversed: { icon: '🔃', color: '#a855f7', bgColor: 'rgba(168, 85, 247, 0.1)' },
  flow_order_applied: { icon: '📋', color: '#14b8a6', bgColor: 'rgba(20, 184, 166, 0.1)' },
  focus_lock_started: { icon: '🔒', color: '#dc2626', bgColor: 'rgba(220, 38, 38, 0.1)' },
  focus_lock_ended: { icon: '🔓', color: '#16a34a', bgColor: 'rgba(22, 163, 74, 0.1)' },
  rest_block_started: { icon: '🧘', color: '#7c3aed', bgColor: 'rgba(124, 58, 237, 0.1)' },
  rest_block_ended: { icon: '🌟', color: '#059669', bgColor: 'rgba(5, 150, 105, 0.1)' },
};

type FilterType = 'all' | 'phases' | 'breaks' | 'actions';

const FILTER_GROUPS: Record<FilterType, ActivityLogEventType[] | null> = {
  all: null,
  phases: ['phase_started', 'phase_completed', 'schedule_started', 'schedule_stopped'],
  breaks: ['break_started', 'break_completed', 'break_skipped', 'break_postponed'],
  actions: ['session_reset', 'session_paused', 'session_resumed', 'flow_shuffled', 'flow_reversed', 'flow_order_applied', 'focus_lock_started', 'focus_lock_ended', 'rest_block_started', 'rest_block_ended'],
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

function groupByDate(entries: ActivityLogEntry[]): Map<string, ActivityLogEntry[]> {
  const groups = new Map<string, ActivityLogEntry[]>();
  for (const entry of entries) {
    const dateKey = new Date(entry.timestamp).toDateString();
    const existing = groups.get(dateKey) || [];
    existing.push(entry);
    groups.set(dateKey, existing);
  }
  return groups;
}

function ActivityLogPage() {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.rhythmDesk.getActivityLog();
      setEntries(data);
    } catch (err) {
      console.error('Failed to load activity log:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadEntries();
    // Refresh every 30 seconds
    const interval = setInterval(loadEntries, 30000);
    return () => clearInterval(interval);
  }, [loadEntries]);

  const handleClearLog = async () => {
    if (confirm('Clear all activity log entries? This cannot be undone.')) {
      await window.rhythmDesk.clearActivityLog();
      setEntries([]);
    }
  };

  // Filter entries
  const filteredEntries = filter === 'all'
    ? entries
    : entries.filter(e => FILTER_GROUPS[filter]?.includes(e.event));

  const grouped = groupByDate(filteredEntries);

  return (
    <div className="page" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>Activity Log</h2>
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.85rem' }}>
              Track your work sessions, breaks, and schedule events
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              {filteredEntries.length} event{filteredEntries.length !== 1 ? 's' : ''}
            </span>
            <button
              className="btn"
              onClick={loadEntries}
              title="Refresh"
              style={{
                padding: '0.4rem 0.75rem',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                color: '#3b82f6',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                fontSize: '0.8rem',
              }}
            >
              ↻ Refresh
            </button>
            <button
              className="btn"
              onClick={handleClearLog}
              title="Clear all log entries"
              style={{
                padding: '0.4rem 0.75rem',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                fontSize: '0.8rem',
              }}
            >
              🗑️ Clear
            </button>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{
        display: 'flex',
        gap: '0.25rem',
        padding: '0.5rem 0',
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0,
      }}>
        {(['all', 'phases', 'breaks', 'actions'] as FilterType[]).map(f => (
          <button
            key={f}
            className="btn"
            onClick={() => setFilter(f)}
            style={{
              padding: '0.4rem 0.85rem',
              fontSize: '0.8rem',
              fontWeight: filter === f ? 600 : 400,
              backgroundColor: filter === f ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
              color: filter === f ? '#3b82f6' : '#94a3b8',
              border: filter === f ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent',
              borderRadius: '6px',
              textTransform: 'capitalize',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Log entries */}
      <div style={{ flex: 1, overflow: 'auto', paddingTop: '0.75rem' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
            Loading activity log...
          </div>
        ) : filteredEntries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📭</div>
            <div style={{ fontWeight: 500 }}>No events yet</div>
            <div style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
              Activity will appear here as you use your schedule
            </div>
          </div>
        ) : (
          Array.from(grouped.entries()).map(([dateKey, dayEntries]) => (
            <div key={dateKey} style={{ marginBottom: '1.5rem' }}>
              {/* Date header */}
              <div style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#64748b',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '0.5rem',
                paddingLeft: '0.25rem',
              }}>
                {formatDate(dayEntries[0].timestamp)}
              </div>

              {/* Timeline */}
              <div style={{ position: 'relative', paddingLeft: '1.5rem' }}>
                {/* Vertical line */}
                <div style={{
                  position: 'absolute',
                  left: '0.55rem',
                  top: '0.75rem',
                  bottom: '0.75rem',
                  width: '2px',
                  backgroundColor: 'var(--border-color)',
                  borderRadius: '1px',
                }} />

                {dayEntries.map((entry) => {
                  const config = EVENT_CONFIG[entry.event] || { icon: '📌', color: '#94a3b8', bgColor: 'rgba(148, 163, 184, 0.1)' };
                  const isExpanded = expandedId === entry.id;

                  return (
                    <div
                      key={entry.id}
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      style={{
                        position: 'relative',
                        padding: '0.6rem 0.75rem',
                        marginBottom: '0.25rem',
                        borderRadius: '8px',
                        backgroundColor: isExpanded ? config.bgColor : 'transparent',
                        border: isExpanded ? `1px solid ${config.color}22` : '1px solid transparent',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isExpanded) {
                          (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-card)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isExpanded) {
                          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                        }
                      }}
                    >
                      {/* Timeline dot */}
                      <div style={{
                        position: 'absolute',
                        left: '-1.25rem',
                        top: '0.85rem',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: config.color,
                        border: '2px solid var(--bg-primary)',
                        boxShadow: `0 0 0 2px ${config.color}33`,
                      }} />

                      {/* Main row */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '1rem' }}>{config.icon}</span>
                          <span style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                            {entry.title}
                          </span>
                          {entry.scheduleName && (
                            <span style={{
                              fontSize: '0.7rem',
                              padding: '0.1rem 0.4rem',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(100, 116, 139, 0.15)',
                              color: '#94a3b8',
                            }}>
                              {entry.scheduleName}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          {entry.durationMs && (
                            <span style={{
                              fontSize: '0.75rem',
                              color: config.color,
                              fontWeight: 500,
                            }}>
                              {formatDuration(entry.durationMs)}
                            </span>
                          )}
                          <span style={{ fontSize: '0.75rem', color: '#64748b', minWidth: '5.5rem', textAlign: 'right' }}>
                            {formatTime(entry.timestamp)}
                          </span>
                        </div>
                      </div>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div style={{
                          marginTop: '0.5rem',
                          paddingTop: '0.5rem',
                          borderTop: `1px solid ${config.color}22`,
                        }}>
                          {entry.description && (
                            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.35rem' }}>
                              {entry.description}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.75rem', color: '#64748b' }}>
                            <span><strong>Event:</strong> {entry.event.replace(/_/g, ' ')}</span>
                            {entry.phase && <span><strong>Phase:</strong> {entry.phase}</span>}
                            {entry.durationMs && <span><strong>Duration:</strong> {formatDuration(entry.durationMs)}</span>}
                            <span><strong>Time:</strong> {new Date(entry.timestamp).toLocaleString()}</span>
                          </div>
                          {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                            <div style={{
                              marginTop: '0.35rem',
                              padding: '0.35rem 0.5rem',
                              backgroundColor: 'rgba(0, 0, 0, 0.2)',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              fontFamily: 'monospace',
                              color: '#94a3b8',
                            }}>
                              {Object.entries(entry.metadata).map(([key, val]) => (
                                <div key={key}>{key}: {JSON.stringify(val)}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ActivityLogPage;
