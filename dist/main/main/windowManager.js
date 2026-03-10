"use strict";
/**
 * RhythmDesk Window Manager
 * Manages main settings window and overlay windows
 *
 * MULTI-MONITOR POLICY:
 * TODO: Future enhancement - support multi-monitor setups
 * Current behavior: Overlay appears on primary monitor only
 * Future options:
 *   - Show overlay on all monitors
 *   - Show overlay on monitor where user is working
 *   - Allow user to select which monitor(s) for overlay
 * Implementation notes:
 *   - Use screen.getAllDisplays() to get all monitors
 *   - Create separate overlay window per display if needed
 *   - Track which display the main window is on
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.setQuitting = setQuitting;
exports.createMainWindow = createMainWindow;
exports.createOverlayWindow = createOverlayWindow;
exports.showOverlay = showOverlay;
exports.hideOverlay = hideOverlay;
exports.closeOverlay = closeOverlay;
exports.isOverlayStrict = isOverlayStrict;
exports.getMainWindow = getMainWindow;
exports.getOverlayWindow = getOverlayWindow;
exports.showMainWindow = showMainWindow;
exports.hideMainWindow = hideMainWindow;
exports.sendToOverlay = sendToOverlay;
exports.sendToMain = sendToMain;
exports.sendToAll = sendToAll;
const electron_1 = require("electron");
const path = __importStar(require("path"));
let mainWindow = null;
let overlayWindow = null;
let currentOverlayStrictMode = false;
let isQuitting = false;
/**
 * Set quitting flag - call before app.quit()
 */
function setQuitting(value) {
    isQuitting = value;
}
function isDev() {
    return process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
}
/**
 * Get the app icon path for BrowserWindow (launcher/taskbar icon)
 * Uses 256x256 PNG for best Linux compatibility
 *
 * NOTE: This is separate from tray icon - tray uses its own icon handling
 */
function getAppIconPath() {
    if (isDev()) {
        // Development: relative to compiled main.js in dist/main/main/
        return path.join(__dirname, '../../../resources/icons/256x256.png');
    }
    // Production: relative to app.asar resources
    return path.join(process.resourcesPath, 'resources/icons/256x256.png');
}
/**
 * Create the main settings window
 */
function createMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
        return mainWindow;
    }
    mainWindow = new electron_1.BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 600,
        minHeight: 500,
        title: 'RhythmDesk',
        icon: getAppIconPath(),
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
        // If quitting, allow close; otherwise minimize to tray
        if (!isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    // Load the app
    if (isDev()) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    else {
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
function createOverlayWindow(strictMode = false) {
    // If overlay exists with different strict mode, destroy and recreate
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        if (currentOverlayStrictMode !== strictMode) {
            overlayWindow.destroy();
            overlayWindow = null;
        }
        else {
            overlayWindow.focus();
            return overlayWindow;
        }
    }
    currentOverlayStrictMode = strictMode;
    const primaryDisplay = electron_1.screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size; // Use full size, not workArea
    overlayWindow = new electron_1.BrowserWindow({
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
        title: 'RhythmDesk Overlay',
        icon: getAppIconPath(),
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
    }
    else {
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
function showOverlay(strictMode = false) {
    if (!overlayWindow || overlayWindow.isDestroyed() || currentOverlayStrictMode !== strictMode) {
        createOverlayWindow(strictMode);
    }
    else {
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
function hideOverlay() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.hide();
    }
}
/**
 * Close overlay window
 * In strict mode, this should only be called when phase completes
 */
function closeOverlay() {
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
function isOverlayStrict() {
    return currentOverlayStrictMode;
}
/**
 * Get main window instance
 */
function getMainWindow() {
    return mainWindow;
}
/**
 * Get overlay window instance
 */
function getOverlayWindow() {
    return overlayWindow;
}
/**
 * Show main window
 */
function showMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        createMainWindow();
    }
    else {
        mainWindow.show();
        mainWindow.focus();
    }
}
/**
 * Hide main window to tray
 */
function hideMainWindow() {
    mainWindow?.hide();
}
/**
 * Send message to overlay window
 */
function sendToOverlay(channel, data) {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send(channel, data);
    }
}
/**
 * Send message to main window
 */
function sendToMain(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}
/**
 * Send message to all windows
 */
function sendToAll(channel, data) {
    sendToMain(channel, data);
    sendToOverlay(channel, data);
}
//# sourceMappingURL=windowManager.js.map