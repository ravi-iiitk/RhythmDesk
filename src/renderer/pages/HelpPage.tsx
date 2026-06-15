/**
 * RhythmDesk Help Page
 * Comprehensive app usage guide and keyboard shortcuts reference
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Keyboard shortcuts definition
export const KEYBOARD_SHORTCUTS = {
  global: [
    { keys: 'Super+Shift+R', action: 'Bring app to front (maximize & focus)', context: 'System-wide' },
    { keys: 'Super+Shift+B', action: 'Take ad-hoc break (short break from schedule)', context: 'System-wide' },
  ],
  dashboard: [
    { keys: 'Space', action: 'Pause / Resume schedule', context: 'Dashboard' },
    { keys: 'S', action: 'Skip current phase', context: 'Dashboard' },
    { keys: 'R', action: 'Reset session', context: 'Dashboard' },
    { keys: 'N', action: 'Start next activity (when waiting)', context: 'Dashboard' },
    { keys: 'E', action: 'Extend current work phase (sit/stand)', context: 'Dashboard' },
    { keys: 'B', action: 'Toggle ad-hoc break options (short, long, custom)', context: 'Dashboard' },
  ],
  overlay: [
    { keys: 'Space', action: 'Pause / Resume schedule', context: 'Overlay' },
    { keys: 'Enter', action: 'Complete / Done (mark phase complete)', context: 'Overlay' },
    { keys: 'S', action: 'Skip current break/transition', context: 'Overlay' },
    { keys: 'E', action: 'Extend break (+X minutes, breaks only)', context: 'Overlay' },
    { keys: 'Escape', action: 'Close overlay (if not strict mode)', context: 'Overlay' },
    { keys: 'Ctrl+Shift+Escape', action: '🚨 Emergency close (works even in strict mode)', context: 'Overlay' },
    { keys: '1-5', action: 'Postpone break (1=5min, 2=10min, etc.)', context: 'Overlay' },
  ],
  navigation: [
    { keys: 'Alt+1', action: 'Go to Dashboard', context: 'App' },
    { keys: 'Alt+2', action: 'Go to Schedules', context: 'App' },
    { keys: 'Alt+3', action: 'Go to Settings', context: 'App' },
    { keys: 'Alt+4', action: 'Go to Help', context: 'App' },
    { keys: '?', action: 'Open Help page', context: 'App' },
  ],
};

// Collapsible section component
function Section({ title, icon, children, defaultOpen = false }: { 
  title: string; 
  icon: string; 
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div 
        className="card-header" 
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="card-title">{icon} {title}</span>
        <span style={{ float: 'right', opacity: 0.6 }}>{isOpen ? '▼' : '▶'}</span>
      </div>
      {isOpen && <div style={{ padding: '1rem', lineHeight: 1.8 }}>{children}</div>}
    </div>
  );
}

function HelpPage() {
  const navigate = useNavigate();

  // Register navigation shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) {
        switch (e.key) {
          case '1': navigate('/'); break;
          case '2': navigate('/schedules'); break;
          case '3': navigate('/settings'); break;
          case '4': navigate('/help'); break;
        }
      }
      if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        navigate('/help');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  const codeStyle: React.CSSProperties = { 
    backgroundColor: '#1e293b', 
    padding: '0.25rem 0.5rem', 
    borderRadius: '4px',
    fontFamily: 'monospace'
  };

  return (
    <div className="page" style={{ maxWidth: '900px' }}>
      <h1>📖 RhythmDesk Help & User Guide</h1>
      <p style={{ opacity: 0.7, marginBottom: '1.5rem' }}>
        Complete guide to using RhythmDesk for healthy posture and break management.
        Click on any section to expand/collapse.
      </p>

      {/* ==================== GETTING STARTED ==================== */}
      <Section title="Getting Started" icon="🚀" defaultOpen={true}>
        <h4 style={{ color: '#60a5fa', marginBottom: '0.5rem' }}>What is RhythmDesk?</h4>
        <p style={{ marginBottom: '1rem' }}>
          <strong>RhythmDesk</strong> is a desktop application designed to help you maintain healthy work habits by:
        </p>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Alternating between sitting and standing</strong> - Reduces strain from prolonged sitting</li>
          <li><strong>Taking regular short breaks</strong> - Rest your eyes, stretch, prevent RSI</li>
          <li><strong>Taking long breaks</strong> - Walk around, hydrate, reset your focus</li>
          <li><strong>Staying hydrated</strong> - Optional water reminders every X minutes</li>
        </ul>

        <h4 style={{ color: '#60a5fa', marginBottom: '0.5rem' }}>Quick Setup (3 Steps)</h4>
        <ol style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Create a Schedule</strong> - Go to Schedules tab and create your work schedule (e.g., 9 AM - 6 PM)</li>
          <li><strong>Configure Durations</strong> - Set how long you want to sit, stand, and take breaks</li>
          <li><strong>Start Working</strong> - The app will automatically remind you when it's time to switch or take a break</li>
        </ol>

        <h4 style={{ color: '#60a5fa', marginBottom: '0.5rem' }}>System Tray</h4>
        <p>
          RhythmDesk runs in your system tray (notification area). Click the tray icon to access quick controls
          like pause, resume, skip, or open the main window. The app continues running even when you close the window.
        </p>
      </Section>

      {/* ==================== DASHBOARD ==================== */}
      <Section title="Dashboard" icon="📊">
        <p style={{ marginBottom: '1rem' }}>
          The Dashboard is your main control center showing the current state of your schedule.
        </p>

        <h4 style={{ color: '#22c55e', marginBottom: '0.5rem' }}>Current Phase Display</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Phase Name</strong> - Shows current activity (Sit, Stand, Short Break, etc.)</li>
          <li><strong>Timer</strong> - Countdown showing time remaining in current phase</li>
          <li><strong>Progress Bar</strong> - Visual indicator of phase completion</li>
          <li><strong>Next Phase</strong> - Shows what's coming up next</li>
        </ul>

        <h4 style={{ color: '#22c55e', marginBottom: '0.5rem' }}>Quick Actions</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Pause/Resume</strong> - Temporarily stop the timer (keyboard: <code style={codeStyle}>Space</code>)</li>
          <li><strong>Skip</strong> - Skip the current phase (keyboard: <code style={codeStyle}>S</code>)</li>
          <li><strong>Reset Session</strong> - Start the schedule from the beginning (keyboard: <code style={codeStyle}>R</code>)</li>
          <li><strong>Reset Today's Counters</strong> - Reset daily break/skip counters</li>
        </ul>

        <h4 style={{ color: '#22c55e', marginBottom: '0.5rem' }}>Flow Controls (Flow-Based Mode)</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Shuffle Flow</strong> - Randomize the order of activities in your flow</li>
          <li><strong>Reverse Flow</strong> - Reverse the order of activities</li>
          <li><strong>Start Next Activity</strong> - When auto-start is disabled, manually start the next activity</li>
          <li><strong>Restart Current</strong> - Restart the current activity from the beginning</li>
        </ul>

        <h4 style={{ color: '#22c55e', marginBottom: '0.5rem' }}>Statistics</h4>
        <ul style={{ marginLeft: '1.5rem' }}>
          <li><strong>Today's Sit/Stand Time</strong> - Total time spent in each position today</li>
          <li><strong>Breaks Taken</strong> - Number of short and long breaks completed</li>
          <li><strong>Breaks Skipped</strong> - Number of breaks skipped (limited per day)</li>
          <li><strong>Postpones Used</strong> - Number of postpones used today</li>
        </ul>
      </Section>

      {/* ==================== SCHEDULES ==================== */}
      <Section title="Schedules" icon="📅">
        <p style={{ marginBottom: '1rem' }}>
          Schedules define when RhythmDesk is active and what durations to use for each activity.
        </p>

        <h4 style={{ color: '#f59e0b', marginBottom: '0.5rem' }}>Schedule Settings</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Name</strong> - Give your schedule a descriptive name (e.g., "Morning Work", "Afternoon Focus")</li>
          <li><strong>Active Days</strong> - Select which days of the week this schedule is active</li>
          <li><strong>Start/End Time</strong> - Define the time window when the schedule runs</li>
          <li><strong>Enabled</strong> - Toggle to enable/disable the schedule</li>
        </ul>

        <h4 style={{ color: '#f59e0b', marginBottom: '0.5rem' }}>Duration Settings</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Sit Duration</strong> - How long to work while seated (e.g., 25 minutes)</li>
          <li><strong>Stand Duration</strong> - How long to work while standing (e.g., 10 minutes)</li>
          <li><strong>Sit→Stand Transition</strong> - Time given to switch from sitting to standing (e.g., 30 seconds)</li>
          <li><strong>Stand→Sit Transition</strong> - Time given to switch from standing to sitting</li>
        </ul>

        <h4 style={{ color: '#f59e0b', marginBottom: '0.5rem' }}>Break Settings</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Short Break</strong> - Quick rest (e.g., 5 minutes every 30 minutes of work)</li>
          <li><strong>Long Break</strong> - Extended rest (e.g., 15 minutes every 2 hours of work)</li>
          <li><strong>Break Duration</strong> - How long each break lasts</li>
          <li><strong>Break Interval</strong> - How often breaks occur (based on work time)</li>
        </ul>

        <h4 style={{ color: '#f59e0b', marginBottom: '0.5rem' }}>Schedule Modes</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li>
            <strong>Rule-Based Mode</strong> - Simple alternating pattern: Sit → Stand → Sit → Stand...
            with breaks triggered automatically based on work time.
          </li>
          <li>
            <strong>Flow-Based Mode</strong> - Advanced mode where you define a custom sequence of activities.
            Example: Sit (25m) → Short Break (5m) → Stand (10m) → Sit (25m) → Long Break (15m).
            Each step can have custom duration, color, and overlay settings.
          </li>
        </ul>

        <h4 style={{ color: '#f59e0b', marginBottom: '0.5rem' }}>Advanced Options</h4>
        <ul style={{ marginLeft: '1.5rem' }}>
          <li><strong>Strict Mode</strong> - Prevents skipping breaks (overlay cannot be dismissed)</li>
          <li><strong>No Skip</strong> - Disables the skip button entirely</li>
          <li><strong>Auto-Start Next Activity</strong> - Automatically start next activity when current one ends</li>
          <li><strong>Max Postpones Per Day</strong> - Limit how many times breaks can be postponed</li>
          <li><strong>Max Break Skips Per Day</strong> - Limit how many breaks can be skipped</li>
          <li><strong>Postpone Options</strong> - Configure available postpone durations (5, 10, 15 min, etc.)</li>
        </ul>
      </Section>

      {/* ==================== OVERLAY ==================== */}
      <Section title="Fullscreen Overlay" icon="🖥️">
        <p style={{ marginBottom: '1rem' }}>
          The overlay is a fullscreen notification that appears during transitions and breaks,
          ensuring you don't miss important reminders.
        </p>

        <h4 style={{ color: '#ec4899', marginBottom: '0.5rem' }}>When Does the Overlay Appear?</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Sit→Stand Transition</strong> - Time to switch from sitting to standing</li>
          <li><strong>Stand→Sit Transition</strong> - Time to switch from standing to sitting</li>
          <li><strong>Short Break</strong> - Time for a quick rest</li>
          <li><strong>Long Break</strong> - Time for an extended break</li>
          <li><strong>Water Reminder</strong> - Hydration reminder (if enabled)</li>
          <li><strong>Pause Reminder</strong> - Reminder that schedule is paused (every 5 minutes)</li>
        </ul>

        <h4 style={{ color: '#ec4899', marginBottom: '0.5rem' }}>Overlay Actions</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Done / Complete</strong> - Mark the activity as complete and move to next phase (<code style={codeStyle}>Enter</code>)</li>
          <li><strong>Skip</strong> - Skip this break/transition (<code style={codeStyle}>S</code>)</li>
          <li><strong>Extend (+X min)</strong> - Add more time to current break (<code style={codeStyle}>E</code>)</li>
          <li><strong>Postpone</strong> - Delay the break by 5, 10, 15+ minutes (<code style={codeStyle}>1-5</code>)</li>
          <li><strong>Pause</strong> - Pause the entire schedule (<code style={codeStyle}>Space</code>)</li>
          <li><strong>Close Overlay</strong> - Dismiss overlay without action (<code style={codeStyle}>Escape</code>)</li>
        </ul>

        <h4 style={{ color: '#ec4899', marginBottom: '0.5rem' }}>Overlay Information</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Current Time</strong> - Large clock display at the top</li>
          <li><strong>Phase Name</strong> - What activity you should be doing</li>
          <li><strong>Timer</strong> - Countdown for the current phase</li>
          <li><strong>Next Phase</strong> - What's coming up after this</li>
          <li><strong>Suggestion</strong> - Helpful tip for the current activity</li>
        </ul>

        <h4 style={{ color: '#ec4899', marginBottom: '0.5rem' }}>Strict Mode Overlay</h4>
        <p>
          When Strict Mode is enabled in your schedule, the overlay cannot be dismissed or skipped.
          You must wait for the timer to complete. This ensures you actually take your breaks.
          The Close and Skip buttons will be hidden in strict mode.
        </p>
      </Section>

      {/* ==================== OFFICE FOCUS LOCK ==================== */}
      <Section title="Office Focus Lock" icon="🔒">
        <p style={{ marginBottom: '1rem' }}>
          Office Focus Lock is a manual mode that locks you into a focused work session
          with enforced breaks. Perfect for deep work sessions.
        </p>

        <h4 style={{ color: '#f97316', marginBottom: '0.5rem' }}>How to Use</h4>
        <ol style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li>Click "Start Office Focus Lock" on the Dashboard</li>
          <li>Select a label (e.g., "Deep Work", "Client Call")</li>
          <li>Choose duration (30 min, 1 hour, 2 hours, or custom)</li>
          <li>Optionally enable Strict Mode</li>
          <li>Click Start - the overlay will appear during work phases</li>
        </ol>

        <h4 style={{ color: '#f97316', marginBottom: '0.5rem' }}>Features</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Timed Session</strong> - Focus Lock runs for a set duration</li>
          <li><strong>Enforced Breaks</strong> - Breaks still occur during Focus Lock</li>
          <li><strong>Strict Mode Option</strong> - Prevents dismissing the overlay</li>
          <li><strong>Stop Anytime</strong> - Can be stopped early if needed (unless strict)</li>
        </ul>

        <h4 style={{ color: '#f97316', marginBottom: '0.5rem' }}>Use Cases</h4>
        <ul style={{ marginLeft: '1.5rem' }}>
          <li>Deep work sessions requiring full focus</li>
          <li>Pomodoro-style work blocks</li>
          <li>Preventing distractions during important tasks</li>
          <li>Training yourself to take regular breaks</li>
        </ul>
      </Section>

      {/* ==================== REST BLOCK ==================== */}
      <Section title="Rest Block" icon="🛋️">
        <p style={{ marginBottom: '1rem' }}>
          Rest Block is an extended break mode that pauses all reminders.
          Use it for lunch, meetings, or any time you need uninterrupted time away.
        </p>

        <h4 style={{ color: '#22c55e', marginBottom: '0.5rem' }}>How to Use</h4>
        <ol style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li>Click "Start Rest Block" on the Dashboard</li>
          <li>Choose a preset (Lunch Break, Coffee Break, etc.) or custom duration</li>
          <li>Optionally enable Strict Mode</li>
          <li>Click Start - all schedule reminders are paused</li>
        </ol>

        <h4 style={{ color: '#22c55e', marginBottom: '0.5rem' }}>Presets</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Quick Break</strong> - 5 minutes</li>
          <li><strong>Coffee Break</strong> - 15 minutes</li>
          <li><strong>Lunch Break</strong> - 30 minutes</li>
          <li><strong>Long Lunch</strong> - 60 minutes</li>
          <li><strong>Custom</strong> - Set your own duration</li>
        </ul>

        <h4 style={{ color: '#22c55e', marginBottom: '0.5rem' }}>Behavior</h4>
        <ul style={{ marginLeft: '1.5rem' }}>
          <li>Schedule is completely paused during Rest Block</li>
          <li>No break or transition reminders will appear</li>
          <li>Idle detection is disabled during Rest Block</li>
          <li>Water reminders can still appear (they're independent)</li>
          <li>When Rest Block ends, schedule resumes automatically</li>
        </ul>
      </Section>

      {/* ==================== EXTEND PHASE ==================== */}
      <Section title="Extend Phase" icon="⏱️">
        <p style={{ marginBottom: '1rem' }}>
          The Extend Phase feature allows you to temporarily add more time to your current activity
          without changing your schedule settings. Perfect for when you need "just a few more minutes."
        </p>

        <h4 style={{ color: '#3b82f6', marginBottom: '0.5rem' }}>Where It Works</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Work Phases (Sit/Stand)</strong> - Extend from Dashboard using the blue "+X min" button</li>
          <li><strong>Breaks (Short/Long)</strong> - Extend from the overlay using the blue "+X min" button</li>
          <li><strong>NOT on Transitions</strong> - Transitions are too short to need extending</li>
        </ul>

        <h4 style={{ color: '#3b82f6', marginBottom: '0.5rem' }}>How to Use</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>During Work (Dashboard)</strong> - Click the blue "+X min" button or press <code style={codeStyle}>E</code></li>
          <li><strong>During Break (Overlay)</strong> - Click the blue "+X min" button or press <code style={codeStyle}>E</code></li>
          <li>Each click adds the configured amount (default: 2 minutes)</li>
          <li>You can extend multiple times</li>
        </ul>

        <h4 style={{ color: '#3b82f6', marginBottom: '0.5rem' }}>Configuration</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li>Go to <strong>Settings → Break Extension</strong></li>
          <li>Adjust the slider to set how many minutes each extend adds (1-10 min)</li>
          <li>This setting applies to both work phases and breaks</li>
        </ul>

        <h4 style={{ color: '#3b82f6', marginBottom: '0.5rem' }}>Important Notes</h4>
        <ul style={{ marginLeft: '1.5rem' }}>
          <li>Extensions are <strong>temporary</strong> - they don't change your schedule</li>
          <li>The flow continues normally after the extended phase ends</li>
          <li>Break progress timers are not affected by extensions</li>
          <li>Useful for: finishing a task, extending a relaxing break, or when you're in the zone</li>
        </ul>
      </Section>

      {/* ==================== WATER REMINDER ==================== */}
      <Section title="Water Reminder" icon="💧">
        <p style={{ marginBottom: '1rem' }}>
          The Water Reminder feature helps you stay hydrated by showing periodic reminders
          to drink water throughout your workday.
        </p>

        <h4 style={{ color: '#0ea5e9', marginBottom: '0.5rem' }}>How to Enable</h4>
        <ol style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li>Go to Settings</li>
          <li>Find "💧 Water Reminder" section</li>
          <li>Check "Enable water reminder"</li>
          <li>Set the interval (5-60 minutes)</li>
        </ol>

        <h4 style={{ color: '#0ea5e9', marginBottom: '0.5rem' }}>Behavior</h4>
        <ul style={{ marginLeft: '1.5rem' }}>
          <li>Shows a fullscreen overlay with water-themed colors</li>
          <li>Appears every X minutes during active schedule</li>
          <li>Can interrupt breaks or work phases</li>
          <li>Must click "I Drank Water" to dismiss (cannot be skipped)</li>
          <li>Timer resets after confirmation</li>
          <li>Independent of schedule - works even during Rest Blocks</li>
        </ul>
      </Section>

      {/* ==================== SETTINGS ==================== */}
      <Section title="Settings" icon="⚙️">
        <h4 style={{ color: '#8b5cf6', marginBottom: '0.5rem' }}>Sound Settings</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Enable Sound</strong> - Play notification sounds for phase changes</li>
          <li><strong>Volume</strong> - Adjust sound volume (0-100%)</li>
          <li><strong>Sound Selection</strong> - Choose different sounds for notifications</li>
        </ul>

        <h4 style={{ color: '#8b5cf6', marginBottom: '0.5rem' }}>Startup Settings</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Start on Login</strong> - Automatically launch RhythmDesk when you log in</li>
          <li><strong>Start Minimized</strong> - Start in system tray instead of showing window</li>
        </ul>

        <h4 style={{ color: '#8b5cf6', marginBottom: '0.5rem' }}>Break Extension</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Extend Break By</strong> - Configure how many minutes the "+X min" button adds (1-10 min)</li>
        </ul>

        <h4 style={{ color: '#8b5cf6', marginBottom: '0.5rem' }}>Notifications</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Show Desktop Notifications</strong> - Display system notifications for phase changes</li>
        </ul>

        <h4 style={{ color: '#8b5cf6', marginBottom: '0.5rem' }}>Idle Detection</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Auto-pause when idle</strong> - Automatically pause schedule when you step away</li>
          <li><strong>Idle Threshold</strong> - Minutes of inactivity before auto-pause (1-30 min)</li>
          <li>Schedule automatically resumes when you return</li>
        </ul>

        <h4 style={{ color: '#8b5cf6', marginBottom: '0.5rem' }}>Water Reminder</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Enable</strong> - Turn on/off water reminders</li>
          <li><strong>Interval</strong> - How often to remind (5-60 minutes)</li>
        </ul>

        <h4 style={{ color: '#8b5cf6', marginBottom: '0.5rem' }}>Developer Options</h4>
        <ul style={{ marginLeft: '1.5rem' }}>
          <li><strong>Simulate Mode</strong> - Speed up timers for testing (1 min = 2 seconds)</li>
          <li><strong>Reset App Data</strong> - Clear all settings and start fresh</li>
        </ul>
      </Section>

      {/* ==================== KEYBOARD SHORTCUTS ==================== */}
      <Section title="Keyboard Shortcuts" icon="⌨️" defaultOpen={true}>
        <h4 style={{ color: '#22c55e', marginBottom: '0.5rem' }}>🌐 Global (System-wide)</h4>
        <p style={{ marginBottom: '0.5rem', opacity: 0.7 }}>Works from anywhere, even when app is minimized:</p>
        <table style={{ width: '100%', marginBottom: '1.5rem' }}>
          <tbody>
            {KEYBOARD_SHORTCUTS.global.map((s, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #333' }}>
                <td style={{ padding: '0.5rem', width: '180px' }}>
                  <code style={codeStyle}>{s.keys}</code>
                </td>
                <td style={{ padding: '0.5rem' }}>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 style={{ color: '#3b82f6', marginBottom: '0.5rem' }}>📊 Dashboard Shortcuts</h4>
        <p style={{ marginBottom: '0.5rem', opacity: 0.7 }}>Works when Dashboard is focused:</p>
        <table style={{ width: '100%', marginBottom: '1.5rem' }}>
          <tbody>
            {KEYBOARD_SHORTCUTS.dashboard.map((s, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #333' }}>
                <td style={{ padding: '0.5rem', width: '180px' }}>
                  <code style={codeStyle}>{s.keys}</code>
                </td>
                <td style={{ padding: '0.5rem' }}>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 style={{ color: '#f59e0b', marginBottom: '0.5rem' }}>🖥️ Overlay Shortcuts</h4>
        <p style={{ marginBottom: '0.5rem', opacity: 0.7 }}>Works when fullscreen overlay is showing:</p>
        <table style={{ width: '100%', marginBottom: '1.5rem' }}>
          <tbody>
            {KEYBOARD_SHORTCUTS.overlay.map((s, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #333' }}>
                <td style={{ padding: '0.5rem', width: '180px' }}>
                  <code style={codeStyle}>{s.keys}</code>
                </td>
                <td style={{ padding: '0.5rem' }}>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 style={{ color: '#a855f7', marginBottom: '0.5rem' }}>🧭 Navigation Shortcuts</h4>
        <p style={{ marginBottom: '0.5rem', opacity: 0.7 }}>Works anywhere in the app:</p>
        <table style={{ width: '100%' }}>
          <tbody>
            {KEYBOARD_SHORTCUTS.navigation.map((s, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #333' }}>
                <td style={{ padding: '0.5rem', width: '180px' }}>
                  <code style={codeStyle}>{s.keys}</code>
                </td>
                <td style={{ padding: '0.5rem' }}>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* ==================== TIPS & BEST PRACTICES ==================== */}
      <Section title="Tips & Best Practices" icon="💡">
        <h4 style={{ color: '#fbbf24', marginBottom: '0.5rem' }}>Getting the Most Out of RhythmDesk</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>Start with shorter durations</strong> - Begin with 20-25 min sit, 5-10 min stand, then adjust</li>
          <li><strong>Use Strict Mode initially</strong> - Helps build the habit of taking breaks</li>
          <li><strong>Set realistic break intervals</strong> - Every 25-30 min for short breaks works well</li>
          <li><strong>Enable water reminders</strong> - Hydration improves focus and energy</li>
          <li><strong>Use Rest Block for meetings</strong> - Prevents interruptions during calls</li>
        </ul>

        <h4 style={{ color: '#fbbf24', marginBottom: '0.5rem' }}>Posture Tips</h4>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li><strong>When sitting</strong> - Feet flat on floor, back supported, screen at eye level</li>
          <li><strong>When standing</strong> - Weight evenly distributed, slight knee bend, shoulders relaxed</li>
          <li><strong>During transitions</strong> - Take a moment to stretch and adjust your setup</li>
          <li><strong>During breaks</strong> - Look away from screen, stretch arms/neck, walk if possible</li>
        </ul>

        <h4 style={{ color: '#fbbf24', marginBottom: '0.5rem' }}>Productivity Tips</h4>
        <ul style={{ marginLeft: '1.5rem' }}>
          <li><strong>Use postpone wisely</strong> - Only when truly needed, don't make it a habit</li>
          <li><strong>Respect the skip limits</strong> - They're there to protect your health</li>
          <li><strong>Use Office Focus Lock</strong> - For deep work sessions requiring concentration</li>
          <li><strong>Multiple schedules</strong> - Create different schedules for different work types</li>
          <li><strong>Keyboard shortcuts</strong> - Learn them to control the app without breaking flow</li>
        </ul>
      </Section>

      {/* ==================== TROUBLESHOOTING ==================== */}
      <Section title="Troubleshooting" icon="🔧">
        <h4 style={{ color: '#ef4444', marginBottom: '0.5rem' }}>Common Issues</h4>
        
        <p style={{ marginTop: '1rem' }}><strong>Overlay not appearing:</strong></p>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li>Check if a schedule is active (Dashboard should show current phase)</li>
          <li>Verify the schedule's time window includes current time</li>
          <li>Check if the schedule is enabled</li>
          <li>Make sure you're not in a Rest Block</li>
        </ul>

        <p><strong>Schedule not starting:</strong></p>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li>Check the schedule's active days (must include today)</li>
          <li>Verify start/end times are correct</li>
          <li>Make sure the schedule is enabled (toggle is on)</li>
        </ul>

        <p><strong>App not starting on login:</strong></p>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li>Enable "Start on Login" in Settings</li>
          <li>This only works with the installed app (not dev mode)</li>
          <li>Check ~/.config/autostart/ for the desktop entry</li>
        </ul>

        <p><strong>Global shortcut not working:</strong></p>
        <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
          <li>Another app may have registered the same shortcut</li>
          <li>Try restarting RhythmDesk</li>
          <li>Check system keyboard shortcut settings for conflicts</li>
        </ul>

        <p><strong>Timer seems stuck:</strong></p>
        <ul style={{ marginLeft: '1.5rem' }}>
          <li>Check if schedule is paused (Dashboard will show "Paused")</li>
          <li>Check if "Waiting for Next Activity" is shown (click Start Next)</li>
          <li>Try Reset Session to restart from beginning</li>
        </ul>
      </Section>

      {/* ==================== ABOUT ==================== */}
      <Section title="About RhythmDesk" icon="ℹ️">
        <p style={{ marginBottom: '1rem' }}>
          <strong>RhythmDesk</strong> is a desktop application for healthy posture and break management.
        </p>
        
        <p><strong>Version:</strong> 2.0.1</p>
        <p><strong>Platform:</strong> Linux (Electron)</p>
        <p><strong>Built with:</strong> Electron, React, TypeScript</p>
        
        <p style={{ marginTop: '1rem', opacity: 0.7 }}>
          Designed to help knowledge workers maintain healthy habits during long work sessions.
          Take care of your body - it's the only one you've got! 💪
        </p>
      </Section>
    </div>
  );
}

export default HelpPage;
