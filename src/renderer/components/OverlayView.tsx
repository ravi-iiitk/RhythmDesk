/**
 * RhythmDesk Overlay View
 * Fullscreen overlay for phase transitions and breaks
 * 
 * Phase 2: Added heartbeat response for overlay sync watchdog
 */

import React, { useEffect, useState, useCallback } from 'react';
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
  // Pause reminder state
  const [pauseReminderData, setPauseReminderData] = useState<{ pausedForMs: number; pausedAt: number } | null>(null);
  // Water reminder state
  const [waterReminderActive, setWaterReminderActive] = useState(false);
  // Break extend minutes from settings (use first option)
  const [breakExtendMinutes, setBreakExtendMinutes] = useState(2);
  
  
  // Update current time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(formatCurrentTime());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Listen for pause reminder events
  useEffect(() => {
    const cleanup = window.rhythmDesk.onShowPauseReminder((data) => {
      setPauseReminderData(data);
    });
    return cleanup;
  }, []);

  // Listen for water reminder events
  useEffect(() => {
    const cleanup = window.rhythmDesk.onShowWaterReminder(() => {
      setWaterReminderActive(true);
    });
    return cleanup;
  }, []);

  // Sync water reminder state from tick data (handles overlay recreation)
  // If tick says water reminder is active but our local state doesn't know, sync it
  useEffect(() => {
    if (tick?.waterReminderActive && !waterReminderActive) {
      console.log('[OverlayView] Restoring water reminder state from tick');
      setWaterReminderActive(true);
    }
  }, [tick?.waterReminderActive]);

  // Emergency escape key - ALWAYS works to close overlay (even for water/pause reminders)
  // This prevents users from being locked out of their system
  useEffect(() => {
    const handleEmergencyEscape = (e: KeyboardEvent) => {
      // Ctrl+Shift+Escape = emergency close (works even in strict mode)
      if (e.ctrlKey && e.shiftKey && e.key === 'Escape') {
        console.log('[OverlayView] Emergency escape triggered');
        // Dismiss any active reminders
        if (waterReminderActive) {
          setWaterReminderActive(false);
          window.rhythmDesk.dismissWaterReminder();
        }
        if (pauseReminderData) {
          setPauseReminderData(null);
        }
        // Close overlay
        window.rhythmDesk.closeOverlay();
      }
      // Regular Escape for water reminder (since it has no strict mode)
      if (e.key === 'Escape' && waterReminderActive) {
        setWaterReminderActive(false);
        window.rhythmDesk.dismissWaterReminder();
      }
      // Regular Escape for pause reminder
      if (e.key === 'Escape' && pauseReminderData) {
        setPauseReminderData(null);
        window.rhythmDesk.closeOverlay();
      }
    };
    window.addEventListener('keydown', handleEmergencyEscape);
    return () => window.removeEventListener('keydown', handleEmergencyEscape);
  }, [waterReminderActive, pauseReminderData]);

  // Fetch break extend minutes from settings
  useEffect(() => {
    window.rhythmDesk.getConfig()
      .then((config) => {
        const options = config?.generalSettings?.extendOptions;
        if (options && options.length > 0) {
          setBreakExtendMinutes(options[0]);
        } else if (config?.generalSettings?.breakExtendMinutes) {
          setBreakExtendMinutes(config.generalSettings.breakExtendMinutes);
        }
      })
      .catch((err) => {
        console.error('[OverlayView] Failed to fetch config:', err);
      });
  }, []);

  // Clear pause reminder when timer resumes
  useEffect(() => {
    if (tick && !tick.isPaused && pauseReminderData) {
      setPauseReminderData(null);
    }
  }, [tick?.isPaused]);

  // Phase 2: Respond to heartbeat requests from main process
  // CRITICAL: Must be before ALL early returns — if tick is null this still needs to fire
  // otherwise the watchdog marks the overlay stale and force-recreates it in strict mode
  useEffect(() => {
    const cleanup = window.rhythmDesk.onHeartbeatRequest(() => {
      window.rhythmDesk.sendHeartbeatResponse();
    });
    return cleanup;
  }, []);

  // Keyboard shortcuts for overlay
  // CRITICAL: Must be before ALL early returns — hooks must always be called in the same order
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!tick) return; // No tick data yet, ignore keys
    const isBreakOrTransition = [
      'sit-to-stand-transition', 'stand-to-sit-transition', 
      'short-break', 'long-break'
    ].includes(tick.currentPhase);
    const canClose = !tick.isStrictMode && !tick.officeFocusLock.isActive;
    const canSkip = isBreakOrTransition && !(tick.noSkipEnabled ?? false) && tick.canSkipCurrentBreak !== false;

    switch (e.key) {
      case ' ': // Space - pause/resume
        e.preventDefault();
        if (tick.isPaused) {
          window.rhythmDesk.resume();
        } else {
          window.rhythmDesk.pause();
        }
        break;
      case 'Enter': // Enter - complete/done
        if (isBreakOrTransition && !tick.isStrictMode) {
          window.rhythmDesk.completePhase();
        }
        break;
      case 's': // S - skip
      case 'S':
        if (canSkip) {
          window.rhythmDesk.skipPhase();
        }
        break;
      case 'e': // E - extend break (only on breaks, not transitions)
      case 'E':
        if (tick.currentPhase === 'short-break' || tick.currentPhase === 'long-break') {
          window.rhythmDesk.extendBreak(breakExtendMinutes);
        }
        break;
      case 'Escape': // Escape - close overlay
        if (canClose) {
          window.rhythmDesk.closeOverlay();
        }
        break;
      case '1': // 1-5 - postpone options
      case '2':
      case '3':
      case '4':
      case '5':
        if (tick.canPostpone && tick.postponeOptions && tick.postponeOptions.length > 0) {
          const index = parseInt(e.key) - 1;
          if (index < tick.postponeOptions.length) {
            window.rhythmDesk.postpone(tick.postponeOptions[index]);
          }
        }
        break;
    }
  }, [tick, breakExtendMinutes]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Show nothing while waiting for first tick - prevents idle flash
  // NOTE: all hooks above must stay before this return
  if (!tick && !pauseReminderData && !waterReminderActive) {
    return <div className="overlay" style={{ backgroundColor: '#0f0f1a' }} />;
  }

  // Pause reminder overlay (can render even without tick data)
  if (pauseReminderData) {
    const pausedMinutes = Math.floor((Date.now() - pauseReminderData.pausedAt) / 60000);
    return (
      <div className="overlay">
        <div className="overlay-content">
          <div style={{
            textAlign: 'center',
            marginBottom: '0.5rem',
          }}>
            <div style={{
              fontSize: '5rem',
              fontWeight: 600,
              color: 'rgba(148, 163, 184, 0.9)',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '0.02em',
              textShadow: '0 2px 20px rgba(148, 163, 184, 0.15)',
            }}>{currentTime}</div>
          </div>

          <div style={{
            fontSize: '4rem',
            marginBottom: '0.5rem',
          }}>⏸️</div>

          <div className="overlay-phase" style={{ color: '#fbbf24' }}>
            Schedule is Paused
          </div>

          <div className="overlay-message" style={{ fontSize: '1.5rem', marginTop: '1rem' }}>
            Paused for {pausedMinutes} minute{pausedMinutes !== 1 ? 's' : ''}
          </div>

          <div className="overlay-message" style={{ opacity: 0.6, marginTop: '0.5rem' }}>
            Your posture schedule is not running. Resume to continue tracking.
          </div>

          <div className="overlay-actions" style={{ marginTop: '2rem', gap: '1rem' }}>
            <button
              className="btn btn-success"
              style={{
                fontSize: '1.2rem',
                padding: '0.75rem 2rem',
              }}
              onClick={() => {
                window.rhythmDesk.resume();
                setPauseReminderData(null);
                window.rhythmDesk.dismissPauseReminder();
              }}
            >
              ▶ Resume Schedule
            </button>
            <button
              className="btn btn-secondary"
              style={{
                fontSize: '1rem',
                padding: '0.5rem 1.5rem',
              }}
              onClick={() => {
                setPauseReminderData(null);
                window.rhythmDesk.dismissPauseReminder();
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Water reminder overlay - hydration reminder with water-themed colors
  if (waterReminderActive) {
    return (
      <div className="overlay" style={{ 
        background: 'linear-gradient(135deg, #0077b6 0%, #00b4d8 50%, #90e0ef 100%)',
      }}>
        <div className="overlay-content">
          <div style={{
            textAlign: 'center',
            marginBottom: '0.5rem',
          }}>
            <div style={{
              fontSize: '5rem',
              fontWeight: 600,
              color: 'rgba(255, 255, 255, 0.9)',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '0.02em',
              textShadow: '0 2px 20px rgba(0, 0, 0, 0.2)',
            }}>{currentTime}</div>
          </div>

          <div style={{
            fontSize: '6rem',
            marginBottom: '0.5rem',
          }}>💧</div>

          <div className="overlay-phase" style={{ 
            color: '#ffffff',
            fontSize: '2.5rem',
            fontWeight: 700,
            textShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
          }}>
            Time to Hydrate!
          </div>

          <div className="overlay-message" style={{ 
            fontSize: '1.5rem', 
            marginTop: '1rem',
            color: 'rgba(255, 255, 255, 0.9)',
          }}>
            Take a moment to drink some water
          </div>

          <div className="overlay-message" style={{ 
            opacity: 0.8, 
            marginTop: '0.5rem',
            color: 'rgba(255, 255, 255, 0.8)',
          }}>
            Staying hydrated improves focus and energy
          </div>

          <div className="overlay-actions" style={{ marginTop: '2rem' }}>
            <button
              className="btn"
              style={{
                fontSize: '1.3rem',
                padding: '1rem 3rem',
                backgroundColor: '#ffffff',
                color: '#0077b6',
                fontWeight: 700,
                border: 'none',
                borderRadius: '12px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)',
                cursor: 'pointer',
              }}
              onClick={() => {
                setWaterReminderActive(false);
                window.rhythmDesk.dismissWaterReminder();
              }}
            >
              ✓ I Drank Water
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  // After pause/water reminder, tick must exist for normal rendering
  if (!tick) {
    return <div className="overlay" style={{ backgroundColor: '#0f0f1a' }} />;
  }

  // Hide overlay for idle state - overlay shouldn't show during idle
  // Exception: rest blocks should still render even with no active schedule
  if (tick.currentPhase === 'idle' && !tick.restBlock?.isActive) {
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
  const handleExtendBreak = () => window.rhythmDesk.extendBreak(breakExtendMinutes);

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
  const isTransitionPhase = tick.currentPhase === 'sit-to-stand-transition' || tick.currentPhase === 'stand-to-sit-transition';
  const breakSkipCountToday = tick.breakSkipCountToday ?? 0;
  const maxBreakSkipsPerDay = tick.maxBreakSkipsPerDay ?? 0;
  const breakSkipsLeftToday = Math.max(0, maxBreakSkipsPerDay - breakSkipCountToday);
  const isOfficeFocusLockActive = tick.officeFocusLock.isActive;
  const noSkipEnabled = tick.noSkipEnabled ?? false;

  // Determine which actions to show based on phase and settings
  // Hide Done button in strict mode - user must wait for timer to complete
  const showDoneButton = isTransitionOrBreak && !tick.isStrictMode;
  const showPostponeButtons = tick.canPostpone && isTransitionOrBreak;
  
  // Skip button logic:
  // - If noSkipEnabled is true, no skipping allowed at all
  // - For breaks: allowed if canSkipCurrentBreak is true (respects daily limits)
  // - For transitions: allowed only if not in strict mode
  const showSkipButton = isTransitionOrBreak && !noSkipEnabled && (
    (isActiveBreakPhase && tick.canSkipCurrentBreak !== false)
    || (!isActiveBreakPhase && !tick.isStrictMode)
  );
  const showSkipPendingBreakButton = tick.isPostponed && !!tick.pendingBreakPhase;
  // In Office Focus Lock during work phase, show stop button instead of close
  // But hide stop button if Focus Mode strict mode is enabled
  // ALWAYS show close button when paused - user should never be trapped while paused
  const showCloseButton = tick.isPaused || (!tick.isStrictMode && !isOfficeFocusLockActive);
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

          {isActiveBreakPhase && (
            <button 
              className="btn btn-secondary" 
              onClick={handleExtendBreak}
              style={{
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                borderColor: 'rgba(59, 130, 246, 0.3)',
                color: '#3b82f6',
              }}
            >
              +{breakExtendMinutes} min
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

        {/* Skip info - shown below action buttons */}
        {isActiveBreakPhase && (
          <div className="overlay-postpone-info" style={{ marginTop: '0.75rem' }}>
            {noSkipEnabled
              ? '🚫 Skip not allowed (disabled in schedule settings)'
              : tick.canSkipCurrentBreak === false
                ? `Break skip limit reached for today (${breakSkipCountToday}/${maxBreakSkipsPerDay})`
                : `Break skips left today: ${breakSkipsLeftToday} (${breakSkipCountToday}/${maxBreakSkipsPerDay} used)`}
          </div>
        )}
        
        {isTransitionPhase && noSkipEnabled && (
          <div className="overlay-postpone-info" style={{ marginTop: '0.75rem' }}>
            🚫 Skip not allowed (disabled in schedule settings)
          </div>
        )}

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

// Error boundary wrapper to catch render crashes

class OverlayErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[OverlayView] RENDER CRASH:', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="overlay" style={{ color: '#ef4444', padding: '2rem', textAlign: 'center' }}>
          <h1>Overlay Render Error</h1>
          <pre style={{ fontSize: '1rem', whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
          <pre style={{ fontSize: '0.8rem', opacity: 0.7, whiteSpace: 'pre-wrap' }}>{this.state.error.stack}</pre>
          <button className="btn" onClick={() => window.rhythmDesk.closeOverlay()} style={{ marginTop: '1rem' }}>Close</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function OverlayViewWithErrorBoundary(props: OverlayViewProps) {
  return (
    <OverlayErrorBoundary>
      <OverlayView {...props} />
    </OverlayErrorBoundary>
  );
}

export default OverlayViewWithErrorBoundary;
