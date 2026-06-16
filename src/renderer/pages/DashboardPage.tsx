/**
 * RhythmDesk Dashboard Page
 * Shows current timer state and quick controls
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TimerTick, OFFICE_FOCUS_LOCK_DURATIONS, PhaseType, ConfiguredDurations, DEFAULT_REST_BLOCK_PRESETS, Schedule } from '../../shared/types';
import { PHASE_DISPLAY_NAMES, PHASE_COLORS } from '../../shared/constants';
import { formatDurationHuman, formatDuration } from '../../shared/timeUtils';

interface DashboardPageProps {
  tick: TimerTick | null;
}

/**
 * Format minutes into human-readable format (e.g., "1h 15m" or "30m")
 */
function formatPostponeMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
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
  const navigate = useNavigate();
  const [showLockOptions, setShowLockOptions] = useState(false);
  const [scheduleNames, setScheduleNames] = useState<string[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<string>('');
  const [customHours, setCustomHours] = useState<number>(0);
  const [customMinutes, setCustomMinutes] = useState<number>(30);
  const [focusStrictMode, setFocusStrictMode] = useState<boolean>(false);
  const [restStrictMode, setRestStrictMode] = useState<boolean>(false);
  const [restCustomHours, setRestCustomHours] = useState<number>(0);
  const [restCustomMinutes, setRestCustomMinutes] = useState<number>(15);
  const [restCustomName, setRestCustomName] = useState<string>('My Break');
  const [extendOptions, setExtendOptions] = useState<number[]>([2, 5, 10]);
  const [preponeOptions, setPreponeOptions] = useState<number[]>([1, 2, 5]);
  const [showBreakOptions, setShowBreakOptions] = useState(false);
  const [breakDurationInput, setBreakDurationInput] = useState<string>('');

  // Fetch extend/prepone options from settings
  useEffect(() => {
    window.rhythmDesk.getConfig().then((config) => {
      if (config?.generalSettings?.extendOptions && config.generalSettings.extendOptions.length > 0) {
        setExtendOptions(config.generalSettings.extendOptions);
      }
      if (config?.generalSettings?.preponeOptions && config.generalSettings.preponeOptions.length > 0) {
        setPreponeOptions(config.generalSettings.preponeOptions);
      }
    });
  }, []);

  // Keyboard shortcuts for dashboard
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore if typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    // Navigation shortcuts (Alt+number)
    if (e.altKey) {
      switch (e.key) {
        case '1': navigate('/'); return;
        case '2': navigate('/schedules'); return;
        case '3': navigate('/settings'); return;
        case '4': navigate('/help'); return;
      }
    }

    // ? for help
    if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      navigate('/help');
      return;
    }

    // Dashboard action shortcuts (only when schedule is active)
    if (!tick || tick.currentPhase === 'idle') return;

    switch (e.key.toLowerCase()) {
      case ' ': // Space - pause/resume
        e.preventDefault();
        if (tick.isPaused) {
          window.rhythmDesk.resume();
        } else {
          window.rhythmDesk.pause();
        }
        break;
      case 's': // S - skip
        if (!e.ctrlKey && !e.altKey && !e.metaKey) {
          window.rhythmDesk.skipPhase();
        }
        break;
      case 'r': // R - reset session
        if (!e.ctrlKey && !e.altKey && !e.metaKey) {
          window.rhythmDesk.resetSession();
        }
        break;
      case 'n': // N - start next activity
        if (!e.ctrlKey && !e.altKey && !e.metaKey && tick.isWaitingForNextActivity) {
          window.rhythmDesk.startNextActivity();
        }
        break;
      case 'e': // E - extend current work phase
      case 'E':
        if (!e.ctrlKey && !e.altKey && !e.metaKey) {
          if (tick.currentPhase === 'sit' || tick.currentPhase === 'stand') {
            window.rhythmDesk.extendBreak(extendOptions[0] || 2);
          }
        }
        break;
      case 'p': // P - prepone (reduce) current phase
      case 'P':
        if (!e.ctrlKey && !e.altKey && !e.metaKey) {
          if ((tick.currentPhase === 'sit' || tick.currentPhase === 'stand') && preponeOptions.length > 0) {
            if (tick.phaseRemainingMs > (preponeOptions[0] * 60000) + 30000) {
              handlePreponePhase(preponeOptions[0]);
            }
          }
        }
        break;
      case 'b': // B - toggle ad-hoc break options
      case 'B':
        if (!e.ctrlKey && !e.altKey && !e.metaKey) {
          if (tick.currentPhase === 'sit' || tick.currentPhase === 'stand') {
            setShowBreakOptions(prev => {
              if (!prev) setBreakDurationInput('');
              return !prev;
            });
          }
        }
        break;
    }

    // When break options panel is open, capture digit keys for custom duration
    if (showBreakOptions && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        setBreakDurationInput(prev => {
          if (prev.length >= 2) return e.key; // Start fresh if already 2 digits
          return prev + e.key;
        });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Return') {
        e.preventDefault();
        const mins = parseInt(breakDurationInput, 10);
        if (mins > 0 && mins <= 99) {
          window.rhythmDesk.startAdHocBreak(mins);
          setShowBreakOptions(false);
          setBreakDurationInput('');
        }
        return;
      }
      if (e.key === 'Escape') {
        setShowBreakOptions(false);
        setBreakDurationInput('');
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        setBreakDurationInput(prev => prev.slice(0, -1));
        return;
      }
    }
  }, [tick, navigate, extendOptions, preponeOptions, showBreakOptions, breakDurationInput]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
  
  // Fetch schedule names for Office Focus Lock dropdown
  useEffect(() => {
    window.rhythmDesk.getSchedules().then((schedules: Schedule[]) => {
      const names = schedules.map(s => s.name).filter(Boolean);
      setScheduleNames(names);
      // Set default selected label to first schedule or current schedule
      if (names.length > 0) {
        setSelectedLabel(prev => prev || tick?.scheduleName || names[0]);
      }
    });
  }, [tick?.scheduleName]);

  const handlePause = () => window.rhythmDesk.pause();
  const handleResume = () => window.rhythmDesk.resume();
  const handlePostpone = (minutes: number) => window.rhythmDesk.postpone(minutes);
  const handleSkip = () => window.rhythmDesk.skipPhase();
  const handleResetSession = () => window.rhythmDesk.resetSession();
  const handleResetTodayCounters = () => window.rhythmDesk.resetTodayCounters();
  const handleShuffleFlow = () => window.rhythmDesk.shuffleFlow();
  const handleReverseFlow = () => window.rhythmDesk.reverseFlow();
  const handleTriggerPendingBreakNow = () => window.rhythmDesk.triggerPendingBreakNow();
  const handleStartNextActivity = () => window.rhythmDesk.startNextActivity();
  const handleRestartCurrentActivity = () => window.rhythmDesk.restartCurrentActivity();
  
  const handleStartOfficeFocusLock = (minutes: number) => {
    window.rhythmDesk.startOfficeFocusLock(selectedLabel, minutes, focusStrictMode);
    setShowLockOptions(false);
  };
  
  const handleStopOfficeFocusLock = () => {
    window.rhythmDesk.stopOfficeFocusLock();
  };

  // Rest Block handlers
  const handleStartRestBlock = (name: string, minutes: number, strictMode: boolean) => {
    window.rhythmDesk.startRestBlock(name, minutes, strictMode);
  };

  const handleStopRestBlock = () => {
    window.rhythmDesk.stopRestBlock();
  };

  const handleExtendPhase = (minutes: number) => {
    window.rhythmDesk.extendBreak(minutes);
  };

  const handlePreponePhase = async (minutes: number) => {
    const success = await window.rhythmDesk.preponePhase(minutes);
    if (!success) {
      alert(`Cannot reduce by ${minutes} min — not enough time remaining (need at least ${minutes} min + 30s safety margin).`);
    }
  };

  if (!tick || tick.currentPhase === 'idle') {
    // Show rest block UI even when no schedule is active
    const isRestBlockActive = tick?.restBlock?.isActive ?? false;
    
    return (
      <div className="page" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div className="card" style={{ padding: '1.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏸️</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '0.5rem' }}>No Active Schedule</div>
          <div style={{ fontSize: '0.9rem', color: '#64748b' }}>Check your schedule settings to ensure you have enabled schedules for the current time and day.</div>
        </div>
        
        {/* Rest Blocks - Available even without schedule */}
        <div className="card" style={{ padding: '0.75rem 1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#e2e8f0' }}>🛋️ Take a Rest</div>
            {isRestBlockActive ? (
              <span style={{ fontSize: '0.75rem', color: '#22c55e', fontWeight: 500 }}>
                Active: {tick?.restBlock?.name}
              </span>
            ) : (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                <input
                  type="checkbox"
                  checked={restStrictMode}
                  onChange={(e) => setRestStrictMode(e.target.checked)}
                  style={{ width: '14px', height: '14px' }}
                />
                🔒 Strict Mode
              </label>
            )}
          </div>
          
          {isRestBlockActive ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'center', padding: '1rem' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#22c55e' }}>
                  {formatDuration(tick?.restBlock?.remainingMs ?? 0)}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>remaining</div>
              </div>
              {!tick?.restBlock?.isStrictMode && (
                <button className="btn btn-secondary" onClick={handleStopRestBlock}>
                  End Rest
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Quick presets */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem', marginBottom: '0.5rem' }}>
                {DEFAULT_REST_BLOCK_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    className="btn btn-secondary"
                    onClick={() => handleStartRestBlock(preset.name, preset.durationMinutes, restStrictMode)}
                    style={{ 
                      padding: '0.5rem 0.5rem',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '0.1rem'
                    }}
                  >
                    <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{preset.name}</span>
                    <span style={{ fontSize: '0.65rem', color: '#64748b' }}>
                      {preset.durationMinutes >= 60 
                        ? `${Math.floor(preset.durationMinutes / 60)}h` 
                        : `${preset.durationMinutes}m`}
                    </span>
                  </button>
                ))}
              </div>
              
              {/* Custom duration with name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={restCustomName}
                  onChange={(e) => setRestCustomName(e.target.value)}
                  placeholder="Break name"
                  style={{ width: '100px', padding: '0.25rem 0.5rem', borderRadius: '4px', backgroundColor: '#2a2a3e', color: '#e2e8f0', border: '1px solid #444' }}
                />
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={restCustomHours}
                  onChange={(e) => setRestCustomHours(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))}
                  style={{ width: '50px', padding: '0.25rem', textAlign: 'center' }}
                />
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>h</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={restCustomMinutes}
                  onChange={(e) => setRestCustomMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                  style={{ width: '50px', padding: '0.25rem', textAlign: 'center' }}
                />
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>m</span>
                <button
                  className="btn btn-primary"
                  onClick={() => handleStartRestBlock(restCustomName || 'Custom Rest', restCustomHours * 60 + restCustomMinutes, restStrictMode)}
                  disabled={restCustomHours === 0 && restCustomMinutes === 0}
                  style={{ padding: '0.3rem 0.75rem', marginLeft: 'auto' }}
                >
                  Start
                </button>
              </div>
            </>
          )}
        </div>
        
        {/* Office Focus Lock - Available even without schedule */}
        <div className="card" style={{ padding: '0.75rem 1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#e2e8f0' }}>🎯 Focus Mode</div>
            {tick?.officeFocusLock?.isActive ? (
              <span style={{ fontSize: '0.75rem', color: '#fb923c', fontWeight: 500 }}>
                Active: {tick.officeFocusLock.label}
              </span>
            ) : (
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: focusStrictMode ? '#ef4444' : '#94a3b8' }}>
                <input
                  type="checkbox"
                  checked={focusStrictMode}
                  onChange={(e) => setFocusStrictMode(e.target.checked)}
                  style={{ width: '14px', height: '14px' }}
                />
                🔒 Strict Mode
              </label>
            )}
          </div>
          
          {tick?.officeFocusLock?.isActive ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'center', padding: '1rem' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#fb923c' }}>
                  {formatDuration(tick.officeFocusLock.remainingMs)}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>remaining</div>
              </div>
              {!tick.officeFocusLock.isStrictMode && (
                <button className="btn btn-secondary" onClick={handleStopOfficeFocusLock}>
                  End Focus
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Label selector and quick durations */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <select 
                  value={selectedLabel} 
                  onChange={(e) => setSelectedLabel(e.target.value)}
                  style={{ padding: '0.4rem', borderRadius: '6px', backgroundColor: '#2a2a3e', color: '#e2e8f0', border: '1px solid #444', fontSize: '0.85rem' }}
                  disabled={scheduleNames.length === 0}
                >
                  {scheduleNames.length === 0 ? (
                    <option value="">No schedules</option>
                  ) : (
                    scheduleNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))
                  )}
                </select>
                {OFFICE_FOCUS_LOCK_DURATIONS.slice(0, 4).map((minutes) => (
                  <button 
                    key={minutes} 
                    className="btn btn-secondary" 
                    onClick={() => handleStartOfficeFocusLock(minutes)} 
                    style={{ padding: '0.35rem 0.6rem', fontSize: '0.8rem' }}
                  >
                    {minutes}m
                  </button>
                ))}
              </div>
              
              {/* Custom duration */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Custom:</span>
                <input 
                  type="number" 
                  min="0" max="8" 
                  value={customHours} 
                  onChange={(e) => setCustomHours(Math.max(0, Math.min(8, parseInt(e.target.value) || 0)))}
                  style={{ width: '50px', padding: '0.25rem', textAlign: 'center' }}
                />
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>h</span>
                <input 
                  type="number" 
                  min="0" max="59" 
                  value={customMinutes} 
                  onChange={(e) => setCustomMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                  style={{ width: '50px', padding: '0.25rem', textAlign: 'center' }}
                />
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>m</span>
                <button 
                  className="btn btn-primary" 
                  onClick={() => handleStartOfficeFocusLock(customHours * 60 + customMinutes)} 
                  disabled={customHours * 60 + customMinutes === 0}
                  style={{ padding: '0.3rem 0.75rem', marginLeft: 'auto' }}
                >
                  Start
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const phaseColor = PHASE_COLORS[tick.currentPhase] || PHASE_COLORS['idle'];
  // Use custom labels from tick (includes user-defined flow step labels)
  const phaseName = tick.currentPhaseLabel || PHASE_DISPLAY_NAMES[tick.currentPhase] || tick.currentPhase;
  const nextPhaseName = tick.nextPhaseLabel || PHASE_DISPLAY_NAMES[tick.nextPhase] || tick.nextPhase;
  const isActiveBreakPhase = tick.currentPhase === 'short-break' || tick.currentPhase === 'long-break';
  const breakSkipCountToday = tick.breakSkipCountToday ?? 0;
  const maxBreakSkipsPerDay = tick.maxBreakSkipsPerDay ?? 0;
  const breakSkipsLeftToday = Math.max(0, maxBreakSkipsPerDay - breakSkipCountToday);
  const skipDisabled = tick.noSkipEnabled || (isActiveBreakPhase && tick.canSkipCurrentBreak === false);
  const skipTitle = tick.noSkipEnabled
    ? 'Skip disabled for this schedule'
    : (isActiveBreakPhase && tick.canSkipCurrentBreak === false)
      ? `Break skip limit reached (${tick.breakSkipCountToday ?? 0}/${tick.maxBreakSkipsPerDay ?? 0})`
      : 'Skip to next activity';
  
  const isTransitionPhase = tick.currentPhase === 'sit-to-stand-transition' || tick.currentPhase === 'stand-to-sit-transition';
  const restartDisabled = isTransitionPhase || tick.isWaitingForNextActivity || (isActiveBreakPhase && tick.isStrictMode);
  const restartTitle = isTransitionPhase
    ? 'Cannot restart transitions'
    : tick.isWaitingForNextActivity
      ? 'Cannot restart - waiting for next activity'
      : (isActiveBreakPhase && tick.isStrictMode)
        ? 'Cannot restart strict-mode breaks'
        : 'Restart current activity timer (keeps session progress)';

  return (
    <div className="page" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', height: '100%' }}>
      {/* Row 1: Header - Schedule Name (left) + Office Focus Lock (right) */}
      <div className="card" style={{ padding: '1rem', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#e2e8f0' }}>{tick.scheduleName}</span>
            {tick.isPaused && <span className="status-badge status-paused" style={{ fontSize: '0.875rem' }}>⏸️ Paused</span>}
            {tick.isWaitingForNextActivity && tick.waitingNextPhase && (
              <span className="status-badge" style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', fontSize: '0.875rem' }}>
                ⏸️ Ready: {tick.waitingNextPhase ? (PHASE_DISPLAY_NAMES[tick.waitingNextPhase] || tick.waitingNextPhase) : ''}
              </span>
            )}
            {tick.isPostponed && tick.pendingBreakPhase && (
              <span className="status-badge" style={{ backgroundColor: 'rgba(251, 191, 36, 0.2)', color: '#fbbf24', fontSize: '0.875rem' }}>
                ⏳ Pending {PHASE_DISPLAY_NAMES[tick.pendingBreakPhase]} in {formatDuration(tick.pendingBreakInMs)}
              </span>
            )}
            {tick.isStrictMode && (
              <span className="status-badge" style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', fontSize: '0.875rem' }}>
                🔒 Strict Mode
              </span>
            )}
            {tick.isFlowStale && (
              <span className="status-badge" style={{ backgroundColor: 'rgba(251, 146, 60, 0.2)', color: '#fb923c', fontSize: '0.875rem' }}>
                ⚠️ Flow Updated
              </span>
            )}
          </div>
          
          {/* Office Focus Mode - Top Right */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {tick.officeFocusLock.isActive ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(251, 146, 60, 0.15)', borderRadius: '8px', border: '1px solid rgba(251, 146, 60, 0.3)' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.7rem', color: '#fb923c', fontWeight: 500 }}>
                    {tick.officeFocusLock.isStrictMode ? '🔒' : '🎯'} {tick.officeFocusLock.label} Focus
                    {tick.officeFocusLock.isStrictMode && <span style={{ color: '#ef4444', marginLeft: '0.25rem' }}>(Strict)</span>}
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fb923c', fontFamily: 'monospace' }}>{formatDuration(tick.officeFocusLock.remainingMs)}</div>
                </div>
                {!tick.officeFocusLock.isStrictMode && (
                  <button className="btn" onClick={handleStopOfficeFocusLock} style={{ padding: '0.4rem 0.6rem', backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}>Stop</button>
                )}
              </div>
            ) : (
              !showLockOptions ? (
                <button className="btn btn-success" onClick={() => setShowLockOptions(true)} style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>
                  🎯 Start Focus Mode
                </button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(34, 197, 94, 0.1)', borderRadius: '8px', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
                  <select 
                    value={selectedLabel} 
                    onChange={(e) => setSelectedLabel(e.target.value)}
                    style={{ padding: '0.4rem', borderRadius: '6px', backgroundColor: '#2a2a3e', color: '#e2e8f0', border: '1px solid #444', fontSize: '0.85rem' }}
                    disabled={scheduleNames.length === 0}
                  >
                    {scheduleNames.length === 0 ? (
                      <option value="">No schedules</option>
                    ) : (
                      scheduleNames.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))
                    )}
                  </select>
                  <span style={{ color: '#64748b', fontSize: '0.8rem' }}>|</span>
                  {OFFICE_FOCUS_LOCK_DURATIONS.slice(0, 3).map((minutes) => (
                    <button key={minutes} className="btn btn-secondary" onClick={() => handleStartOfficeFocusLock(minutes)} style={{ padding: '0.35rem 0.6rem', fontSize: '0.8rem' }}>
                      {minutes}m
                    </button>
                  ))}
                  <span style={{ color: '#64748b', fontSize: '0.8rem' }}>|</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <input 
                      type="number" 
                      min="0" max="8" 
                      value={customHours} 
                      onChange={(e) => setCustomHours(Math.max(0, Math.min(8, parseInt(e.target.value) || 0)))}
                      style={{ width: '40px', padding: '0.3rem', borderRadius: '4px', backgroundColor: '#2a2a3e', color: '#e2e8f0', border: '1px solid #444', textAlign: 'center', fontSize: '0.8rem' }}
                    />
                    <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>h</span>
                    <input 
                      type="number" 
                      min="0" max="59" 
                      value={customMinutes} 
                      onChange={(e) => setCustomMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                      style={{ width: '40px', padding: '0.3rem', borderRadius: '4px', backgroundColor: '#2a2a3e', color: '#e2e8f0', border: '1px solid #444', textAlign: 'center', fontSize: '0.8rem' }}
                    />
                    <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>m</span>
                    <button 
                      className="btn btn-success" 
                      onClick={() => handleStartOfficeFocusLock(customHours * 60 + customMinutes)} 
                      disabled={customHours * 60 + customMinutes === 0}
                      style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
                    >
                      Go
                    </button>
                  </div>
                  <span style={{ color: '#64748b', fontSize: '0.8rem' }}>|</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', fontSize: '0.75rem', color: focusStrictMode ? '#ef4444' : '#94a3b8' }}>
                    <input 
                      type="checkbox" 
                      checked={focusStrictMode} 
                      onChange={(e) => setFocusStrictMode(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    🔒 Strict
                  </label>
                  <button className="btn btn-secondary" onClick={() => setShowLockOptions(false)} style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}>✕</button>
                </div>
              )
            )}
          </div>
        </div>

        {isActiveBreakPhase && (
          <div style={{ marginTop: '0.75rem', fontSize: '0.9rem', color: '#94a3b8' }}>
            {tick.canSkipCurrentBreak === false
              ? `Break skip limit reached for today (${breakSkipCountToday}/${maxBreakSkipsPerDay})`
              : `Break skips left today: ${breakSkipsLeftToday} (${breakSkipCountToday}/${maxBreakSkipsPerDay} used)`}
          </div>
        )}
      </div>

      {/* Flow Stale Warning Banner */}
      {tick.isFlowStale && (
        <div style={{ 
          padding: '0.75rem 1rem', 
          backgroundColor: 'rgba(251, 146, 60, 0.15)', 
          borderRadius: '8px', 
          border: '1px solid rgba(251, 146, 60, 0.3)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.25rem' }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 600, color: '#fb923c' }}>Schedule flow updated</div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Reset session to apply the new flow order</div>
            </div>
          </div>
          <button 
            className="btn" 
            onClick={handleResetSession}
            style={{ 
              padding: '0.5rem 1rem', 
              backgroundColor: 'rgba(251, 146, 60, 0.2)', 
              color: '#fb923c', 
              border: '1px solid rgba(251, 146, 60, 0.4)',
              fontWeight: 600
            }}
          >
            Reset Now
          </button>
        </div>
      )}

      {/* Row 2: Today's Stats - Separate blocks */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
        <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: 0, textAlign: 'center' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>⏱️ Work Time Today</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#3b82f6' }}>{formatDurationHuman(tick.cumulativeWorkTimeMs)}</div>
        </div>
        <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: 0, textAlign: 'center' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>☕ Short Breaks</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#22c55e' }}>
            {tick.breakProgress.shortBreakCountToday ?? 0}
          </div>
        </div>
        <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: 0, textAlign: 'center' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>🌴 Long Breaks</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f59e0b' }}>
            {tick.breakProgress.longBreakCountToday ?? 0}
          </div>
        </div>
        <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: 0, textAlign: 'center' }}>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>⏭️ Postpones</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#a855f7' }}>{tick.postponeCountToday} / {tick.maxPostponesPerDay}</div>
        </div>
      </div>

      {/* Row 3: Main Timer Card - Current Phase */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: 0 }}>
        {/* Phase + Timer Row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
            <span style={{ fontSize: '2rem', fontWeight: 700, color: phaseColor }}>{phaseName}</span>
            <span style={{ fontSize: '1rem', color: '#64748b' }}>
              ({getConfiguredDurationForPhase(tick.currentPhase, tick.configuredDurations)})
            </span>
          </div>
          <div style={{ fontSize: '3rem', fontWeight: 700, color: phaseColor, fontFamily: 'monospace' }}>
            {formatDuration(tick.phaseRemainingMs)}
          </div>
        </div>
        
        {/* Progress bar */}
        <div style={{ height: '12px', backgroundColor: 'rgba(100, 116, 139, 0.2)', borderRadius: '6px', overflow: 'hidden', marginBottom: '1rem' }}>
          <div style={{ 
            width: `${((tick.phaseTotalMs - tick.phaseRemainingMs) / tick.phaseTotalMs) * 100}%`, 
            height: '100%', 
            backgroundColor: phaseColor,
            transition: 'width 0.3s ease'
          }} />
        </div>

        {/* Next Phase + Controls Row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.1rem', color: '#94a3b8' }}>
            Next Activity: <strong style={{ color: '#e2e8f0' }}>{nextPhaseName}</strong>
            <span style={{ color: '#64748b', marginLeft: '0.5rem' }}>
              ({getConfiguredDurationForPhase(tick.nextPhase, tick.configuredDurations)})
            </span>
          </span>
          
          {/* Controls - right aligned, wraps on smaller screens */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginLeft: 'auto' }}>
            <button 
              className="btn btn-secondary" 
              onClick={handleRestartCurrentActivity}
              disabled={restartDisabled}
              title={restartTitle}
              style={restartDisabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
              <span style={{ display: 'inline-block', filter: 'hue-rotate(90deg) saturate(1.5) brightness(1.05)' }}>🔁</span> Restart
            </button>
            {tick.isWaitingForNextActivity && tick.waitingNextPhase ? (
              <button
                className="btn btn-success"
                onClick={handleStartNextActivity}
                style={{ fontWeight: 700, fontSize: '1rem', padding: '0.5rem 1.25rem' }}
                title={`Start ${PHASE_DISPLAY_NAMES[tick.waitingNextPhase] || tick.waitingNextPhase}`}
              >
                ▶ Start {PHASE_DISPLAY_NAMES[tick.waitingNextPhase] || tick.waitingNextPhase}
              </button>
            ) : tick.isPaused ? (
              <button className="btn btn-success" onClick={handleResume}>▶️ Resume</button>
            ) : (
              <button className="btn btn-secondary" onClick={handlePause}><span style={{ display: 'inline-block', filter: 'hue-rotate(190deg) saturate(2) brightness(1.1)' }}>⏸️</span> Pause</button>
            )}
            {tick.isPostponed && tick.pendingBreakPhase && (
              <>
                <button
                  className="btn btn-success"
                  onClick={handleTriggerPendingBreakNow}
                  title="Take the pending break right now without waiting"
                  style={{ fontWeight: 600 }}
                >
                  ☕ Take Break Now
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleSkip}
                  title="Skip the pending break and continue with current flow"
                >
                  <span style={{ display: 'inline-block', filter: 'hue-rotate(280deg) saturate(1.5) brightness(1.1)' }}>⏭️</span> Skip Pending Break
                </button>
              </>
            )}
            <button 
              className="btn btn-secondary" 
              onClick={handleSkip}
              disabled={skipDisabled}
              title={skipTitle}
              style={skipDisabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            >
              <span style={{ display: 'inline-block', filter: 'hue-rotate(280deg) saturate(1.5) brightness(1.1)' }}>⏭️</span> Skip
            </button>
            
            {/* Flow shuffle controls - only for flow-based schedules (before Reset) */}
            {tick.scheduleMode === 'flow-based' && (
              <>
                <span style={{ color: '#64748b', margin: '0 0.25rem' }}>|</span>
                <button 
                  className="btn btn-secondary" 
                  onClick={handleShuffleFlow} 
                  title="Shuffle: Swap sit/stand order (start with standing)"
                >
                  🔀 Shuffle
                </button>
                <button 
                  className="btn btn-secondary" 
                  onClick={handleReverseFlow} 
                  title="Reverse: Reverse entire flow order (start with break)"
                >
                  ↩️ Reverse
                </button>
              </>
            )}
            
            {/* Reset Controls */}
            <span style={{ color: '#64748b', margin: '0 0.25rem' }}>|</span>
            <button className="btn btn-secondary" onClick={handleResetSession} title="Reset Session">🔄 Reset Session</button>
            <button className="btn btn-secondary" onClick={handleResetTodayCounters} title="Reset Today's Counters">📊 Reset Counters</button>
            
            {/* Extend buttons - inline, only for work phases */}
            {(tick.currentPhase === 'sit' || tick.currentPhase === 'stand') && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'nowrap' }}>
                <span style={{ color: '#e2e8f0', fontSize: '0.85rem', fontWeight: 600 }}>Extend:</span>
                {extendOptions.map((minutes) => (
                  <button 
                    key={minutes}
                    className="btn btn-secondary" 
                    onClick={() => handleExtendPhase(minutes)}
                    title={`Extend current ${tick.currentPhase} phase by ${minutes} minutes`}
                    style={{
                      backgroundColor: 'rgba(59, 130, 246, 0.15)',
                      borderColor: 'rgba(59, 130, 246, 0.3)',
                      color: '#3b82f6',
                    }}
                  >
                    +{minutes}
                  </button>
                ))}
              </span>
            )}

            {/* Separator between Extend and Reduce */}
            {(tick.currentPhase === 'sit' || tick.currentPhase === 'stand') && 
              preponeOptions.some(m => tick.phaseRemainingMs > (m * 60000) + 30000) && (
              <span style={{ color: '#475569', margin: '0 0.5rem', fontSize: '1.1rem' }}>|</span>
            )}

            {/* Reduce buttons - inline, only for work phases with enough remaining time */}
            {(tick.currentPhase === 'sit' || tick.currentPhase === 'stand') && 
              preponeOptions.some(m => tick.phaseRemainingMs > (m * 60000) + 30000) && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'nowrap' }}>
                <span style={{ color: '#e2e8f0', fontSize: '0.85rem', fontWeight: 600 }}>Reduce:</span>
                {preponeOptions.filter(m => tick.phaseRemainingMs > (m * 60000) + 30000).map((minutes) => (
                  <button 
                    key={minutes}
                    className="btn btn-secondary" 
                    onClick={() => handlePreponePhase(minutes)}
                    title={`Reduce current ${tick.currentPhase} phase by ${minutes} minutes`}
                    style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.15)',
                      borderColor: 'rgba(239, 68, 68, 0.3)',
                      color: '#ef4444',
                    }}
                  >
                    -{minutes}
                  </button>
                ))}
              </span>
            )}

            {/* Reset Duration button - only shown when duration has been modified (work phases) */}
            {(tick.currentPhase === 'sit' || tick.currentPhase === 'stand') &&
              tick.phaseTotalMs !== tick.phaseOriginalDurationMs && (
              <>
                <span style={{ color: '#475569', margin: '0 0.5rem', fontSize: '1.1rem' }}>|</span>
                <button 
                  className="btn btn-secondary" 
                  onClick={async () => {
                    const success = await window.rhythmDesk.resetPhaseDuration();
                    if (!success) {
                      alert('Cannot reset — no modification to undo or phase already at original duration.');
                    }
                  }}
                  title="Reset to original configured duration"
                  style={{
                    backgroundColor: 'rgba(168, 85, 247, 0.15)',
                    borderColor: 'rgba(168, 85, 247, 0.3)',
                    color: '#a855f7',
                  }}
                >
                  ↺ Reset
                </button>
              </>
            )}
            
            {/* Reset Duration for break phases (outside work-phase block) */}
            {(tick.currentPhase === 'short-break' || tick.currentPhase === 'long-break') &&
              tick.phaseTotalMs !== tick.phaseOriginalDurationMs && (
              <button 
                className="btn btn-secondary" 
                onClick={async () => {
                  const success = await window.rhythmDesk.resetPhaseDuration();
                  if (!success) {
                    alert('Cannot reset — no modification to undo or phase already at original duration.');
                  }
                }}
                title="Reset to original configured duration"
                style={{
                  backgroundColor: 'rgba(168, 85, 247, 0.15)',
                  borderColor: 'rgba(168, 85, 247, 0.3)',
                  color: '#a855f7',
                }}
              >
                ↺ Reset
              </button>
            )}

            {/* Postpone inline */}
            {tick.canPostpone && tick.postponeOptions.length > 0 && (
              <>
                <span style={{ color: '#64748b', margin: '0 0.25rem' }}>|</span>
                {tick.postponeOptions.map((minutes) => (
                  <button key={minutes} className="btn btn-secondary" onClick={() => handlePostpone(minutes)}>
                    +{formatPostponeMinutes(minutes)}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Ad-hoc Break Options - shown when B is pressed during work phase */}
      {showBreakOptions && (tick.currentPhase === 'sit' || tick.currentPhase === 'stand') && (
        <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '0.75rem', border: '1px solid rgba(34, 197, 94, 0.3)', backgroundColor: 'rgba(34, 197, 94, 0.05)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ color: '#22c55e', fontSize: '0.9rem', fontWeight: 600 }}>☕ Take a Break:</span>
            <button className="btn btn-secondary" onClick={() => { window.rhythmDesk.startAdHocBreak(tick.configuredDurations.shortBreakDurationMinutes || 5); setShowBreakOptions(false); }}
              style={{ backgroundColor: 'rgba(34, 197, 94, 0.15)', borderColor: 'rgba(34, 197, 94, 0.3)', color: '#22c55e' }}
              title="Short break from schedule"
            >
              ☕ Short ({tick.configuredDurations.shortBreakDurationMinutes || 5}m)
            </button>
            <button className="btn btn-secondary" onClick={() => { window.rhythmDesk.startAdHocBreak(tick.configuredDurations.longBreakDurationMinutes || 15); setShowBreakOptions(false); }}
              style={{ backgroundColor: 'rgba(234, 179, 8, 0.15)', borderColor: 'rgba(234, 179, 8, 0.3)', color: '#eab308' }}
              title="Long break from schedule"
            >
              🌟 Long ({tick.configuredDurations.longBreakDurationMinutes || 15}m)
            </button>
            <button className="btn btn-secondary" onClick={() => { window.rhythmDesk.startAdHocBreak(10); setShowBreakOptions(false); }}
              style={{ backgroundColor: 'rgba(139, 92, 246, 0.15)', borderColor: 'rgba(139, 92, 246, 0.3)', color: '#8b5cf6' }}
            >
              ⏱️ 10 min
            </button>
            <button className="btn btn-secondary" onClick={() => { window.rhythmDesk.startAdHocBreak(20); setShowBreakOptions(false); }}
              style={{ backgroundColor: 'rgba(139, 92, 246, 0.15)', borderColor: 'rgba(139, 92, 246, 0.3)', color: '#8b5cf6' }}
            >
              ⏱️ 20 min
            </button>
            {/* Custom duration keyboard input */}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginLeft: '0.5rem', padding: '0.25rem 0.5rem', borderRadius: '6px', backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
              <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Type:</span>
              <span style={{ 
                minWidth: '2ch', 
                fontFamily: 'monospace', 
                fontSize: '1rem', 
                fontWeight: 700, 
                color: breakDurationInput ? '#22c55e' : '#475569',
                letterSpacing: '1px',
              }}>
                {breakDurationInput || '··'}
              </span>
              <span style={{ color: '#64748b', fontSize: '0.75rem' }}>min</span>
              {breakDurationInput && parseInt(breakDurationInput, 10) > 0 && (
                <span style={{ color: '#475569', fontSize: '0.75rem', marginLeft: '0.25rem' }}>↵</span>
              )}
            </span>

            <button className="btn btn-secondary" onClick={() => { setShowBreakOptions(false); setBreakDurationInput(''); }}
              style={{ marginLeft: 'auto', opacity: 0.7 }}
              title="Close (Esc/B)"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Row 4: Break Progress - Full Width */}
      <div className="card" style={{ padding: '1rem', marginBottom: 0 }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '0.75rem' }}>Break Progress</div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {/* Short Break - with border */}
          {tick.breakProgress.shortBreakEnabled && (
            <div style={{ padding: '0.75rem', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '8px', backgroundColor: 'rgba(34, 197, 94, 0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1rem', fontWeight: 500, color: '#22c55e' }}>
                  ☕ Next Short Break in <strong style={{ fontSize: '1.1rem' }}>{formatDurationHuman(tick.breakProgress.msUntilNextShortBreak)}</strong>
                </span>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  every {tick.breakProgress.shortBreakEveryMinutes}m • {tick.breakProgress.shortBreakDurationMinutes}m duration
                </span>
              </div>
              <div style={{ height: '8px', backgroundColor: 'rgba(34, 197, 94, 0.2)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${tick.breakProgress.shortBreakProgress * 100}%`, height: '100%', backgroundColor: '#22c55e' }} />
              </div>
            </div>
          )}
          
          {/* Long Break - with border */}
          {tick.breakProgress.longBreakEnabled && (
            <div style={{ padding: '0.75rem', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '8px', backgroundColor: 'rgba(245, 158, 11, 0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1rem', fontWeight: 500, color: '#f59e0b' }}>
                  🌴 Next Long Break in <strong style={{ fontSize: '1.1rem' }}>{formatDurationHuman(tick.breakProgress.msUntilNextLongBreak)}</strong>
                </span>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  every {tick.breakProgress.longBreakEveryMinutes}m • {tick.breakProgress.longBreakDurationMinutes}m duration
                </span>
              </div>
              <div style={{ height: '8px', backgroundColor: 'rgba(245, 158, 11, 0.2)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${tick.breakProgress.longBreakProgress * 100}%`, height: '100%', backgroundColor: '#f59e0b' }} />
              </div>
            </div>
          )}
        </div>
        
        {!tick.breakProgress.shortBreakEnabled && !tick.breakProgress.longBreakEnabled && (
          <span style={{ fontSize: '0.95rem', color: '#64748b' }}>No breaks configured for this schedule</span>
        )}
      </div>

      {/* Row 5: Rest Blocks - Quick Access */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#e2e8f0' }}>🛋️ Take a Rest</div>
          {tick.restBlock.isActive ? (
            <span style={{ fontSize: '0.75rem', color: '#22c55e', fontWeight: 500 }}>
              Active: {tick.restBlock.name}
            </span>
          ) : (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={restStrictMode}
                onChange={(e) => setRestStrictMode(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span style={{ fontSize: '0.8rem', color: restStrictMode ? '#ef4444' : '#94a3b8' }}>
                🔒 Strict Mode
              </span>
            </label>
          )}
        </div>
        
        {tick.restBlock.isActive ? (
          <div style={{ 
            padding: '1rem', 
            backgroundColor: 'rgba(34, 197, 94, 0.1)', 
            borderRadius: '8px', 
            border: '1px solid rgba(34, 197, 94, 0.3)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#22c55e', marginBottom: '0.25rem' }}>
              {tick.restBlock.name}
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: '#22c55e', fontFamily: 'monospace', marginBottom: '0.5rem' }}>
              {formatDuration(tick.restBlock.remainingMs)}
            </div>
            <div style={{ height: '8px', backgroundColor: 'rgba(34, 197, 94, 0.2)', borderRadius: '4px', overflow: 'hidden', marginBottom: '0.75rem' }}>
              <div style={{ 
                width: `${((tick.restBlock.durationMs - tick.restBlock.remainingMs) / tick.restBlock.durationMs) * 100}%`, 
                height: '100%', 
                backgroundColor: '#22c55e',
                transition: 'width 0.3s ease'
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', alignItems: 'center' }}>
              {tick.restBlock.isStrictMode ? (
                <span style={{ fontSize: '0.8rem', color: '#ef4444' }}>🔒 Strict Mode - Cannot end early</span>
              ) : (
                <button 
                  className="btn btn-secondary" 
                  onClick={handleStopRestBlock}
                  style={{ padding: '0.4rem 1rem' }}
                >
                  End Rest
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem' }}>
              {DEFAULT_REST_BLOCK_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className="btn btn-secondary"
                  onClick={() => handleStartRestBlock(preset.name, preset.durationMinutes, restStrictMode)}
                  style={{ 
                    padding: '0.5rem 0.5rem',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    width: '100%'
                  }}
                >
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{preset.name}</span>
                  <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                    {preset.durationMinutes >= 60 ? `${preset.durationMinutes / 60}h` : `${preset.durationMinutes}m`}
                  </span>
                </button>
              ))}
            </div>
            {/* Custom duration row with name input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
              <input
                type="text"
                value={restCustomName}
                onChange={(e) => setRestCustomName(e.target.value)}
                placeholder="Break name"
                style={{
                  width: '100px',
                  padding: '0.3rem 0.5rem',
                  borderRadius: '4px',
                  border: '1px solid #374151',
                  backgroundColor: '#1f2937',
                  color: '#e2e8f0'
                }}
              />
              <input
                type="number"
                min="0"
                max="23"
                value={restCustomHours}
                onChange={(e) => setRestCustomHours(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))}
                style={{
                  width: '50px',
                  padding: '0.3rem 0.5rem',
                  borderRadius: '4px',
                  border: '1px solid #374151',
                  backgroundColor: '#1f2937',
                  color: '#e2e8f0',
                  textAlign: 'center'
                }}
              />
              <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>h</span>
              <input
                type="number"
                min="0"
                max="59"
                value={restCustomMinutes}
                onChange={(e) => setRestCustomMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                style={{
                  width: '50px',
                  padding: '0.3rem 0.5rem',
                  borderRadius: '4px',
                  border: '1px solid #374151',
                  backgroundColor: '#1f2937',
                  color: '#e2e8f0',
                  textAlign: 'center'
                }}
              />
              <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>m</span>
              <button
                className="btn btn-primary"
                onClick={() => handleStartRestBlock(restCustomName || 'Custom Rest', restCustomHours * 60 + restCustomMinutes, restStrictMode)}
                disabled={restCustomHours === 0 && restCustomMinutes === 0}
                style={{ padding: '0.3rem 0.75rem', marginLeft: 'auto' }}
              >
                Start
              </button>
            </div>
          </>
        )}
      </div>

      {/* Row 6: Configured Durations - 2 rows */}
      <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: 0 }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '0.5rem' }}>Configured Durations</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {/* Row 1: Work + Transitions */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
            <div style={{ padding: '0.5rem', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Sitting</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#3b82f6' }}>{tick.configuredDurations.sitMinutes}m</div>
            </div>
            <div style={{ padding: '0.5rem', backgroundColor: 'rgba(34, 197, 94, 0.1)', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Standing</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#22c55e' }}>{tick.configuredDurations.standMinutes}m</div>
            </div>
            <div style={{ padding: '0.5rem', backgroundColor: 'rgba(168, 85, 247, 0.1)', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Sit→Stand</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#a855f7' }}>{tick.configuredDurations.sitToStandTransitionSeconds}s</div>
            </div>
            <div style={{ padding: '0.5rem', backgroundColor: 'rgba(236, 72, 153, 0.1)', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Stand→Sit</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#ec4899' }}>{tick.configuredDurations.standToSitTransitionSeconds}s</div>
            </div>
          </div>
          {/* Row 2: Break Duration + Break Interval (4 blocks) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
            <div style={{ padding: '0.5rem', backgroundColor: 'rgba(14, 165, 233, 0.1)', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>☕ Short Break</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0ea5e9' }}>{tick.configuredDurations.shortBreakDurationMinutes}m</div>
            </div>
            <div style={{ padding: '0.5rem', backgroundColor: 'rgba(14, 165, 233, 0.08)', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Short Break Every</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0ea5e9' }}>{tick.breakProgress.shortBreakEveryMinutes}m</div>
            </div>
            <div style={{ padding: '0.5rem', backgroundColor: 'rgba(249, 115, 22, 0.1)', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>🌴 Long Break</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f97316' }}>{tick.configuredDurations.longBreakDurationMinutes}m</div>
            </div>
            <div style={{ padding: '0.5rem', backgroundColor: 'rgba(249, 115, 22, 0.08)', borderRadius: '6px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Long Break Every</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f97316' }}>{tick.breakProgress.longBreakEveryMinutes}m</div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Phase 1.5: Session Debug Panel (Dev Mode Only) */}
      {process.env.NODE_ENV === 'development' && tick.debugSnapshot && (
        <div style={{
          backgroundColor: '#1e1b4b',
          borderRadius: '12px',
          padding: '1rem',
          marginTop: '1rem',
          border: '1px solid rgba(139, 92, 246, 0.3)',
        }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem', 
            marginBottom: '0.75rem',
            color: '#a78bfa',
            fontSize: '0.85rem',
            fontWeight: 600,
          }}>
            🔧 Session Debug Info
            <span style={{
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '0.7rem',
              fontWeight: 700,
              backgroundColor: tick.debugSnapshot.validationStatus === 'ok' 
                ? 'rgba(34, 197, 94, 0.2)' 
                : tick.debugSnapshot.validationStatus === 'warning'
                ? 'rgba(251, 191, 36, 0.2)'
                : 'rgba(239, 68, 68, 0.2)',
              color: tick.debugSnapshot.validationStatus === 'ok' 
                ? '#22c55e' 
                : tick.debugSnapshot.validationStatus === 'warning'
                ? '#fbbf24'
                : '#ef4444',
            }}>
              {tick.debugSnapshot.validationStatus.toUpperCase()}
            </span>
          </div>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(3, 1fr)', 
            gap: '0.5rem',
            fontSize: '0.75rem',
          }}>
            <div style={{ padding: '0.4rem', backgroundColor: 'rgba(139, 92, 246, 0.1)', borderRadius: '6px' }}>
              <div style={{ color: '#94a3b8', marginBottom: '2px' }}>currentPhase</div>
              <div style={{ color: '#e0e7ff', fontFamily: 'monospace' }}>{tick.currentPhase}</div>
            </div>
            <div style={{ padding: '0.4rem', backgroundColor: 'rgba(139, 92, 246, 0.1)', borderRadius: '6px' }}>
              <div style={{ color: '#94a3b8', marginBottom: '2px' }}>flowIndex</div>
              <div style={{ color: '#e0e7ff', fontFamily: 'monospace' }}>
                {tick.debugSnapshot.currentFlowStepIndex ?? 'N/A'} / {tick.debugSnapshot.flowStepsCount || 'N/A'}
              </div>
            </div>
            <div style={{ padding: '0.4rem', backgroundColor: 'rgba(139, 92, 246, 0.1)', borderRadius: '6px' }}>
              <div style={{ color: '#94a3b8', marginBottom: '2px' }}>nextPhase</div>
              <div style={{ color: '#e0e7ff', fontFamily: 'monospace' }}>{tick.nextPhase}</div>
            </div>
            <div style={{ padding: '0.4rem', backgroundColor: 'rgba(139, 92, 246, 0.1)', borderRadius: '6px' }}>
              <div style={{ color: '#94a3b8', marginBottom: '2px' }}>cumulativeWork</div>
              <div style={{ color: '#e0e7ff', fontFamily: 'monospace' }}>{Math.round(tick.cumulativeWorkTimeMs / 1000)}s</div>
            </div>
            <div style={{ padding: '0.4rem', backgroundColor: 'rgba(139, 92, 246, 0.1)', borderRadius: '6px' }}>
              <div style={{ color: '#94a3b8', marginBottom: '2px' }}>pendingBreak</div>
              <div style={{ color: '#e0e7ff', fontFamily: 'monospace' }}>{tick.pendingBreakPhase || 'none'}</div>
            </div>
            <div style={{ padding: '0.4rem', backgroundColor: 'rgba(139, 92, 246, 0.1)', borderRadius: '6px' }}>
              <div style={{ color: '#94a3b8', marginBottom: '2px' }}>postponeIn</div>
              <div style={{ color: '#e0e7ff', fontFamily: 'monospace' }}>
                {tick.pendingBreakInMs > 0 ? `${Math.round(tick.pendingBreakInMs / 1000)}s` : 'N/A'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DashboardPage;
