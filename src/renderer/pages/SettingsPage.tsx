/**
 * RhythmDesk Settings Page
 * General app settings
 */

import React, { useEffect, useState } from 'react';
import { GeneralSettings, DEFAULT_GENERAL_SETTINGS } from '../../shared/types';

function SettingsPage() {
  const [settings, setSettings] = useState<GeneralSettings>(DEFAULT_GENERAL_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const config = await window.rhythmDesk.getConfig();
    if (config?.generalSettings) {
      setSettings(config.generalSettings);
    }
  };

  const handleChange = (field: keyof GeneralSettings, value: any) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    const config = await window.rhythmDesk.getConfig();
    await window.rhythmDesk.saveConfig({
      ...config,
      generalSettings: settings,
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
