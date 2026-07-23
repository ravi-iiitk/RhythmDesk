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
  { key: 'break_start', label: 'Break Starting', defaultFile: 'chime.wav' },
  { key: 'break_end', label: 'Break Ending', defaultFile: 'bell.wav' },
  { key: 'transition_start', label: 'Transition Starting', defaultFile: 'ding.wav' },
  { key: 'postpone', label: 'Break Postponed', defaultFile: 'swoosh.wav' },
  { key: 'session_reset', label: 'Session Reset', defaultFile: 'reset.wav' },
  { key: 'focus_lock_start', label: 'Focus Lock Started', defaultFile: 'lock.wav' },
  { key: 'focus_lock_end', label: 'Focus Lock Ended', defaultFile: 'unlock.wav' },
  { key: 'rest_block_start', label: 'Rest Block Started', defaultFile: 'rest.wav' },
  { key: 'rest_block_end', label: 'Rest Block Ended', defaultFile: 'bell.wav' },
] as const;

const DEFAULT_SOUND_CONFIG: SoundConfig = {
  enabled: true,
  volume: 50,
  sounds: {
    break_start: { enabled: true, file: 'chime.wav' },
    break_end: { enabled: true, file: 'bell.wav' },
    transition_start: { enabled: true, file: 'ding.wav' },
    postpone: { enabled: true, file: 'swoosh.wav' },
    session_reset: { enabled: true, file: 'reset.wav' },
    focus_lock_start: { enabled: true, file: 'lock.wav' },
    focus_lock_end: { enabled: true, file: 'unlock.wav' },
    rest_block_start: { enabled: true, file: 'rest.wav' },
    rest_block_end: { enabled: true, file: 'bell.wav' },
  },
};

function SettingsPage() {
  const [settings, setSettings] = useState<GeneralSettings>(DEFAULT_GENERAL_SETTINGS);
  const [soundConfig, setSoundConfig] = useState<SoundConfig>(DEFAULT_SOUND_CONFIG);
  const [availableSounds, setAvailableSounds] = useState<string[]>([]);
  const [playingEvent, setPlayingEvent] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showSoundDetails, setShowSoundDetails] = useState(false);

  useEffect(() => {
    loadSettings();
    loadAvailableSounds();
  }, []);

  // Auto-hide save message
  useEffect(() => {
    if (!saveMessage) return;
    const timer = setTimeout(() => setSaveMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [saveMessage]);

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

  const loadAvailableSounds = async () => {
    try {
      const sounds = await window.rhythmDesk.getAvailableSounds();
      setAvailableSounds(sounds);
    } catch {
      setAvailableSounds(['none']);
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
    setSaveMessage(null);
  };

  const handleSoundFileChange = (eventKey: string, file: string) => {
    setSoundConfig(prev => ({
      ...prev,
      sounds: {
        ...prev.sounds,
        [eventKey]: { ...prev.sounds[eventKey], file },
      },
    }));
    setSaveMessage(null);
  };

  const handlePreviewSound = async (eventKey: string, filename: string) => {
    if (filename === 'none') return;
    setPlayingEvent(eventKey);
    try {
      await window.rhythmDesk.playTestSound(filename, soundConfig.volume ?? settings.soundVolume ?? 50);
    } catch { /* ignore */ }
    setTimeout(() => setPlayingEvent(null), 1500);
  };

  const handleChange = (field: keyof GeneralSettings, value: any) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
    setSaveMessage(null);
  };

  const handleSave = async () => {
    try {
      const config = await window.rhythmDesk.getConfig();
      await window.rhythmDesk.saveConfig({
        ...config,
        generalSettings: {
          ...settings,
          soundConfig, // Include sound config in settings
        },
      });
      setSaveMessage({ type: 'success', text: '✓ Settings saved. Dashboard uses updated settings automatically.' });
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveMessage({ type: 'error', text: '✗ Failed to save settings. Please try again.' });
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Settings</h2>
        <p>Configure general app behavior</p>
      </div>

      {saveMessage && (
        <div style={{
          padding: '0.75rem 1rem',
          marginBottom: '1rem',
          borderRadius: '6px',
          backgroundColor: saveMessage.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          color: saveMessage.type === 'success' ? '#22c55e' : '#ef4444',
          border: `1px solid ${saveMessage.type === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
          fontWeight: 500,
        }}>
          {saveMessage.text}
        </div>
      )}

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
                borderRadius: '6px' 
              }}>
                <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '0.75rem' }}>
                  Configure sounds for each event type:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {SOUND_EVENTS.map(event => {
                    const eventConfig = soundConfig.sounds[event.key];
                    const isEnabled = eventConfig?.enabled ?? true;
                    const currentFile = eventConfig?.file || event.defaultFile;
                    return (
                      <div key={event.key} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.4rem 0.5rem',
                        background: 'rgba(255,255,255,0.03)',
                        borderRadius: '4px',
                        opacity: isEnabled ? 1 : 0.5,
                      }}>
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={(e) => handleSoundEventToggle(event.key, e.target.checked)}
                          style={{ margin: 0, flexShrink: 0 }}
                        />
                        <span style={{ fontSize: '0.85rem', minWidth: '140px', flexShrink: 0 }}>
                          {event.label}
                        </span>
                        <select
                          value={currentFile}
                          onChange={(e) => handleSoundFileChange(event.key, e.target.value)}
                          disabled={!isEnabled}
                          style={{
                            flex: 1,
                            minWidth: '120px',
                            padding: '0.25rem 0.4rem',
                            fontSize: '0.8rem',
                            borderRadius: '4px',
                            border: '1px solid #444',
                            background: '#1e1e2e',
                            color: '#cdd6f4',
                            cursor: isEnabled ? 'pointer' : 'not-allowed',
                          }}
                        >
                          {availableSounds.filter(s => s !== 'none').map(sound => (
                            <option key={sound} value={sound}>{sound}</option>
                          ))}
                          <option value="none">None (silent)</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => handlePreviewSound(event.key, currentFile)}
                          disabled={!isEnabled || currentFile === 'none'}
                          title="Preview sound"
                          style={{
                            padding: '0.2rem 0.5rem',
                            fontSize: '0.8rem',
                            borderRadius: '4px',
                            border: '1px solid #444',
                            background: playingEvent === event.key ? '#3b82f6' : '#2a2a3e',
                            color: '#cdd6f4',
                            cursor: isEnabled && currentFile !== 'none' ? 'pointer' : 'not-allowed',
                            flexShrink: 0,
                            opacity: isEnabled && currentFile !== 'none' ? 1 : 0.4,
                          }}
                        >
                          {playingEvent === event.key ? '🔊' : '▶'}
                        </button>
                      </div>
                    );
                  })}
                </div>
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
            Automatically launches RhythmDesk when you log in (creates a desktop autostart entry). Only works with the installed app, not in dev mode.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">⏱️ Extend Options</span>
        </div>

        <div className="form-group">
          <label className="form-label">Extend duration options (minutes)</label>
          <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '0.5rem' }}>
            Configure the extend duration buttons shown on Dashboard (for work phases) and Overlay (for breaks).
            Enter comma-separated values (e.g., "2, 5, 10, 15").
          </p>
          <input
            type="text"
            className="form-input"
            value={(settings.extendOptions ?? [2, 5, 10]).join(', ')}
            onChange={(e) => {
              const values = e.target.value
                .split(',')
                .map(v => parseInt(v.trim(), 10))
                .filter(v => !isNaN(v) && v > 0 && v <= 60);
              if (values.length > 0) {
                handleChange('extendOptions', values);
              }
            }}
            placeholder="2, 5, 10"
            style={{ fontFamily: 'monospace' }}
          />
          <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: '0.25rem' }}>
            Current: {(settings.extendOptions ?? [2, 5, 10]).map(m => `+${m} min`).join(', ')}
          </p>
        </div>

        <div className="form-group">
          <label className="form-label">Prepone (reduce) duration options (minutes)</label>
          <p className="text-muted" style={{ fontSize: '0.75rem', marginBottom: '0.5rem' }}>
            Configure the reduce buttons shown on Dashboard and Overlay. Buttons only appear when
            remaining time is sufficient (remaining &gt; option + 30s safety margin).
          </p>
          <input
            type="text"
            className="form-input"
            value={(settings.preponeOptions ?? [1, 2, 5]).join(', ')}
            onChange={(e) => {
              const values = e.target.value
                .split(',')
                .map(v => parseInt(v.trim(), 10))
                .filter(v => !isNaN(v) && v > 0 && v <= 60);
              if (values.length > 0) {
                handleChange('preponeOptions', values);
              }
            }}
            placeholder="1, 2, 5"
            style={{ fontFamily: 'monospace' }}
          />
          <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: '0.25rem' }}>
            Current: {(settings.preponeOptions ?? [1, 2, 5]).map(m => `-${m} min`).join(', ')}
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
          <span className="card-title">Idle Detection</span>
        </div>

        <div className="form-group">
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={settings.autoIdlePause ?? false}
              onChange={(e) => handleChange('autoIdlePause', e.target.checked)}
            />
            Auto-pause when system is idle
          </label>
          <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
            Automatically pauses the schedule when no keyboard/mouse activity is detected, and resumes when you return.
          </p>
        </div>

        {settings.autoIdlePause && (
          <div className="form-group">
            <label className="form-label">Idle threshold: {settings.idleThresholdMinutes ?? 3} minute{(settings.idleThresholdMinutes ?? 3) !== 1 ? 's' : ''}</label>
            <input
              type="range"
              className="form-input"
              min="1"
              max="15"
              value={settings.idleThresholdMinutes ?? 3}
              onChange={(e) => handleChange('idleThresholdMinutes', parseInt(e.target.value, 10))}
              style={{ cursor: 'pointer' }}
            />
            <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
              Minutes of inactivity before auto-pause kicks in.
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">💧 Water Reminder</span>
        </div>

        <div className="form-group">
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={settings.waterReminderEnabled ?? false}
              onChange={(e) => handleChange('waterReminderEnabled', e.target.checked)}
            />
            Enable water reminder
          </label>
          <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
            Shows a fullscreen reminder to drink water at regular intervals. You must confirm to dismiss.
          </p>
        </div>

        {settings.waterReminderEnabled && (
          <div className="form-group">
            <label className="form-label">Reminder interval: {settings.waterReminderIntervalMinutes ?? 10} minute{(settings.waterReminderIntervalMinutes ?? 10) !== 1 ? 's' : ''}</label>
            <input
              type="range"
              className="form-input"
              min="5"
              max="60"
              step="5"
              value={settings.waterReminderIntervalMinutes ?? 10}
              onChange={(e) => handleChange('waterReminderIntervalMinutes', parseInt(e.target.value, 10))}
              style={{ cursor: 'pointer' }}
            />
            <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
              How often to remind you to drink water (5-60 minutes).
            </p>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">🎙️ Voice Commands</span>
        </div>

        <div className="form-group">
          <label className="form-label">Voice Mode</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            {(['off', 'local', 'cloud'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => handleChange('voiceMode', mode)}
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  borderRadius: '6px',
                  border: `2px solid ${(settings.voiceMode ?? 'off') === mode ? '#3b82f6' : '#333'}`,
                  backgroundColor: (settings.voiceMode ?? 'off') === mode ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                  color: (settings.voiceMode ?? 'off') === mode ? '#3b82f6' : '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  transition: 'all 0.2s',
                }}
              >
                {mode === 'off' ? '🔇 Off' : mode === 'local' ? '💻 Local' : '☁️ Cloud'}
              </button>
            ))}
          </div>
          <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
            {(settings.voiceMode ?? 'off') === 'off' && 'Voice commands disabled. Select Local or Cloud to enable.'}
            {(settings.voiceMode ?? 'off') === 'local' && '🟢 Free & offline. Uses whisper.cpp (base model, ~142MB). No API key needed.'}
            {(settings.voiceMode ?? 'off') === 'cloud' && '☁️ Uses OpenAI Whisper API. Best accuracy, requires API key (~$0.006/min).'}
          </p>
        </div>

        {(settings.voiceMode ?? 'off') === 'cloud' && (
          <div className="form-group">
            <label className="form-label">OpenAI API Key</label>
            <input
              type="password"
              className="form-input"
              value={settings.openaiApiKey ?? ''}
              onChange={(e) => handleChange('openaiApiKey', e.target.value)}
              placeholder="sk-..."
              style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
            />
            <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
              Get your key from <span style={{ color: '#3b82f6' }}>platform.openai.com/api-keys</span>.
              Key is stored locally, never shared.
            </p>
          </div>
        )}

        {(settings.voiceMode ?? 'off') !== 'off' && (
          <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
            Hold <strong>V</strong> on Dashboard → speak command → release. The app understands natural language and talks back.
          </p>
        )}
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
            � Activity Log Retention
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Keep logs for</span>
            <select
              value={settings.logRetentionDays ?? 30}
              onChange={(e) => handleChange('logRetentionDays', Number(e.target.value))}
              style={{
                padding: '0.35rem 0.5rem',
                borderRadius: '4px',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
              }}
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>1 year</option>
            </select>
          </div>
          <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
            Older log entries are automatically deleted on app startup.
          </p>
        </div>

        <div className="form-group" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #333' }}>
          <label style={{ fontWeight: 500, marginBottom: '0.5rem', display: 'block' }}>
            �🗑️ Reset App Data
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
      </div>

      <div className="card mt-2">
        <div className="card-header">
          <span className="card-title">About</span>
        </div>
        <p className="text-muted">
          <strong>RhythmDesk</strong> v2.0.1<br />
          A strict work posture and break scheduler for users with back pain / sciatica.<br />
          Linux-first desktop application.
        </p>
      </div>
    </div>
  );
}

export default SettingsPage;
