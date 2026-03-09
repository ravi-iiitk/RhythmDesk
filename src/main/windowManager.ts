/**
 * PostureGuard Window Manager
 * Manages main settings window and overlay windows
 */

import { BrowserWindow, screen, app } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let currentOverlayStrictMode: boolean = false;

function isDev(): boolean {
  return process.env.NODE_ENV === 'development' || !app.isPackaged;
}

/**
 * Create the main settings window
 */
export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    title: 'PostureGuard',
    icon: path.join(__dirname, '../../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    backgroundColor: '#1a1a2e',
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (event) => {
    // Minimize to tray instead of closing
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Load the app
  if (isDev()) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  return mainWindow;
}

/**
 * Create fullscreen overlay window
 * Designed for Linux - stays on top and covers the screen
 * 
 * LINUX STRICT MODE BEHAVIOR:
 * - Uses kiosk mode for maximum blocking
 * - setAlwaysOnTop with 'screen-saver' level (highest)
 * - Visible on all workspaces
 * - Blocks close/minimize in strict mode
 * - Note: Some Linux WMs may still allow Alt+Tab; this is a WM limitation
 */
export function createOverlayWindow(strictMode: boolean = false): BrowserWindow {
  // If overlay exists with different strict mode, destroy and recreate
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (currentOverlayStrictMode !== strictMode) {
      overlayWindow.destroy();
      overlayWindow = null;
    } else {
      overlayWindow.focus();
      return overlayWindow;
    }
  }

  currentOverlayStrictMode = strictMode;
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size; // Use full size, not workArea

  overlayWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    fullscreen: true,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: !strictMode,
    maximizable: false,
    closable: !strictMode,
    focusable: true,
    // Kiosk mode for strict - provides strongest blocking on Linux
    kiosk: strictMode,
    title: 'PostureGuard Overlay',
    icon: path.join(__dirname, '../../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    backgroundColor: '#1a1a2e',
  });

  // Linux-specific: strongest always-on-top level
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setFullScreenable(true);
  overlayWindow.setFullScreen(true);

  // In strict mode, prevent window from being closed via window manager
  if (strictMode) {
    overlayWindow.on('close', (event) => {
      // Prevent closing in strict mode - can only be closed programmatically
      event.preventDefault();
    });

    // Re-focus if somehow loses focus in strict mode
    overlayWindow.on('blur', () => {
      if (overlayWindow && !overlayWindow.isDestroyed() && currentOverlayStrictMode) {
        // Small delay to avoid focus fight
        setTimeout(() => {
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.focus();
          }
        }, 100);
      }
    });
  }

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    currentOverlayStrictMode = false;
  });

  // Load overlay view
  if (isDev()) {
    overlayWindow.loadURL('http://localhost:5173/#/overlay');
  } else {
    overlayWindow.loadFile(path.join(__dirname, '../../renderer/index.html'), {
      hash: '/overlay',
    });
  }

  overlayWindow.focus();

  return overlayWindow;
}

/**
 * Show overlay window
 * Always recreates if strict mode changed to ensure correct behavior
 */
export function showOverlay(strictMode: boolean = false): void {
  if (!overlayWindow || overlayWindow.isDestroyed() || currentOverlayStrictMode !== strictMode) {
    createOverlayWindow(strictMode);
  } else {
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setFullScreen(true);
    if (strictMode) {
      overlayWindow.setKiosk(true);
    }
    overlayWindow.show();
    overlayWindow.focus();
  }
}

/**
 * Hide overlay window
 */
export function hideOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
}

/**
 * Close overlay window
 * In strict mode, this should only be called when phase completes
 */
export function closeOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    // Remove close prevention handler for strict mode
    overlayWindow.removeAllListeners('close');
    overlayWindow.destroy();
    overlayWindow = null;
    currentOverlayStrictMode = false;
  }
}

/**
 * Check if overlay is currently in strict mode
 */
export function isOverlayStrict(): boolean {
  return currentOverlayStrictMode;
}

/**
 * Get main window instance
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/**
 * Get overlay window instance
 */
export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow;
}

/**
 * Show main window
 */
export function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

/**
 * Hide main window to tray
 */
export function hideMainWindow(): void {
  mainWindow?.hide();
}

/**
 * Send message to overlay window
 */
export function sendToOverlay(channel: string, data?: any): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send(channel, data);
  }
}

/**
 * Send message to main window
 */
export function sendToMain(channel: string, data?: any): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

/**
 * Send message to all windows
 */
export function sendToAll(channel: string, data?: any): void {
  sendToMain(channel, data);
  sendToOverlay(channel, data);
}
