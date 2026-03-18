/**
 * RhythmDesk Main App Component
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import SchedulesPage from './pages/SchedulesPage';
import SettingsPage from './pages/SettingsPage';
import OverlayView from './components/OverlayView';
import {
  TimerTick,
  RestBlockState,
  BreakProgress,
  ConfiguredDurations,
  INITIAL_OFFICE_FOCUS_LOCK_STATE,
} from '../shared/types';

const FALLBACK_BREAK_PROGRESS: BreakProgress = {
  shortBreakEnabled: false,
  shortBreakEveryMinutes: 0,
  shortBreakDurationMinutes: 0,
  workTimeSinceShortBreakMs: 0,
  msUntilNextShortBreak: 0,
  shortBreakProgress: 0,
  longBreakEnabled: false,
  longBreakEveryMinutes: 0,
  longBreakDurationMinutes: 0,
  workTimeSinceLongBreakMs: 0,
  msUntilNextLongBreak: 0,
  longBreakProgress: 0,
  nextBreakType: null,
  nextBreakInMs: 0,
  shortBreakCountToday: 0,
  longBreakCountToday: 0,
};

const FALLBACK_CONFIGURED_DURATIONS: ConfiguredDurations = {
  sitMinutes: 0,
  standMinutes: 0,
  sitToStandTransitionSeconds: 0,
  standToSitTransitionSeconds: 0,
  shortBreakDurationMinutes: 0,
  longBreakDurationMinutes: 0,
};

function createFallbackTickForRestBlock(restBlockState: RestBlockState): TimerTick {
  return {
    scheduleId: null,
    scheduleName: 'Rest Block',
    scheduleMode: null,
    currentPhase: 'short-break',
    currentPhaseLabel: 'Rest Block',
    nextPhaseLabel: 'Resume',
    thenPhaseLabel: 'Resume',
    phaseRemainingMs: restBlockState.remainingMs,
    phaseTotalMs: restBlockState.durationMs,
    nextPhase: 'sit',
    nextPhaseDurationMs: 0,
    thenPhase: 'stand',
    thenPhaseDurationMs: 0,
    cumulativeWorkTimeMs: 0,
    isPaused: false,
    isPostponed: false,
    pendingBreakPhase: null,
    pendingBreakInMs: 0,
    isFlowStale: false,
    postponeCountToday: 0,
    maxPostponesPerDay: 0,
    canPostpone: false,
    postponeOptions: [],
    isStrictMode: restBlockState.isStrictMode,
    noSkipEnabled: false,
    breakSkipCountToday: 0,
    maxBreakSkipsPerDay: 0,
    canSkipCurrentBreak: false,
    officeFocusLock: INITIAL_OFFICE_FOCUS_LOCK_STATE,
    restBlock: restBlockState,
    breakProgress: FALLBACK_BREAK_PROGRESS,
    configuredDurations: FALLBACK_CONFIGURED_DURATIONS,
  };
}

function App() {
  const location = useLocation();
  const [currentTick, setCurrentTick] = useState<TimerTick | null>(null);
  const isOverlay = location.pathname === '/overlay';

  // Memoized tick updater that merges rest block state
  const updateTickWithRestBlock = useCallback((restBlockState: RestBlockState) => {
    setCurrentTick((prevTick) => {
      if (!prevTick) {
        // CRITICAL: After overlay reload during long rest block, timer ticks can be paused.
        // Build a safe fallback tick so overlay never becomes blank.
        return createFallbackTickForRestBlock(restBlockState);
      }
      return {
        ...prevTick,
        restBlock: restBlockState,
      };
    });
  }, []);

  useEffect(() => {
    // Subscribe to timer ticks
    const unsubscribeTick = window.rhythmDesk.onTimerTick((tick) => {
      setCurrentTick(tick);
    });

    return () => {
      unsubscribeTick();
    };
  }, []);

  // CRITICAL: Main window health check - respond to prove renderer is alive
  // This allows main process to detect zombie states after system resume
  useEffect(() => {
    if (isOverlay) return; // Only for main window
    
    const unsubscribeHealthCheck = window.rhythmDesk.onHealthCheck(() => {
      // Respond immediately to prove the renderer is alive and functional
      window.rhythmDesk.sendHealthCheckResponse();
    });

    return () => {
      unsubscribeHealthCheck();
    };
  }, [isOverlay]);

  // CRITICAL: Subscribe to REST_BLOCK_CHANGED for overlay
  // This ensures the overlay gets updates even during long rest blocks
  // when TimerEngine tick updates might be insufficient
  useEffect(() => {
    if (!isOverlay) return;

    const unsubscribeRestBlock = window.rhythmDesk.onRestBlockChanged((state: RestBlockState) => {
      // Update the tick's restBlock state directly
      // This is essential for keeping the overlay countdown in sync
      updateTickWithRestBlock(state);
    });

    const unsubscribeResyncData = window.rhythmDesk.onOverlayResyncData((data: {
      tick?: TimerTick | null;
      restBlock?: RestBlockState;
      reason?: string;
    }) => {
      const restBlockState = data.restBlock;
      if (!restBlockState) return;

      if (data.tick) {
        setCurrentTick({ ...data.tick, restBlock: restBlockState });
      } else {
        setCurrentTick(createFallbackTickForRestBlock(restBlockState));
      }

      lastUpdateRef.current = Date.now();
      console.log('[Overlay] Resynced from main process snapshot', {
        reason: data.reason,
        restActive: restBlockState.isActive,
        remainingMs: restBlockState.remainingMs,
      });
    });

    // Request current rest block state immediately on mount
    // This handles the case where the overlay reloads/recovers
    window.rhythmDesk.getRestBlockState().then((state: RestBlockState) => {
      if (state.isActive) {
        console.log('[Overlay] Syncing rest block state on mount:', state.name, state.remainingMs);
        updateTickWithRestBlock(state);
      }
    }).catch((err: Error) => {
      console.error('[Overlay] Failed to get rest block state:', err);
    });

    // Ask main process for authoritative overlay snapshot.
    window.rhythmDesk.requestOverlayResync();

    return () => {
      unsubscribeRestBlock();
      unsubscribeResyncData();
    };
  }, [isOverlay, updateTickWithRestBlock]);
  
  // Watchdog: Detect stale overlay state and request resync
  const lastUpdateRef = useRef<number>(Date.now());
  
  useEffect(() => {
    if (!isOverlay) return;
    
    // Update timestamp on every tick
    lastUpdateRef.current = Date.now();
  }, [currentTick, isOverlay]);
  
  useEffect(() => {
    if (!isOverlay) return;
    
    // Watchdog interval - check every 5 seconds if we've received updates
    const watchdogInterval = setInterval(() => {
      const timeSinceLastUpdate = Date.now() - lastUpdateRef.current;
      
      // If no update in 10 seconds and rest block is supposed to be active, request resync
      if (timeSinceLastUpdate > 10000) {
        console.warn('[Overlay Watchdog] No updates for', timeSinceLastUpdate, 'ms - requesting resync');

        // Request authoritative snapshot from main process.
        window.rhythmDesk.requestOverlayResync();
      }
    }, 5000);
    
    return () => clearInterval(watchdogInterval);
  }, [isOverlay, updateTickWithRestBlock]);

  // Render overlay view for overlay route
  if (location.pathname === '/overlay') {
    return <OverlayView tick={currentTick} />;
  }

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-header">
          <h1>RhythmDesk</h1>
        </div>
        <ul className="nav-links">
          <li>
            <NavLink to="/" className={({ isActive }) => isActive ? 'active' : ''}>
              <span className="nav-icon">📊</span>
              Dashboard
            </NavLink>
          </li>
          <li>
            <NavLink to="/schedules" className={({ isActive }) => isActive ? 'active' : ''}>
              <span className="nav-icon">📅</span>
              Schedules
            </NavLink>
          </li>
          <li>
            <NavLink to="/settings" className={({ isActive }) => isActive ? 'active' : ''}>
              <span className="nav-icon">⚙️</span>
              Settings
            </NavLink>
          </li>
        </ul>
        <div className="sidebar-footer">
          <button 
            className="btn-minimize"
            onClick={() => window.rhythmDesk.minimizeToTray()}
          >
            Minimize to Tray
          </button>
        </div>
      </nav>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<DashboardPage tick={currentTick} />} />
          <Route path="/schedules" element={<SchedulesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
