"use strict";
/**
 * PostureGuard System Tray
 * Provides quick access to timer state and controls
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
exports.createTray = createTray;
exports.updateTrayWithTick = updateTrayWithTick;
exports.destroyTray = destroyTray;
exports.getTray = getTray;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const constants_1 = require("../shared/constants");
const timeUtils_1 = require("../shared/timeUtils");
const windowManager_1 = require("./windowManager");
const timerEngine_1 = require("../core/timerEngine");
let tray = null;
let currentTick = null;
/**
 * Create the system tray icon
 */
function createTray() {
    // Create a simple tray icon (would be replaced with actual icon)
    const iconPath = path.join(__dirname, '../../resources/icon.png');
    let icon;
    try {
        icon = electron_1.nativeImage.createFromPath(iconPath);
        if (icon.isEmpty()) {
            // Create a fallback icon if file doesn't exist
            icon = createFallbackIcon();
        }
    }
    catch {
        icon = createFallbackIcon();
    }
    tray = new electron_1.Tray(icon.resize({ width: 22, height: 22 }));
    tray.setToolTip('PostureGuard');
    updateTrayMenu();
    tray.on('click', () => {
        (0, windowManager_1.showMainWindow)();
    });
    return tray;
}
/**
 * Create a simple fallback icon
 */
function createFallbackIcon() {
    // Create a simple 22x22 colored square as fallback
    const size = 22;
    const canvas = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
        const offset = i * 4;
        canvas[offset] = 59; // R (blue-ish)
        canvas[offset + 1] = 130; // G
        canvas[offset + 2] = 246; // B
        canvas[offset + 3] = 255; // A
    }
    return electron_1.nativeImage.createFromBuffer(canvas, {
        width: size,
        height: size,
    });
}
/**
 * Update tray with current timer state
 */
function updateTrayWithTick(tick) {
    currentTick = tick;
    updateTrayMenu();
    updateTrayTooltip();
}
/**
 * Update tray tooltip
 */
function updateTrayTooltip() {
    if (!tray || !currentTick)
        return;
    let tooltip = 'PostureGuard';
    if (currentTick.scheduleName) {
        const phaseName = constants_1.PHASE_DISPLAY_NAMES[currentTick.currentPhase] || currentTick.currentPhase;
        const remaining = (0, timeUtils_1.formatDuration)(currentTick.phaseRemainingMs);
        tooltip = `${currentTick.scheduleName}\n${phaseName}: ${remaining}`;
        if (currentTick.isPaused) {
            tooltip += ' (Paused)';
        }
        else if (currentTick.isPostponed) {
            tooltip += ' (Postponed)';
        }
    }
    else {
        tooltip = 'PostureGuard - Idle';
    }
    tray.setToolTip(tooltip);
}
/**
 * Update tray context menu
 */
function updateTrayMenu() {
    if (!tray)
        return;
    const timerEngine = (0, timerEngine_1.getTimerEngine)();
    const menuItems = [];
    // Status header
    if (currentTick?.scheduleName) {
        const phaseName = constants_1.PHASE_DISPLAY_NAMES[currentTick.currentPhase] || currentTick.currentPhase;
        const remaining = (0, timeUtils_1.formatDuration)(currentTick.phaseRemainingMs);
        menuItems.push({
            label: currentTick.scheduleName,
            enabled: false,
        });
        menuItems.push({
            label: `${phaseName}: ${remaining}`,
            enabled: false,
        });
        if (currentTick.isPaused) {
            menuItems.push({ label: '⏸ Paused', enabled: false });
        }
        else if (currentTick.isPostponed) {
            menuItems.push({ label: '⏳ Postponed', enabled: false });
        }
        menuItems.push({ type: 'separator' });
        // Pause/Resume
        if (currentTick.isPaused) {
            menuItems.push({
                label: 'Resume',
                click: () => timerEngine.resume(),
            });
        }
        else {
            menuItems.push({
                label: 'Pause',
                click: () => timerEngine.pause(),
            });
            menuItems.push({
                label: 'Pause for...',
                submenu: [
                    { label: '5 minutes', click: () => timerEngine.pauseForDuration(5) },
                    { label: '10 minutes', click: () => timerEngine.pauseForDuration(10) },
                    { label: '15 minutes', click: () => timerEngine.pauseForDuration(15) },
                    { label: '30 minutes', click: () => timerEngine.pauseForDuration(30) },
                ],
            });
        }
        // Postpone
        if (currentTick.canPostpone && currentTick.postponeOptions.length > 0) {
            const remainingPostpones = currentTick.maxPostponesPerDay - currentTick.postponeCountToday;
            menuItems.push({
                label: `Postpone (${remainingPostpones} left)`,
                submenu: currentTick.postponeOptions.map((minutes) => ({
                    label: `${minutes} minutes`,
                    click: () => timerEngine.postpone(minutes),
                })),
            });
        }
        // Skip (only if not in strict mode or for non-work phases)
        if (!currentTick.isStrictMode || !isWorkPhase(currentTick.currentPhase)) {
            menuItems.push({
                label: 'Skip Phase',
                click: () => timerEngine.skipPhase(),
            });
        }
        menuItems.push({ type: 'separator' });
    }
    else {
        menuItems.push({
            label: 'Idle - No active schedule',
            enabled: false,
        });
        menuItems.push({ type: 'separator' });
    }
    // Settings
    menuItems.push({
        label: 'Open Settings',
        click: () => (0, windowManager_1.showMainWindow)(),
    });
    menuItems.push({ type: 'separator' });
    // Quit
    menuItems.push({
        label: 'Quit PostureGuard',
        click: () => electron_1.app.quit(),
    });
    const contextMenu = electron_1.Menu.buildFromTemplate(menuItems);
    tray.setContextMenu(contextMenu);
}
/**
 * Check if phase is a work phase
 */
function isWorkPhase(phase) {
    return phase === 'sit' || phase === 'stand';
}
/**
 * Destroy tray
 */
function destroyTray() {
    if (tray) {
        tray.destroy();
        tray = null;
    }
}
/**
 * Get tray instance
 */
function getTray() {
    return tray;
}
//# sourceMappingURL=tray.js.map