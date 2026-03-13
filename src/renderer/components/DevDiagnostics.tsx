/**
 * RhythmDesk Dev Diagnostics Panel - Phase 4 Production Hardening
 * 
 * DEV MODE ONLY - Shows session diagnostics for debugging.
 * Not exposed in production builds.
 * 
 * Displays:
 * - currentFlowStepIndex
 * - currentPhase
 * - nextPhase
 * - pendingBreakType
 * - postponedUntil
 * - cumulativeWorkTime
 * - overlayActive
 */

import { useState } from 'react';
import { TimerTick } from '../../shared/types';

interface DevDiagnosticsProps {
  tick: TimerTick | null;
  isVisible?: boolean;
  overlayActive?: boolean;
}

export function DevDiagnostics({ tick, isVisible = true, overlayActive = false }: DevDiagnosticsProps) {
  const [expanded, setExpanded] = useState(false);
  
  // Only show in development mode
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev || !isVisible) return null;
  
  if (!tick) {
    return (
      <div style={styles.container}>
        <div style={styles.header} onClick={() => setExpanded(!expanded)}>
          🔧 Dev Diagnostics {expanded ? '▼' : '▶'}
        </div>
        {expanded && (
          <div style={styles.content}>
            <div style={styles.row}>No tick data</div>
          </div>
        )}
      </div>
    );
  }
  
  const formatMs = (ms: number | undefined): string => {
    if (ms === undefined || ms === null) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}m`;
  };
  
  return (
    <div style={styles.container}>
      <div style={styles.header} onClick={() => setExpanded(!expanded)}>
        🔧 Dev Diagnostics {expanded ? '▼' : '▶'}
      </div>
      
      {expanded && (
        <div style={styles.content}>
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Session State</div>
            <DiagRow label="currentPhase" value={tick.currentPhase} />
            <DiagRow label="scheduleMode" value={tick.scheduleMode || '-'} />
            <DiagRow label="nextPhase" value={tick.nextPhase || '-'} />
            <DiagRow label="thenPhase" value={tick.thenPhase || '-'} />
          </div>
          
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Timing</div>
            <DiagRow label="phaseRemainingMs" value={formatMs(tick.phaseRemainingMs)} />
            <DiagRow label="cumulativeWorkTime" value={formatMs(tick.cumulativeWorkTimeMs)} />
          </div>
          
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Postpone State</div>
            <DiagRow label="isPostponed" value={tick.isPostponed ? 'YES' : 'no'} highlight={tick.isPostponed} />
            <DiagRow label="pendingBreak" value={tick.pendingBreakPhase || '-'} />
            <DiagRow label="pendingInMs" value={formatMs(tick.pendingBreakInMs)} />
          </div>
          
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Break Progress</div>
            <DiagRow 
              label="shortBreak" 
              value={`${formatMs(tick.breakProgress?.workTimeSinceShortBreakMs || 0)} / ${formatMs((tick.breakProgress?.shortBreakEveryMinutes || 0) * 60000)}`} 
            />
            <DiagRow 
              label="longBreak" 
              value={`${formatMs(tick.breakProgress?.workTimeSinceLongBreakMs || 0)} / ${formatMs((tick.breakProgress?.longBreakEveryMinutes || 0) * 60000)}`} 
            />
          </div>
          
          <div style={styles.section}>
            <div style={styles.sectionTitle}>System</div>
            <DiagRow label="overlayActive" value={overlayActive ? 'YES' : 'no'} highlight={overlayActive} />
            <DiagRow label="isPaused" value={tick.isPaused ? 'YES' : 'no'} highlight={tick.isPaused} />
            <DiagRow label="scheduleId" value={tick.scheduleId?.slice(0, 8) || '-'} />
            <DiagRow label="flowStale" value={tick.isFlowStale ? 'YES' : 'no'} highlight={tick.isFlowStale} />
          </div>
        </div>
      )}
    </div>
  );
}

interface DiagRowProps {
  label: string;
  value: string | number;
  highlight?: boolean;
}

function DiagRow({ label, value, highlight }: DiagRowProps) {
  return (
    <div style={{
      ...styles.row,
      ...(highlight ? styles.highlight : {}),
    }}>
      <span style={styles.label}>{label}:</span>
      <span style={styles.value}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    color: '#00ff00',
    fontFamily: 'monospace',
    fontSize: 11,
    borderRadius: 4,
    border: '1px solid #333',
    zIndex: 9999,
    maxWidth: 300,
    maxHeight: 400,
    overflow: 'auto',
  },
  header: {
    padding: '6px 10px',
    cursor: 'pointer',
    borderBottom: '1px solid #333',
    fontWeight: 'bold',
    userSelect: 'none',
  },
  content: {
    padding: 8,
  },
  section: {
    marginBottom: 8,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 10,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '2px 0',
  },
  label: {
    color: '#888',
  },
  value: {
    color: '#00ff00',
  },
  highlight: {
    backgroundColor: 'rgba(255, 200, 0, 0.2)',
  },
};

export default DevDiagnostics;
