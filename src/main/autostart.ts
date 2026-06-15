/**
 * RhythmDesk - Linux Autostart (XDG Autostart Spec)
 *
 * Manages the ~/.config/autostart/rhythmdesk.desktop file so the app
 * launches at login on any XDG-compliant Linux desktop (GNOME, KDE,
 * XFCE, etc.). This is more reliable than Electron's systemd-only
 * setLoginItemSettings() on Linux.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../core/logger';

const APP_ID = 'rhythmdesk';

function getAutostartDir(): string {
  const configHome =
    process.env.XDG_CONFIG_HOME ||
    path.join(process.env.HOME || app.getPath('home'), '.config');
  return path.join(configHome, 'autostart');
}

function getDesktopFilePath(): string {
  return path.join(getAutostartDir(), `${APP_ID}.desktop`);
}

/**
 * Enable or disable autostart at login.
 * In development mode (not packaged) this is a no-op — the dev
 * binary path changes too often to be useful.
 */
export function setLoginItemEnabled(enabled: boolean): void {
  const desktopFile = getDesktopFilePath();

  if (enabled) {
    if (!app.isPackaged) {
      logger.warn('Autostart', 'Skipping autostart in dev mode (app not packaged)');
      return;
    }

    const execPath = process.execPath;
    const desktopContent = [
      '[Desktop Entry]',
      'Type=Application',
      'Version=1.0',
      `Name=RhythmDesk`,
      `Comment=Posture and break reminder`,
      `Exec=${execPath} --hidden`,
      `Icon=${APP_ID}`,
      'Terminal=false',
      'X-GNOME-Autostart-enabled=true',
      'Hidden=false',
      'NoDisplay=false',
      '',
    ].join('\n');

    try {
      fs.mkdirSync(getAutostartDir(), { recursive: true });
      fs.writeFileSync(desktopFile, desktopContent, { encoding: 'utf8', mode: 0o644 });
      logger.info('Autostart', 'Autostart enabled', { desktopFile, execPath });
    } catch (err) {
      logger.error('Autostart', 'Failed to write autostart file', { err });
    }
  } else {
    try {
      if (fs.existsSync(desktopFile)) {
        fs.unlinkSync(desktopFile);
        logger.info('Autostart', 'Autostart disabled', { desktopFile });
      }
    } catch (err) {
      logger.error('Autostart', 'Failed to remove autostart file', { err });
    }
  }
}

/**
 * Returns true if the XDG autostart entry currently exists and is enabled.
 */
export function getLoginItemEnabled(): boolean {
  const desktopFile = getDesktopFilePath();
  if (!fs.existsSync(desktopFile)) return false;
  try {
    const content = fs.readFileSync(desktopFile, 'utf8');
    return (
      content.includes('X-GNOME-Autostart-enabled=true') &&
      !content.includes('Hidden=true')
    );
  } catch {
    return false;
  }
}

/**
 * Sync the autostart state with the saved setting on app startup.
 * Ensures the .desktop file matches what the user configured.
 */
export function syncLoginItemWithSettings(enabled: boolean): void {
  const current = getLoginItemEnabled();
  if (current !== enabled) {
    setLoginItemEnabled(enabled);
  }
}
