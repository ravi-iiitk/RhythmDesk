"use strict";
/**
 * PostureGuard Window Manager
 * Manages main settings window and overlay windows
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
exports.createMainWindow = createMainWindow;
exports.createOverlayWindow = createOverlayWindow;
exports.showOverlay = showOverlay;
exports.hideOverlay = hideOverlay;
exports.closeOverlay = closeOverlay;
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
function isDev() {
    return process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
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
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
    }
    return mainWindow;
}
/**
 * Create fullscreen overlay window
 * Designed for Linux - stays on top and covers the screen
 */
function createOverlayWindow(strictMode = false) {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.focus();
        return overlayWindow;
    }
    const primaryDisplay = electron_1.screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
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
        closable: !strictMode,
        focusable: true,
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
    // Attempt to grab focus on Linux
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setVisibleOnAllWorkspaces(true);
    overlayWindow.setFullScreenable(true);
    overlayWindow.setFullScreen(true);
    overlayWindow.on('closed', () => {
        overlayWindow = null;
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
 */
function showOverlay(strictMode = false) {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
        createOverlayWindow(strictMode);
    }
    else {
        overlayWindow.setAlwaysOnTop(true, 'screen-saver');
        overlayWindow.setFullScreen(true);
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
 */
function closeOverlay() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.destroy();
        overlayWindow = null;
    }
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