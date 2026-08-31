/**
 * focusLockdown.ts
 *
 * Window-level enforcement for Focus Sessions.
 *
 * When a Focus Session is active the app must:
 *  - Fill the entire screen (fullscreen + always-on-top at "screen-saver" level)
 *  - Prevent window switching (kiosk mode on supported WMs)
 *  - Prevent all close/quit attempts
 *  - Steal focus back if another app somehow gets it
 *  - Survive a kill-9 via a systemd user service that restarts the process
 *
 * Limitations (honest, cannot be worked around on Linux):
 *  - SIGKILL (kill -9) cannot be intercepted — systemd restarts within 2 s
 *  - Ctrl+Alt+F2 (virtual terminal) is kernel-level, cannot be blocked
 */

import { app, BrowserWindow, globalShortcut } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import logger from '../core/logger';
import { getIdleDetector } from '../core/idleDetector';

let focusStealInterval: NodeJS.Timeout | null = null;
let isLockdownActive = false;
let idleWasRunning = false; // Track idle detector state so we can restore it on exit

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function enterFocusLockdown(mainWindow: BrowserWindow): void {
  if (isLockdownActive) return;
  isLockdownActive = true;

  logger.info('FocusLockdown', 'Entering focus lockdown');

  // 1. Intercept escape shortcuts so the user cannot leave
  //    Unregister the ones we registered ourselves first to avoid double-registration.
  globalShortcut.unregister('Super+Shift+Q'); // emergency kill — suspended during session
  globalShortcut.unregister('Super+Shift+Escape'); // backup emergency kill — also suspended
  globalShortcut.unregister('Super+Shift+B'); // ad-hoc break shortcut
  globalShortcut.unregister('Super+Shift+R'); // bring-to-front shortcut

  // Block common quit/switch shortcuts at OS level
  safeRegisterShortcut('Alt+F4', () => {});      // close window
  safeRegisterShortcut('Super+d', () => {});     // show desktop (GNOME/KDE)
  safeRegisterShortcut('Super+h', () => {});     // hide window (some WMs)

  // 2. Full-screen + highest z-order
  mainWindow.setFullScreen(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  // 3. Kiosk mode — prevents WM from switching windows on many compositors.
  //    Wrapped in try/catch because some Wayland compositors reject kiosk.
  try {
    mainWindow.setKiosk(true);
  } catch (err) {
    logger.warn('FocusLockdown', 'setKiosk failed (non-fatal)', { err: String(err) });
  }

  // 4. Periodic focus steal — re-claim focus if something else gets it
  focusStealInterval = setInterval(() => {
    if (mainWindow.isDestroyed()) return;
    if (!mainWindow.isFocused()) {
      mainWindow.show();
      mainWindow.focus();
      try { app.focus({ steal: true }); } catch {}
    }
  }, 500);

  // 5. Suspend idle detection — stillness during a focus session is not idleness
  const idleDetector = getIdleDetector();
  idleWasRunning = idleDetector.isRunning();
  if (idleWasRunning) {
    idleDetector.stop();
    logger.info('FocusLockdown', 'Idle detector suspended for focus session');
  }

  // 6. Enable autostart so the app survives a reboot
  ensureAutostart();

  // 7. Enable systemd guardian so the app restarts after kill-9
  enableSystemdGuardian();

  logger.info('FocusLockdown', 'Focus lockdown active');
}

/**
 * Callback to re-register the global shortcuts that enterFocusLockdown unregistered.
 * Set via setShortcutRestoreCallback() from main.ts after the shortcuts are first created.
 */
let shortcutRestoreCallback: (() => void) | null = null;

/**
 * main.ts must call this once after registering global shortcuts so that
 * exitFocusLockdown can re-register them when the session ends.
 */
export function setShortcutRestoreCallback(cb: () => void): void {
  shortcutRestoreCallback = cb;
}

export function exitFocusLockdown(mainWindow: BrowserWindow): void {
  if (!isLockdownActive) return;
  isLockdownActive = false;

  logger.info('FocusLockdown', 'Exiting focus lockdown');

  // Stop focus steal
  if (focusStealInterval) {
    clearInterval(focusStealInterval);
    focusStealInterval = null;
  }

  // Unregister shortcuts we captured
  globalShortcut.unregister('Alt+F4');
  globalShortcut.unregister('Super+d');
  globalShortcut.unregister('Super+h');

  // Restore window state
  try { mainWindow.setKiosk(false); } catch {}
  mainWindow.setFullScreen(false);
  mainWindow.setAlwaysOnTop(false);

  // Re-register global shortcuts (Super+Shift+Q, B, R) that were unregistered on entry
  if (shortcutRestoreCallback) {
    try {
      shortcutRestoreCallback();
      logger.info('FocusLockdown', 'Global shortcuts re-registered after lockdown');
    } catch (err) {
      logger.warn('FocusLockdown', 'Failed to re-register global shortcuts', { err: String(err) });
    }
  }

  // Restore idle detection if it was running before lockdown
  if (idleWasRunning) {
    const configService = require('../core/configService').default as typeof import('../core/configService').default;
    const settings = configService.getGeneralSettings();
    getIdleDetector().start(settings.idleThresholdMinutes ?? 3);
    idleWasRunning = false;
    logger.info('FocusLockdown', 'Idle detector restored after focus session');
  }

  // Disable systemd guardian (unless user has regular autostart enabled — leave that alone)
  disableSystemdGuardian();

  logger.info('FocusLockdown', 'Focus lockdown released');
}

/** True while a focus session is being enforced. */
export function isFocusLockdownActive(): boolean {
  return isLockdownActive;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeRegisterShortcut(accelerator: string, handler: () => void): void {
  try {
    if (!globalShortcut.isRegistered(accelerator)) {
      globalShortcut.register(accelerator, handler);
    }
  } catch {
    // Non-fatal — some shortcuts can't be captured on Wayland
  }
}

// ---------------------------------------------------------------------------
// Autostart (XDG desktop file) — ensures the app starts on next login
// ---------------------------------------------------------------------------

function getAutostartDir(): string {
  const configHome =
    process.env.XDG_CONFIG_HOME ||
    path.join(process.env.HOME || app.getPath('home'), '.config');
  return path.join(configHome, 'autostart');
}

function ensureAutostart(): void {
  if (!app.isPackaged) return; // dev binary path changes too often
  const desktopFile = path.join(getAutostartDir(), 'rhythmdesk.desktop');
  if (fs.existsSync(desktopFile)) return; // already enabled

  const execPath = process.execPath;
  const content = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=RhythmDesk',
    'Comment=Posture and break reminder',
    `Exec=${execPath} --hidden`,
    'Icon=rhythmdesk',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    'Hidden=false',
    '',
  ].join('\n');

  try {
    fs.mkdirSync(getAutostartDir(), { recursive: true });
    fs.writeFileSync(desktopFile, content, { encoding: 'utf8', mode: 0o644 });
    logger.info('FocusLockdown', 'Autostart entry created', { desktopFile });
  } catch (err) {
    logger.warn('FocusLockdown', 'Failed to create autostart entry', { err: String(err) });
  }
}

// ---------------------------------------------------------------------------
// systemd user service — restarts the app within ~2 s if killed
// ---------------------------------------------------------------------------

const SYSTEMD_SERVICE_NAME = 'rhythmdesk-focus.service';

function getSystemdUserDir(): string {
  const configHome =
    process.env.XDG_CONFIG_HOME ||
    path.join(process.env.HOME || '', '.config');
  return path.join(configHome, 'systemd', 'user');
}

function enableSystemdGuardian(): void {
  if (!app.isPackaged) {
    logger.debug('FocusLockdown', 'Skipping systemd guardian in dev mode');
    return;
  }
  try {
    const execPath = process.execPath;
    const serviceDir = getSystemdUserDir();
    fs.mkdirSync(serviceDir, { recursive: true });

    const serviceContent = [
      '[Unit]',
      'Description=RhythmDesk Focus Session Guardian',
      'After=graphical-session.target',
      '',
      '[Service]',
      'Type=simple',
      `ExecStart=${execPath}`,
      'Restart=always',
      'RestartSec=2',
      `Environment=DISPLAY=${process.env.DISPLAY ?? ':0'}`,
      `Environment=WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY ?? ''}`,
      `Environment=XDG_RUNTIME_DIR=${process.env.XDG_RUNTIME_DIR ?? ''}`,
      `Environment=HOME=${process.env.HOME ?? ''}`,
      '',
      '[Install]',
      'WantedBy=default.target',
      '',
    ].join('\n');

    fs.writeFileSync(
      path.join(serviceDir, SYSTEMD_SERVICE_NAME),
      serviceContent,
      { encoding: 'utf8' },
    );

    child_process.execSync('systemctl --user daemon-reload', { timeout: 5000 });
    child_process.execSync(
      `systemctl --user enable --now ${SYSTEMD_SERVICE_NAME}`,
      { timeout: 5000 },
    );
    logger.info('FocusLockdown', 'systemd guardian enabled', { service: SYSTEMD_SERVICE_NAME });
  } catch (err) {
    // Non-fatal: systemd may not be available (e.g. non-systemd distro, no user session bus)
    logger.warn('FocusLockdown', 'systemd guardian setup failed (non-fatal)', { err: String(err) });
  }
}

function disableSystemdGuardian(): void {
  if (!app.isPackaged) return;
  try {
    child_process.execSync(
      `systemctl --user disable --now ${SYSTEMD_SERVICE_NAME}`,
      { timeout: 5000 },
    );
    logger.info('FocusLockdown', 'systemd guardian disabled');
  } catch {
    // Non-fatal — service may not exist if systemd wasn't available when enabling
  }
}
