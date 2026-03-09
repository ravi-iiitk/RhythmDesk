/**
 * PostureGuard Dashboard Page
 * Shows current timer state and quick controls
 */

import { useState } from 'react';
import { TimerTick, OFFICE_FOCUS_LABELS, OFFICE_FOCUS_LOCK_DURATIONS } from '../../shared/types';
import { PHASE_DISPLAY_NAMES, PHASE_COLORS } from '../../shared/constants';
import { formatDurationHuman, formatDuration } from '../../shared/timeUtils';
import CountdownCard from '../components/CountdownCard';

interface DashboardPageProps {
  tick: TimerTick | null;
}

function DashboardPage({ tick }: DashboardPageProps) {
  const [showLockOptions, setShowLockOptions] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string>('EPAM');
  const [customLabel, setCustomLabel] = useState('');
  const [customDuration, setCustomDuration] = useState(60);

  const handlePause = () => window.postureGuard.pause();
  const handleResume = () => window.postureGuard.resume();
  const handlePostpone = (minutes: number) => window.postureGuard.postpone(minutes);
  const handleSkip = () => window.postureGuard.skipPhase();
  
  const handleStartOfficeFocusLock = (minutes: number) => {
    const label = selectedLabel === 'Custom' ? customLabel : selectedLabel;
    if (!label.trim()) return;
    window.postureGuard.startOfficeFocusLock(label, minutes);
    setShowLockOptions(false);
  };
  
  const handleStopOfficeFocusLock = () => {
    window.postureGuard.stopOfficeFocusLock();
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

      {/* Main Countdown */}
      <CountdownCard
        phase={tick.currentPhase}
        phaseName={phaseName}
        remaining={tick.phaseRemainingMs}
        total={tick.phaseTotalMs}
        nextPhase={nextPhaseName}
        color={phaseColor}
      />

      {/* Controls */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Controls</span>
        </div>
        <div className="btn-group">
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
              ⏭️ Skip Phase
            </button>
          )}
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

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Cumulative Work Time</div>
          <div className="stat-value">{formatDurationHuman(tick.cumulativeWorkTimeMs)}</div>
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
    </div>
  );
}

export default DashboardPage;
