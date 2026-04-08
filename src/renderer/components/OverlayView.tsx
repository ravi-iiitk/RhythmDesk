/**
 * RhythmDesk Overlay View
 * Fullscreen overlay for phase transitions and breaks
 * 
 * Phase 2: Added heartbeat response for overlay sync watchdog
 */

import { useEffect, useState } from 'react';
import { TimerTick, PhaseType } from '../../shared/types';
import { PHASE_DISPLAY_NAMES, PHASE_COLORS } from '../../shared/constants';
import { formatDuration, formatDurationHuman } from '../../shared/timeUtils';

// Format current time as 12-hour format with seconds (e.g., 10:42:18 PM)
function formatCurrentTime(): string {
  const now = new Date();
  return now.toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: true 
  });
}

interface OverlayViewProps {
  tick: TimerTick | null;
}

// Format minutes into human-readable format (e.g., "1h 15m" or "30m")
function formatPostponeMinutes(minutes: number): string {
  if (minutes <= 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

// Phase-specific messages
const PHASE_MESSAGES: Record<PhaseType, string> = {
  'sit': 'Time to work while sitting',
  'stand': 'Time to work while standing',
  'sit-to-stand-transition': 'Stand up and adjust your desk',
  'stand-to-sit-transition': 'Sit down and adjust your desk',
  'short-break': 'Take a short break - stretch and rest your eyes',
  'long-break': 'Take a longer break - walk around and hydrate',
  'custom': 'Custom activity',
  'idle': 'No active schedule',
};

function OverlayView({ tick }: OverlayViewProps) {
  // Current time state - updates every second
  const [currentTime, setCurrentTime] = useState(formatCurrentTime());
  
  // Update current time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(formatCurrentTime());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Phase 2: Respond to heartbeat requests from main process
  // This allows the watchdog to detect if overlay is frozen/unresponsive
  useEffect(() => {
    const cleanup = window.rhythmDesk.onHeartbeatRequest(() => {
      window.rhythmDesk.sendHeartbeatResponse();
    });
    return cleanup;
  }, []);

  // Show nothing while waiting for first tick - prevents idle flash
  if (!tick) {
    return <div className="overlay" style={{ backgroundColor: '#0f0f1a' }} />;
  }
  
  // Hide overlay for idle state - overlay shouldn't show during idle
  if (tick.currentPhase === 'idle') {
    return <div className="overlay" style={{ backgroundColor: '#0f0f1a' }} />;
  }

  // Use custom step color/message if provided (from FlowStep flags), otherwise use defaults
  const phaseColor = tick.currentStepColor || PHASE_COLORS[tick.currentPhase] || '#6b7280';
  // Use custom labels from tick (includes user-defined flow step labels)
  const phaseName = tick.currentPhaseLabel || PHASE_DISPLAY_NAMES[tick.currentPhase] || tick.currentPhase;
  const nextPhaseName = tick.nextPhaseLabel || PHASE_DISPLAY_NAMES[tick.nextPhase] || tick.nextPhase;
  const message = tick.currentStepMessage || PHASE_MESSAGES[tick.currentPhase] || '';
  
  // Pause support (transitions + custom steps with allowPause enabled)
  const allowPause = tick.currentStepAllowPause ?? false;

  const handleComplete = () => window.rhythmDesk.completePhase();
  const handlePostpone = (minutes: number) => window.rhythmDesk.postpone(minutes);
  const handleSkip = () => window.rhythmDesk.skipPhase();
  const handleCloseOverlay = () => window.rhythmDesk.closeOverlay();
  const handleStopOfficeFocusLock = () => window.rhythmDesk.stopOfficeFocusLock();
  const handleStopRestBlock = () => window.rhythmDesk.stopRestBlock();
  const handlePause = () => window.rhythmDesk.pause();
  const handleResume = () => window.rhythmDesk.resume();

  // Check if rest block is active - takes priority over normal phases
  const isRestBlockActive = tick.restBlock.isActive;

  // Determine phase type
  const isTransitionOrBreak = [
    'sit-to-stand-transition',
    'stand-to-sit-transition',
    'short-break',
    'long-break',
  ].includes(tick.currentPhase) || (tick.currentPhase === 'custom' && tick.currentStepShowOverlay);
  
  const isWorkPhase = tick.currentPhase === 'sit' || tick.currentPhase === 'stand';
  const isActiveBreakPhase = tick.currentPhase === 'short-break' || tick.currentPhase === 'long-break';
  const breakSkipCountToday = tick.breakSkipCountToday ?? 0;
  const maxBreakSkipsPerDay = tick.maxBreakSkipsPerDay ?? 0;
  const breakSkipsLeftToday = Math.max(0, maxBreakSkipsPerDay - breakSkipCountToday);
  const isOfficeFocusLockActive = tick.officeFocusLock.isActive;

  // Determine which actions to show based on phase and settings
  // Hide Done button in strict mode - user must wait for timer to complete
  const showDoneButton = isTransitionOrBreak && !tick.isStrictMode;
  const showPostponeButtons = tick.canPostpone && isTransitionOrBreak;
  const showSkipButton = isTransitionOrBreak && (
    // Active break skip is allowed (with configured daily limits), even in strict mode
    (isActiveBreakPhase && tick.canSkipCurrentBreak !== false)
    // Transition skip remains disabled in strict mode
    || (!isActiveBreakPhase && !tick.isStrictMode)
  );
  const showSkipPendingBreakButton = tick.isPostponed && !!tick.pendingBreakPhase;
  // In Office Focus Lock during work phase, show stop button instead of close
  // But hide stop button if Focus Mode strict mode is enabled
  const showCloseButton = !tick.isStrictMode && !isOfficeFocusLockActive;
  const showStopLockButton = isOfficeFocusLockActive && isWorkPhase && !tick.officeFocusLock.isStrictMode;

  // Current time display style - readable from distance, ~65% of main countdown (8rem)
  // Clean typography, no label, softer than main timer
  const currentTimeStyle: React.CSSProperties = {
    fontSize: '5rem',
    fontWeight: 600,
    color: 'rgba(148, 163, 184, 0.9)', // Softer slate color
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.02em',
    textShadow: '0 2px 20px rgba(148, 163, 184, 0.15)',
  };
  
  const timeContainerStyle: React.CSSProperties = {
    textAlign: 'center',
    marginBottom: '0.5rem',
  };

  // If rest block is active, show rest block overlay
  if (isRestBlockActive) {
    const restBlockColor = '#22c55e'; // Green color for rest
    return (
      <div className="overlay">
        <div className="overlay-content">
          {/* Current Time - Clean, no label */}
          <div style={timeContainerStyle}>
            <div style={currentTimeStyle}>{currentTime}</div>
          </div>
          {/* Rest Block Title */}
          <div className="overlay-schedule-name">
            🛋️ Rest Block
          </div>

          {/* Rest Block Name */}
          <div className="overlay-phase" style={{ color: restBlockColor }}>
            {tick.restBlock.name}
          </div>

          {/* Timer */}
          <div className="overlay-timer" style={{ color: restBlockColor }}>
            {formatDuration(tick.restBlock.remainingMs)}
          </div>

          {/* Message */}
          <div className="overlay-message">
            Take a break and relax
          </div>

          {/* Progress Bar */}
          <div style={{ width: '60%', margin: '1rem auto' }}>
            <div style={{ height: '8px', backgroundColor: 'rgba(34, 197, 94, 0.2)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ 
                width: `${((tick.restBlock.durationMs - tick.restBlock.remainingMs) / tick.restBlock.durationMs) * 100}%`, 
                height: '100%', 
                backgroundColor: restBlockColor,
                transition: 'width 0.3s ease'
              }} />
            </div>
          </div>

          {/* Actions */}
          <div className="overlay-actions">
            {tick.restBlock.isStrictMode ? (
              <div style={{ 
                padding: '0.5rem 1rem', 
                backgroundColor: 'rgba(239, 68, 68, 0.2)', 
                borderRadius: '8px',
                color: '#ef4444'
              }}>
                🔒 Strict Mode - Cannot end early
              </div>
            ) : (
              <button className="btn btn-success" onClick={handleStopRestBlock}>
                End Rest
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay">
      <div className="overlay-content">
        {/* Current Time - Clean, no label */}
        <div style={timeContainerStyle}>
          <div style={currentTimeStyle}>{currentTime}</div>
        </div>
        {/* Schedule Name */}
        <div className="overlay-schedule-name">
          {tick.scheduleName}
        </div>

        {/* Current Phase */}
        <div className="overlay-phase" style={{ color: phaseColor }}>
          {phaseName}
        </div>

        {/* Timer */}
        <div className="overlay-timer" style={{ color: phaseColor }}>
          {formatDuration(tick.phaseRemainingMs)}
        </div>

        {/* Message */}
        <div className="overlay-message">
          {message}
        </div>

        {/* Office Focus Lock Indicator */}
        {isOfficeFocusLockActive && isWorkPhase && (
          <div style={{ 
            marginBottom: '1rem', 
            padding: '0.5rem 1rem', 
            backgroundColor: 'rgba(251, 146, 60, 0.2)', 
            borderRadius: '8px',
            display: 'inline-block'
          }}>
            <span style={{ color: '#fb923c' }}>
              🔒 Office Focus Lock: {tick.officeFocusLock.label} - {formatDuration(tick.officeFocusLock.remainingMs)}
            </span>
          </div>
        )}

        {isActiveBreakPhase && (
          <div className="overlay-postpone-info" style={{ marginTop: '0.75rem' }}>
            {tick.canSkipCurrentBreak === false
              ? `Break skip limit reached for today (${breakSkipCountToday}/${maxBreakSkipsPerDay})`
              : `Break skips left today: ${breakSkipsLeftToday} (${breakSkipCountToday}/${maxBreakSkipsPerDay} used)`}
          </div>
        )}

        {/* Actions */}
        <div className="overlay-actions">
          {showSkipPendingBreakButton && (
            <button className="btn btn-secondary" onClick={handleSkip}>
              ⏭️ Skip Pending Break
            </button>
          )}

          {showDoneButton && (
            <button className="btn btn-success" onClick={handleComplete}>
              ✓ Done
            </button>
          )}

          {showSkipButton && (
            <button className="btn btn-secondary" onClick={handleSkip}>
              Skip
            </button>
          )}

          {allowPause && !tick.isPaused && (
            <button className="btn btn-secondary" onClick={handlePause} style={{
              backgroundColor: 'rgba(251, 191, 36, 0.15)',
              borderColor: 'rgba(251, 191, 36, 0.3)',
              color: '#fbbf24',
            }}>
              ⏸ Pause
            </button>
          )}

          {allowPause && tick.isPaused && (
            <button className="btn btn-success" onClick={handleResume} style={{
              backgroundColor: 'rgba(34, 197, 94, 0.2)',
              borderColor: 'rgba(34, 197, 94, 0.3)',
              color: '#22c55e',
            }}>
              ▶ Resume
            </button>
          )}

          {showStopLockButton && (
            <button className="btn btn-secondary" onClick={handleStopOfficeFocusLock}>
              Stop Office Focus Lock
            </button>
          )}

          {showCloseButton && (
            <button className="btn btn-secondary" onClick={handleCloseOverlay}>
              Close Overlay
            </button>
          )}
        </div>

        {/* Postpone Options */}
        {showPostponeButtons && tick.postponeOptions.length > 0 && (
          <div className="overlay-postpone-info">
            <p>Postpone ({tick.maxPostponesPerDay - tick.postponeCountToday} remaining today)</p>
            <div className="postpone-options">
              {tick.postponeOptions.map((minutes) => (
                <button
                  key={minutes}
                  className="btn btn-secondary"
                  onClick={() => handlePostpone(minutes)}
                >
                  +{formatPostponeMinutes(minutes)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Next Phase Info */}
        <div className="overlay-postpone-info" style={{ marginTop: '2rem' }}>
          Next: {nextPhaseName}
        </div>

        {/* Paused/Postponed Status */}
        {tick.isPaused && (
          <div className="status-badge status-paused" style={{ marginTop: '1rem' }}>
            ⏸ Paused
          </div>
        )}
        {tick.isPostponed && (
          <div className="status-badge status-paused" style={{ marginTop: '1rem' }}>
            ⏳ Pending {tick.pendingBreakPhase ? (PHASE_DISPLAY_NAMES[tick.pendingBreakPhase] || tick.pendingBreakPhase) : 'break'} in {tick.pendingBreakInMs > 60 * 60 * 1000 ? formatDurationHuman(tick.pendingBreakInMs) : formatDuration(tick.pendingBreakInMs)}
          </div>
        )}
      </div>
    </div>
  );
}

export default OverlayView;
