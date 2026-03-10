/**
 * RhythmDesk Dashboard Page
 * Shows current timer state and quick controls
 */

import { useState } from 'react';
import { TimerTick, OFFICE_FOCUS_LABELS, OFFICE_FOCUS_LOCK_DURATIONS, PhaseType, ConfiguredDurations } from '../../shared/types';
import { PHASE_DISPLAY_NAMES, PHASE_COLORS } from '../../shared/constants';
import { formatDurationHuman, formatDuration } from '../../shared/timeUtils';

interface DashboardPageProps {
  tick: TimerTick | null;
}

/**
 * Get the configured duration for a phase in human-readable format
 */
function getConfiguredDurationForPhase(phase: PhaseType, durations: ConfiguredDurations): string {
  switch (phase) {
    case 'sit':
      return `${durations.sitMinutes} min`;
    case 'stand':
      return `${durations.standMinutes} min`;
    case 'sit-to-stand-transition':
      return `${durations.sitToStandTransitionSeconds} sec`;
    case 'stand-to-sit-transition':
      return `${durations.standToSitTransitionSeconds} sec`;
    case 'short-break':
      return `${durations.shortBreakDurationMinutes} min`;
    case 'long-break':
      return `${durations.longBreakDurationMinutes} min`;
    default:
      return '';
  }
}

function DashboardPage({ tick }: DashboardPageProps) {
  const [showLockOptions, setShowLockOptions] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string>('EPAM');
  const [customLabel, setCustomLabel] = useState('');
  const [customDuration, setCustomDuration] = useState(60);

  const handlePause = () => window.rhythmDesk.pause();
  const handleResume = () => window.rhythmDesk.resume();
  const handlePostpone = (minutes: number) => window.rhythmDesk.postpone(minutes);
  const handleSkip = () => window.rhythmDesk.skipPhase();
  const handleResetSession = () => window.rhythmDesk.resetSession();
  const handleResetTodayCounters = () => window.rhythmDesk.resetTodayCounters();
  
  const handleStartOfficeFocusLock = (minutes: number) => {
    const label = selectedLabel === 'Custom' ? customLabel : selectedLabel;
    if (!label.trim()) return;
    window.rhythmDesk.startOfficeFocusLock(label, minutes);
    setShowLockOptions(false);
  };
  
  const handleStopOfficeFocusLock = () => {
    window.rhythmDesk.stopOfficeFocusLock();
  };

  if (!tick || tick.currentPhase === 'idle') {
    return (
      <div className="page">
        <div className="page-header">
          <h2>Dashboard</h2>
          <p>Monitor your current work session</p>
        </div>
        
        <div className="empty-state">
          <div className="empty-state-icon">⏸️</div>
          <h3>No Active Schedule</h3>
          <p>No schedule is currently active. Check your schedule settings to ensure you have enabled schedules for the current time and day.</p>
        </div>
      </div>
    );
  }

  const phaseColor = PHASE_COLORS[tick.currentPhase] || PHASE_COLORS['idle'];
  const phaseName = PHASE_DISPLAY_NAMES[tick.currentPhase] || tick.currentPhase;
  const nextPhaseName = PHASE_DISPLAY_NAMES[tick.nextPhase] || tick.nextPhase;

  return (
    <div className="page">
      <div className="page-header">
        <h2>Dashboard</h2>
        <div className="flex items-center gap-2">
          {tick.isPaused && <span className="status-badge status-paused">Paused</span>}
          {tick.isPostponed && <span className="status-badge status-paused">Postponed</span>}
          {!tick.isPaused && !tick.isPostponed && (
            <span className="status-badge status-active">Active</span>
          )}
        </div>
      </div>

      {/* Schedule Info */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">{tick.scheduleName}</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {tick.officeFocusLock.isActive && (
              <span className="status-badge" style={{ backgroundColor: 'rgba(251, 146, 60, 0.2)', color: '#fb923c' }}>
                🔒 {tick.officeFocusLock.label}
              </span>
            )}
            {tick.isStrictMode && (
              <span className="status-badge" style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}>
                Strict Mode
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Office Focus Lock Card */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">🔒 Office Focus Lock</span>
        </div>
        {tick.officeFocusLock.isActive ? (
          <div>
            <div style={{ marginBottom: '1rem' }}>
              <div className="stat-label">Lock Active - {tick.officeFocusLock.label}</div>
              <div className="stat-value" style={{ color: '#fb923c', fontSize: '1.5rem' }}>
                {formatDuration(tick.officeFocusLock.remainingMs)} remaining
              </div>
            </div>
            <button className="btn btn-secondary" onClick={handleStopOfficeFocusLock}>
              Stop Office Focus Lock
            </button>
          </div>
        ) : (
          <div>
            <p className="text-muted" style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>
              Office Focus Lock blocks your screen during work phases for paid work (EPAM, Resy, etc).
            </p>
            {!showLockOptions ? (
              <button 
                className="btn btn-success" 
                onClick={() => setShowLockOptions(true)}
              >
                🔒 Start Office Focus Lock
              </button>
            ) : (
              <div>
                {/* Label Selection */}
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                    Work Label:
                  </label>
                  <div className="btn-group" style={{ marginBottom: '0.5rem' }}>
                    {OFFICE_FOCUS_LABELS.map((label) => (
                      <button
                        key={label}
                        className={`btn ${selectedLabel === label ? 'btn-success' : 'btn-secondary'}`}
                        onClick={() => setSelectedLabel(label)}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      className={`btn ${selectedLabel === 'Custom' ? 'btn-success' : 'btn-secondary'}`}
                      onClick={() => setSelectedLabel('Custom')}
                    >
                      Custom
                    </button>
                  </div>
                  {selectedLabel === 'Custom' && (
                    <input
                      type="text"
                      placeholder="Enter custom label..."
                      value={customLabel}
                      onChange={(e) => setCustomLabel(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        borderRadius: '4px',
                        border: '1px solid #444',
                        backgroundColor: '#2a2a3e',
                        color: '#fff',
                        marginTop: '0.5rem',
                      }}
                    />
                  )}
                </div>

                {/* Duration Selection */}
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                    Duration:
                  </label>
                  <div className="btn-group">
                    {OFFICE_FOCUS_LOCK_DURATIONS.map((minutes) => (
                      <button
                        key={minutes}
                        className="btn btn-secondary"
                        onClick={() => handleStartOfficeFocusLock(minutes)}
                      >
                        {minutes} min
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Duration */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="number"
                    min="5"
                    max="480"
                    value={customDuration}
                    onChange={(e) => setCustomDuration(Number(e.target.value))}
                    style={{
                      width: '80px',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #444',
                      backgroundColor: '#2a2a3e',
                      color: '#fff',
                    }}
                  />
                  <button
                    className="btn btn-success"
                    onClick={() => handleStartOfficeFocusLock(customDuration)}
                  >
                    Start
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setShowLockOptions(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Current Phase Status */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Current Phase</span>
        </div>
        
        {/* Current Phase Info */}
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
            <div>
              <span style={{ fontSize: '1.25rem', fontWeight: 600, color: phaseColor }}>{phaseName}</span>
              <span style={{ fontSize: '0.875rem', color: '#64748b', marginLeft: '0.5rem' }}>
                (configured: {getConfiguredDurationForPhase(tick.currentPhase, tick.configuredDurations)})
              </span>
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: phaseColor }}>
              {formatDuration(tick.phaseRemainingMs)}
            </div>
          </div>
          
          {/* Progress bar */}
          <div style={{ 
            height: '8px', 
            backgroundColor: 'rgba(100, 116, 139, 0.2)', 
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div style={{ 
              width: `${((tick.phaseTotalMs - tick.phaseRemainingMs) / tick.phaseTotalMs) * 100}%`, 
              height: '100%', 
              backgroundColor: phaseColor,
              borderRadius: '4px',
              transition: 'width 0.3s ease'
            }} />
          </div>
        </div>
        
        {/* Next Phase Info */}
        <div style={{ 
          backgroundColor: 'rgba(100, 116, 139, 0.1)', 
          borderRadius: '6px', 
          padding: '0.75rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
            Next: <strong style={{ color: '#e2e8f0' }}>{nextPhaseName}</strong>
          </span>
          <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
            configured: {getConfiguredDurationForPhase(tick.nextPhase, tick.configuredDurations)}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Work Time Today</div>
          <div className="stat-value">{formatDurationHuman(tick.cumulativeWorkTimeMs)}</div>
          <div style={{ fontSize: '0.625rem', color: '#64748b', marginTop: '0.25rem' }}>
            Sit + Stand only
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Postpones Used Today</div>
          <div className="stat-value">{tick.postponeCountToday} / {tick.maxPostponesPerDay}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Current Phase</div>
          <div className="stat-value" style={{ color: phaseColor }}>{phaseName}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Next Phase</div>
          <div className="stat-value">{nextPhaseName}</div>
        </div>
      </div>

      {/* Controls */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Controls</span>
        </div>
        <div className="btn-group" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          {tick.isPaused ? (
            <button className="btn btn-success" onClick={handleResume}>
              ▶️ Resume
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={handlePause}>
              ⏸️ Pause
            </button>
          )}
          
          {!tick.isStrictMode && (
            <button className="btn btn-secondary" onClick={handleSkip}>
              ⏭️ Skip
            </button>
          )}
          
          <button 
            className="btn btn-secondary" 
            onClick={handleResetSession}
            title="Restart from Sitting Work, clear all timers"
          >
            🔄 Reset
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={handleResetTodayCounters}
            title="Clear work time and postpone counts"
          >
            📊 Reset Counters
          </button>
        </div>

        {/* Postpone Options */}
        {tick.canPostpone && tick.postponeOptions.length > 0 && (
          <div className="mt-2">
            <p className="text-muted mb-1" style={{ fontSize: '0.875rem' }}>
              Postpone ({tick.maxPostponesPerDay - tick.postponeCountToday} remaining today)
            </p>
            <div className="postpone-options">
              {tick.postponeOptions.map((minutes) => (
                <button
                  key={minutes}
                  className="btn btn-secondary"
                  onClick={() => handlePostpone(minutes)}
                >
                  {minutes} min
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Schedule Durations Reference */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Configured Durations</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
          <div style={{ padding: '0.5rem', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: '6px' }}>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Sitting Work</div>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: '#3b82f6' }}>{tick.configuredDurations.sitMinutes} min</div>
          </div>
          <div style={{ padding: '0.5rem', backgroundColor: 'rgba(34, 197, 94, 0.1)', borderRadius: '6px' }}>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Standing Work</div>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: '#22c55e' }}>{tick.configuredDurations.standMinutes} min</div>
          </div>
          <div style={{ padding: '0.5rem', backgroundColor: 'rgba(168, 85, 247, 0.1)', borderRadius: '6px' }}>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Sit→Stand Transition</div>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: '#a855f7' }}>{tick.configuredDurations.sitToStandTransitionSeconds} sec</div>
          </div>
          <div style={{ padding: '0.5rem', backgroundColor: 'rgba(236, 72, 153, 0.1)', borderRadius: '6px' }}>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Stand→Sit Transition</div>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: '#ec4899' }}>{tick.configuredDurations.standToSitTransitionSeconds} sec</div>
          </div>
        </div>
      </div>

      {/* Break Progress */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Break Progress</span>
        </div>
        
        {/* Next Break Info - Prominent Display */}
        {tick.breakProgress.nextBreakType && (
          <div style={{ 
            backgroundColor: 'rgba(59, 130, 246, 0.15)', 
            borderRadius: '8px', 
            padding: '1rem', 
            marginBottom: '1rem',
            border: '1px solid rgba(59, 130, 246, 0.3)'
          }}>
            <div style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
              Next Break
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 600, color: '#3b82f6' }}>
              {tick.breakProgress.nextBreakType === 'short-break' ? '☕ Short Break' : '🌴 Long Break'} in {formatDurationHuman(tick.breakProgress.nextBreakInMs)}
            </div>
          </div>
        )}
        
        {/* Short Break Progress */}
        {tick.breakProgress.shortBreakEnabled && (
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                ☕ Short Break in <strong style={{ color: '#22c55e' }}>{formatDurationHuman(tick.breakProgress.msUntilNextShortBreak)}</strong>
              </span>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                every {tick.breakProgress.shortBreakEveryMinutes} min work • {tick.breakProgress.shortBreakDurationMinutes} min duration
              </span>
            </div>
            <div style={{ 
              height: '8px', 
              backgroundColor: 'rgba(34, 197, 94, 0.2)', 
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{ 
                width: `${tick.breakProgress.shortBreakProgress * 100}%`, 
                height: '100%', 
                backgroundColor: '#22c55e',
                borderRadius: '4px',
                transition: 'width 0.3s ease'
              }} />
            </div>
          </div>
        )}
        
        {/* Long Break Progress */}
        {tick.breakProgress.longBreakEnabled && (
          <div style={{ marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                🌴 Long Break in <strong style={{ color: '#f59e0b' }}>{formatDurationHuman(tick.breakProgress.msUntilNextLongBreak)}</strong>
              </span>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                every {tick.breakProgress.longBreakEveryMinutes} min work • {tick.breakProgress.longBreakDurationMinutes} min duration
              </span>
            </div>
            <div style={{ 
              height: '8px', 
              backgroundColor: 'rgba(245, 158, 11, 0.2)', 
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{ 
                width: `${tick.breakProgress.longBreakProgress * 100}%`, 
                height: '100%', 
                backgroundColor: '#f59e0b',
                borderRadius: '4px',
                transition: 'width 0.3s ease'
              }} />
            </div>
          </div>
        )}
        
        {/* No breaks configured */}
        {!tick.breakProgress.shortBreakEnabled && !tick.breakProgress.longBreakEnabled && (
          <p className="text-muted" style={{ fontSize: '0.875rem' }}>
            No breaks configured for this schedule.
          </p>
        )}
      </div>
    </div>
  );
}

export default DashboardPage;
