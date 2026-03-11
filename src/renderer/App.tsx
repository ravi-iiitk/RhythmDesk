/**
 * RhythmDesk Main App Component
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import SchedulesPage from './pages/SchedulesPage';
import SettingsPage from './pages/SettingsPage';
import OverlayView from './components/OverlayView';
import { TimerTick, RestBlockState } from '../shared/types';

function App() {
  const location = useLocation();
  const [currentTick, setCurrentTick] = useState<TimerTick | null>(null);
  const isOverlay = location.pathname === '/overlay';

  // Memoized tick updater that merges rest block state
  const updateTickWithRestBlock = useCallback((restBlockState: RestBlockState) => {
    setCurrentTick((prevTick) => {
      if (!prevTick) return prevTick;
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

    return () => {
      unsubscribeRestBlock();
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
        
        // Request current state
        window.rhythmDesk.getRestBlockState().then((state: RestBlockState) => {
          if (state.isActive) {
            console.log('[Overlay Watchdog] Resyncing rest block state:', state.name);
            updateTickWithRestBlock(state);
            lastUpdateRef.current = Date.now();
          }
        }).catch((err: Error) => {
          console.error('[Overlay Watchdog] Failed to resync:', err);
        });
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
