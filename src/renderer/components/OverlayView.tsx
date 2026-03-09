/**
 * RhythmDesk Overlay View
 * Fullscreen overlay for phase transitions and breaks
 */

import { TimerTick, PhaseType } from '../../shared/types';
import { PHASE_DISPLAY_NAMES, PHASE_COLORS } from '../../shared/constants';
import { formatDuration } from '../../shared/timeUtils';

interface OverlayViewProps {
  tick: TimerTick | null;
}

// Phase-specific messages
const PHASE_MESSAGES: Record<PhaseType, string> = {
  'sit': 'Time to work while sitting',
  'stand': 'Time to work while standing',
  'sit-to-stand-transition': 'Stand up and adjust your desk',
  'stand-to-sit-transition': 'Sit down and adjust your desk',
  'short-break': 'Take a short break - stretch and rest your eyes',
  'long-break': 'Take a longer break - walk around and hydrate',
  'idle': 'No active schedule',
};

function OverlayView({ tick }: OverlayViewProps) {
  if (!tick || tick.currentPhase === 'idle') {
    return (
      <div className="overlay">
        <div className="overlay-content">
          <div className="overlay-phase phase-idle">Idle</div>
          <div className="overlay-message">No active schedule</div>
        </div>
      </div>
    );
  }

  const phaseColor = PHASE_COLORS[tick.currentPhase] || PHASE_COLORS['idle'];
  const phaseName = PHASE_DISPLAY_NAMES[tick.currentPhase] || tick.currentPhase;
  const nextPhaseName = PHASE_DISPLAY_NAMES[tick.nextPhase] || tick.nextPhase;
  const message = PHASE_MESSAGES[tick.currentPhase] || '';

  const handleComplete = () => window.postureGuard.completePhase();
  const handlePostpone = (minutes: number) => window.postureGuard.postpone(minutes);
  const handleSkip = () => window.postureGuard.skipPhase();
  const handleCloseOverlay = () => window.postureGuard.closeOverlay();
  const handleStopOfficeFocusLock = () => window.postureGuard.stopOfficeFocusLock();

  // Determine phase type
  const isTransitionOrBreak = [
    'sit-to-stand-transition',
    'stand-to-sit-transition',
    'short-break',
    'long-break',
  ].includes(tick.currentPhase);
  
  const isWorkPhase = tick.currentPhase === 'sit' || tick.currentPhase === 'stand';
  const isOfficeFocusLockActive = tick.officeFocusLock.isActive;

  // Determine which actions to show based on phase and settings
  const showDoneButton = isTransitionOrBreak;
  const showPostponeButtons = tick.canPostpone && isTransitionOrBreak;
  const showSkipButton = !tick.isStrictMode && isTransitionOrBreak;
  // In Office Focus Lock during work phase, show stop button instead of close
  const showCloseButton = !tick.isStrictMode && !isOfficeFocusLockActive;
  const showStopLockButton = isOfficeFocusLockActive && isWorkPhase;

  return (
    <div className="overlay">
      <div className="overlay-content">
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

        {/* Actions */}
        <div className="overlay-actions">
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
                  +{minutes} min
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
            ⏳ Postponed
          </div>
        )}
      </div>
    </div>
  );
}

export default OverlayView;
