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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setQuitting = setQuitting;
exports.createMainWindow = createMainWindow;
exports.startMainWindowHealthCheck = startMainWindowHealthCheck;
exports.onMainWindowHealthCheckResponse = onMainWindowHealthCheckResponse;
exports.createOverlayWindow = createOverlayWindow;
exports.showOverlay = showOverlay;
exports.hideOverlay = hideOverlay;
exports.closeOverlay = closeOverlay;
exports.isOverlayStrict = isOverlayStrict;
exports.getMainWindow = getMainWindow;
exports.getOverlayWindow = getOverlayWindow;
exports.isOverlayHealthy = isOverlayHealthy;
exports.recoverOverlayIfNeeded = recoverOverlayIfNeeded;
exports.showMainWindow = showMainWindow;
exports.hideMainWindow = hideMainWindow;
exports.sendToOverlay = sendToOverlay;
exports.sendToMain = sendToMain;
exports.sendToAll = sendToAll;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const logger_1 = __importDefault(require("../core/logger"));
const overlayDebug_1 = require("../core/overlayDebug");
let mainWindow = null;
let overlayWindow = null;
let currentOverlayStrictMode = false;
let isQuitting = false;
let lastBlurFocusTime = 0;
const BLUR_FOCUS_DEBOUNCE_MS = 500; // Prevent focus fights
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
    logger_1.default.info('WindowManager', 'Main window created');
    // Store reference to webContents for crash handling
    const mainWebContents = mainWindow.webContents;
    mainWebContents.on('did-finish-load', () => {
        logger_1.default.info('WindowManager', 'Main window renderer loaded');
    });
    // CRITICAL: Handle renderer process crash - reload the window
    mainWebContents.on('crashed', (_event, killed) => {
        logger_1.default.error('WindowManager', 'Main window renderer crashed', { killed });
        reloadMainWindow('crashed');
    });
    // Handle render process gone (more detailed than crashed)
    mainWebContents.on('render-process-gone', (_event, details) => {
        logger_1.default.error('WindowManager', 'Main window render process gone', {
            reason: details.reason,
            exitCode: details.exitCode,
        });
        // Only reload if not killed intentionally
        if (details.reason !== 'killed' && details.reason !== 'clean-exit') {
            reloadMainWindow(`render-process-gone:${details.reason}`);
        }
    });
    // Handle unresponsive renderer - common after system resume
    mainWindow.on('unresponsive', () => {
        logger_1.default.warn('WindowManager', 'Main window became unresponsive - will reload');
        reloadMainWindow('unresponsive');
    });
    // Handle when window becomes responsive again
    mainWindow.on('responsive', () => {
        logger_1.default.info('WindowManager', 'Main window became responsive again');
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
 * Reload the main window after crash or unresponsive state
 * This preserves the window but reloads the renderer content
 */
function reloadMainWindow(reason) {
    logger_1.default.warn('WindowManager', 'Reloading main window', { reason });
    if (!mainWindow || mainWindow.isDestroyed()) {
        logger_1.default.info('WindowManager', 'Main window destroyed, recreating');
        createMainWindow();
        return;
    }
    try {
        // Try to reload the existing window
        if (isDev()) {
            mainWindow.loadURL('http://localhost:5173');
        }
        else {
            mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
        }
        logger_1.default.info('WindowManager', 'Main window reloaded successfully', { reason });
    }
    catch (err) {
        logger_1.default.error('WindowManager', 'Failed to reload main window, recreating', {
            reason,
            error: String(err)
        });
        // If reload fails, destroy and recreate
        mainWindow.destroy();
        mainWindow = null;
        createMainWindow();
    }
}
// Main window health check state
let mainWindowHealthCheckPending = false;
let mainWindowHealthCheckTimeout = null;
let mainWindowMissedHealthChecks = 0;
const MAIN_WINDOW_HEALTH_CHECK_TIMEOUT_MS = 5000; // 5 seconds to respond
const MAIN_WINDOW_MAX_MISSED_HEALTH_CHECKS = 2; // Reload after 2 missed checks
/**
 * Start periodic health checks for the main window
 * Detects zombie states where renderer is alive but not functional
 */
function startMainWindowHealthCheck() {
    // Check every 30 seconds when window is visible
    setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed())
            return;
        if (!mainWindow.isVisible())
            return; // Only check visible windows
        // Don't send another check if one is already pending
        if (mainWindowHealthCheckPending) {
            mainWindowMissedHealthChecks++;
            logger_1.default.warn('WindowManager', 'Main window health check still pending', {
                missedChecks: mainWindowMissedHealthChecks,
            });
            if (mainWindowMissedHealthChecks >= MAIN_WINDOW_MAX_MISSED_HEALTH_CHECKS) {
                logger_1.default.error('WindowManager', 'Main window failed health checks - reloading');
                mainWindowHealthCheckPending = false;
                mainWindowMissedHealthChecks = 0;
                if (mainWindowHealthCheckTimeout) {
                    clearTimeout(mainWindowHealthCheckTimeout);
                    mainWindowHealthCheckTimeout = null;
                }
                reloadMainWindow('health-check-failed');
            }
            return;
        }
        // Send health check request
        mainWindowHealthCheckPending = true;
        mainWindow.webContents.send('main-window:health-check');
        // Set timeout for response
        mainWindowHealthCheckTimeout = setTimeout(() => {
            if (mainWindowHealthCheckPending) {
                mainWindowMissedHealthChecks++;
                logger_1.default.warn('WindowManager', 'Main window health check timeout', {
                    missedChecks: mainWindowMissedHealthChecks,
                });
                mainWindowHealthCheckPending = false;
                if (mainWindowMissedHealthChecks >= MAIN_WINDOW_MAX_MISSED_HEALTH_CHECKS) {
                    logger_1.default.error('WindowManager', 'Main window failed health checks - reloading');
                    mainWindowMissedHealthChecks = 0;
                    reloadMainWindow('health-check-timeout');
                }
            }
        }, MAIN_WINDOW_HEALTH_CHECK_TIMEOUT_MS);
    }, 30000); // Check every 30 seconds
}
/**
 * Handle health check response from main window renderer
 */
function onMainWindowHealthCheckResponse() {
    if (mainWindowHealthCheckPending) {
        mainWindowHealthCheckPending = false;
        mainWindowMissedHealthChecks = 0;
        if (mainWindowHealthCheckTimeout) {
            clearTimeout(mainWindowHealthCheckTimeout);
            mainWindowHealthCheckTimeout = null;
        }
        logger_1.default.debug('WindowManager', 'Main window health check OK');
    }
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
    logger_1.default.info('WindowManager', 'Overlay window created', { strictMode, width, height });
    (0, overlayDebug_1.logOverlayEvent)({ event: 'overlay-resync', reason: 'window-created', strictMode });
    const overlayWebContents = overlayWindow.webContents;
    overlayWebContents.on('did-finish-load', () => {
        logger_1.default.info('WindowManager', 'Overlay renderer loaded');
    });
    overlayWebContents.on('render-process-gone', (_event, details) => {
        (0, overlayDebug_1.logOverlayCrash)(`render-process-gone:${details.reason}`);
        logger_1.default.error('WindowManager', 'Overlay render process gone', {
            reason: details.reason,
            exitCode: details.exitCode,
        });
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.destroy();
            overlayWindow = null;
        }
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
        // Re-focus if somehow loses focus in strict mode (with debounce to prevent fights)
        overlayWindow.on('blur', () => {
            if (overlayWindow && !overlayWindow.isDestroyed() && currentOverlayStrictMode) {
                const now = Date.now();
                // Debounce to prevent rapid focus fights that could freeze the system
                if (now - lastBlurFocusTime < BLUR_FOCUS_DEBOUNCE_MS) {
                    return;
                }
                lastBlurFocusTime = now;
                setTimeout(() => {
                    if (overlayWindow && !overlayWindow.isDestroyed() && currentOverlayStrictMode) {
                        overlayWindow.focus();
                    }
                }, 200);
            }
        });
    }
    // Handle webContents crash - recover the overlay
    overlayWebContents.on('crashed', () => {
        (0, overlayDebug_1.logOverlayCrash)('webContents crashed');
        logger_1.default.error('WindowManager', 'Overlay webContents crashed - will recover');
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.destroy();
            overlayWindow = null;
        }
    });
    // Handle unresponsive renderer
    overlayWindow.on('unresponsive', () => {
        (0, overlayDebug_1.logOverlayEvent)({ event: 'overlay-unresponsive', reason: 'BrowserWindow unresponsive event' });
        (0, overlayDebug_1.logOverlayCrash)('renderer unresponsive');
        logger_1.default.error('WindowManager', 'Overlay became unresponsive - destroying');
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.destroy();
            overlayWindow = null;
        }
    });
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
    (0, overlayDebug_1.logOverlayShow)('requested', strictMode);
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
        logger_1.default.info('WindowManager', 'Overlay window shown', { strictMode });
    }
}
/**
 * Hide overlay window
 */
function hideOverlay() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        logger_1.default.info('WindowManager', 'Overlay window hidden');
        overlayWindow.hide();
    }
}
/**
 * Close overlay window
 * In strict mode, this should only be called when phase completes
 */
function closeOverlay() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        (0, overlayDebug_1.logOverlayHide)('close requested');
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
 * Check if overlay window is healthy (exists and responsive)
 * Returns true if overlay is healthy, false if it needs recreation
 */
function isOverlayHealthy() {
    if (!overlayWindow)
        return false;
    if (overlayWindow.isDestroyed())
        return false;
    // Check if webContents is still valid
    try {
        const webContents = overlayWindow.webContents;
        if (!webContents || webContents.isDestroyed())
            return false;
        // Check if not crashed
        if (webContents.isCrashed()) {
            logger_1.default.error('WindowManager', 'Overlay webContents has crashed');
            return false;
        }
        return true;
    }
    catch (error) {
        logger_1.default.error('WindowManager', 'Error checking overlay health', { error });
        return false;
    }
}
/**
 * Recover overlay window if it's unhealthy
 * Used by watchdog to ensure overlay stays alive during long rest blocks
 */
function recoverOverlayIfNeeded(strictMode, forceRecreate = false) {
    if (!forceRecreate && isOverlayHealthy()) {
        return false; // No recovery needed
    }
    logger_1.default.warn('WindowManager', 'Recovering overlay window', { strictMode, forceRecreate, wasHealthy: isOverlayHealthy() });
    (0, overlayDebug_1.logOverlayEvent)({ event: 'overlay-reload', reason: forceRecreate ? 'forced-recreate' : 'unhealthy-window' });
    (0, overlayDebug_1.logOverlayRecovered)();
    // Clean up old window if it exists
    if (overlayWindow) {
        try {
            overlayWindow.removeAllListeners('close');
            overlayWindow.destroy();
        }
        catch (e) {
            // Ignore cleanup errors
        }
        overlayWindow = null;
    }
    // Create new overlay
    createOverlayWindow(strictMode);
    return true; // Recovery was performed
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