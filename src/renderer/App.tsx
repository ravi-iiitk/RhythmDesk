/**
 * RhythmDesk Main App Component
 */

import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import SchedulesPage from './pages/SchedulesPage';
import SettingsPage from './pages/SettingsPage';
import OverlayView from './components/OverlayView';
import { TimerTick } from '../shared/types';

function App() {
  const location = useLocation();
  const [currentTick, setCurrentTick] = useState<TimerTick | null>(null);

  useEffect(() => {
    // Subscribe to timer ticks
    const unsubscribe = window.postureGuard.onTimerTick((tick) => {
      setCurrentTick(tick);
    });

    return () => {
      unsubscribe();
    };
  }, []);

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
            onClick={() => window.postureGuard.minimizeToTray()}
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
