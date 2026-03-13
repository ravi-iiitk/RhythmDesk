/**
 * RhythmDesk Settings Page
 * General app settings
 */

import { useEffect, useState } from 'react';
import { GeneralSettings, DEFAULT_GENERAL_SETTINGS } from '../../shared/types';

// Sound event configuration
interface SoundEventConfig {
  enabled: boolean;
  file: string;
}

interface SoundConfig {
  enabled: boolean;
  volume: number;
  sounds: Record<string, SoundEventConfig>;
}

const SOUND_EVENTS = [
  { key: 'break_start', label: 'Break Starting' },
  { key: 'break_end', label: 'Break Ending' },
  { key: 'transition_start', label: 'Transition Starting' },
  { key: 'postpone', label: 'Break Postponed' },
  { key: 'session_reset', label: 'Session Reset' },
  { key: 'focus_lock_start', label: 'Focus Lock Started' },
  { key: 'focus_lock_end', label: 'Focus Lock Ended' },
  { key: 'rest_block_start', label: 'Rest Block Started' },
  { key: 'rest_block_end', label: 'Rest Block Ended' },
] as const;

const DEFAULT_SOUND_CONFIG: SoundConfig = {
  enabled: true,
  volume: 50,
  sounds: {
    break_start: { enabled: true, file: 'default' },
    break_end: { enabled: true, file: 'default' },
    transition_start: { enabled: true, file: 'default' },
    postpone: { enabled: true, file: 'default' },
    session_reset: { enabled: true, file: 'default' },
    focus_lock_start: { enabled: true, file: 'default' },
    focus_lock_end: { enabled: true, file: 'default' },
    rest_block_start: { enabled: true, file: 'default' },
    rest_block_end: { enabled: true, file: 'default' },
  },
};

function SettingsPage() {
  const [settings, setSettings] = useState<GeneralSettings>(DEFAULT_GENERAL_SETTINGS);
  const [soundConfig, setSoundConfig] = useState<SoundConfig>(DEFAULT_SOUND_CONFIG);
  const [saved, setSaved] = useState(false);
  const [showSoundDetails, setShowSoundDetails] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const config = await window.rhythmDesk.getConfig();
    if (config?.generalSettings) {
      setSettings(config.generalSettings);
      // Load sound config if exists
      if ((config.generalSettings as any).soundConfig) {
        setSoundConfig((config.generalSettings as any).soundConfig);
      }
    }
  };

  const handleSoundEventToggle = (eventKey: string, enabled: boolean) => {
    setSoundConfig(prev => ({
      ...prev,
      sounds: {
        ...prev.sounds,
        [eventKey]: { ...prev.sounds[eventKey], enabled },
      },
    }));
    setSaved(false);
  };

  const handleChange = (field: keyof GeneralSettings, value: any) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    const config = await window.rhythmDesk.getConfig();
    await window.rhythmDesk.saveConfig({
      ...config,
      generalSettings: {
        ...settings,
        soundConfig, // Include sound config in settings
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Settings</h2>
        <p>Configure general app behavior</p>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Sound</span>
        </div>

        <div className="form-group">
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={settings.soundEnabled}
              onChange={(e) => handleChange('soundEnabled', e.target.checked)}
            />
            Enable Sound Notifications
          </label>
        </div>

        {settings.soundEnabled && (
          <>
            <div className="form-group">
              <label className="form-label">Volume: {settings.soundVolume}%</label>
              <input
                type="range"
                className="form-input"
                min="0"
                max="100"
                value={settings.soundVolume}
                onChange={(e) => handleChange('soundVolume', parseInt(e.target.value, 10))}
                style={{ cursor: 'pointer' }}
              />
            </div>
            
            <div className="form-group">
              <button 
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowSoundDetails(!showSoundDetails)}
                style={{ fontSize: '0.875rem' }}
              >
                {showSoundDetails ? '▼ Hide Sound Events' : '▶ Configure Sound Events'}
              </button>
            </div>
            
            {showSoundDetails && (
              <div style={{ 
                marginTop: '0.5rem', 
                padding: '0.75rem', 
                background: 'rgba(255,255,255,0.05)', 
                borderRadius: '4px' 
              }}>
                <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                  Enable/disable sounds for specific events:
                </p>
                {SOUND_EVENTS.map(event => (
                  <div key={event.key} style={{ marginBottom: '0.25rem' }}>
                    <label className="form-checkbox" style={{ fontSize: '0.875rem' }}>
                      <input
                        type="checkbox"
                        checked={soundConfig.sounds[event.key]?.enabled ?? true}
                        onChange={(e) => handleSoundEventToggle(event.key, e.target.checked)}
                      />
                      {event.label}
                    </label>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Appearance</span>
        </div>

        <div className="form-group">
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={settings.darkMode}
              onChange={(e) => handleChange('darkMode', e.target.checked)}
            />
            Dark Mode
          </label>
          <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
            Currently only dark mode is fully supported
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Startup</span>
        </div>

        <div className="form-group">
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={settings.startMinimized}
              onChange={(e) => handleChange('startMinimized', e.target.checked)}
            />
            Start Minimized to Tray
          </label>
        </div>

        <div className="form-group">
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={settings.startOnLogin}
              onChange={(e) => handleChange('startOnLogin', e.target.checked)}
            />
            Start on System Login
          </label>
          <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
            Requires manual setup on Linux - add to your desktop autostart
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Notifications</span>
        </div>

        <div className="form-group">
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={settings.showNotifications}
              onChange={(e) => handleChange('showNotifications', e.target.checked)}
            />
            Show Desktop Notifications
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Developer</span>
        </div>

        <div className="form-group">
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={settings.simulateMode}
              onChange={(e) => handleChange('simulateMode', e.target.checked)}
            />
            Simulate Mode (30x speed)
          </label>
          <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
            ⚡ For testing: 1 minute = 2 seconds. Restart timer after toggling.
          </p>
        </div>

        <div className="form-group" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #333' }}>
          <label style={{ fontWeight: 500, marginBottom: '0.5rem', display: 'block' }}>
            🗑️ Reset App Data
          </label>
          <button 
            className="btn"
            style={{ 
              backgroundColor: '#dc2626', 
              color: 'white',
              padding: '0.5rem 1rem',
            }}
            onClick={async () => {
              if (confirm('Clear ALL config data (schedules, settings, session state)?\n\nThis cannot be undone. App will need restart.')) {
                const result = await window.rhythmDesk.devClearAllData();
                alert(result.message);
              }
            }}
          >
            Clear All Data
          </button>
          <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
            ⚠️ Removes all schedules, settings, and session state. Use for fresh start.
          </p>
        </div>
      </div>

      <div className="mt-2">
        <button className="btn btn-primary" onClick={handleSave}>
          Save Settings
        </button>
        {saved && (
          <span className="text-muted" style={{ marginLeft: '1rem' }}>
            ✓ Settings saved
          </span>
        )}
      </div>

      <div className="card mt-2">
        <div className="card-header">
          <span className="card-title">About</span>
        </div>
        <p className="text-muted">
          <strong>RhythmDesk</strong> v1.0.0<br />
          A strict work posture and break scheduler for users with back pain / sciatica.<br />
          Linux-first desktop application.
        </p>
      </div>
    </div>
  );
}

export default SettingsPage;
