"use strict";
/**
 * RhythmDesk System Tray
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
const types_1 = require("../shared/types");
const constants_1 = require("../shared/constants");
const timeUtils_1 = require("../shared/timeUtils");
const windowManager_1 = require("./windowManager");
const timerEngine_1 = require("../core/timerEngine");
const officeFocusLockService_1 = require("../core/officeFocusLockService");
let tray = null;
let currentTick = null;
/**
 * Create the system tray icon
 */
function createTray() {
    // Resolve icon path for both dev and production
    // In dev: __dirname is dist/main/main, project root is 3 levels up
    // In prod (packaged): resources are in app.asar or extraResources
    const isDev = !electron_1.app.isPackaged;
    let iconPath;
    if (isDev) {
        // Development: go up from dist/main/main to project root
        iconPath = path.join(__dirname, '../../../resources/icon.png');
    }
    else {
        // Production: use extraResources path
        iconPath = path.join(process.resourcesPath, 'resources/icon.png');
    }
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
    tray.setToolTip('RhythmDesk');
    // Set static menu once - on Linux/AppIndicator, dynamic updates cause flicker
    // Status info is shown in tooltip instead (updates every second)
    const menu = buildContextMenu();
    tray.setContextMenu(menu);
    // Left-click opens dashboard (may not work on all Linux DEs)
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
 * Only updates tooltip - menu is completely static to avoid Linux AppIndicator flicker
 */
function updateTrayWithTick(tick) {
    currentTick = tick;
    updateTrayTooltip();
}
/**
 * Update tray tooltip
 * Format:
 * RhythmDesk
 * Schedule: <name>
 * Phase: <phase>
 * Remaining: <time>
 * Focus Lock: <state>
 */
function updateTrayTooltip() {
    if (!tray || !currentTick)
        return;
    let tooltip = 'RhythmDesk';
    if (currentTick.scheduleName) {
        const phaseName = constants_1.PHASE_DISPLAY_NAMES[currentTick.currentPhase] || currentTick.currentPhase;
        const remaining = (0, timeUtils_1.formatDuration)(currentTick.phaseRemainingMs);
        tooltip = 'RhythmDesk';
        tooltip += `\nSchedule: ${currentTick.scheduleName}`;
        tooltip += `\nPhase: ${phaseName}`;
        tooltip += `\nRemaining: ${remaining}`;
        if (currentTick.isPaused) {
            tooltip += '\nStatus: ⏸ Paused';
        }
        else if (currentTick.isPostponed) {
            tooltip += '\nStatus: ⏳ Postponed';
        }
        // Add Office Focus Lock status to tooltip
        if (currentTick.officeFocusLock.isActive) {
            const lockRemaining = (0, timeUtils_1.formatDuration)(currentTick.officeFocusLock.remainingMs);
            tooltip += `\nFocus Lock: ${currentTick.officeFocusLock.label} (${lockRemaining})`;
        }
    }
    else {
        tooltip = 'RhythmDesk\nStatus: Idle';
    }
    tray.setToolTip(tooltip);
}
/**
 * Build static context menu - no dynamic content to avoid AppIndicator flicker
 * All status info is shown in tooltip instead (hover over icon)
 */
function buildContextMenu() {
    const timerEngine = (0, timerEngine_1.getTimerEngine)();
    const officeFocusLockService = (0, officeFocusLockService_1.getOfficeFocusLockService)();
    const menuItems = [];
    // Static header - tell user to hover for status
    menuItems.push({ label: '⏱️ RhythmDesk', enabled: false });
    menuItems.push({ label: '(Hover icon for status)', enabled: false });
    menuItems.push({ type: 'separator' });
    // Timer controls
    menuItems.push({ label: '⏸ Pause Timer', click: () => timerEngine.pause() });
    menuItems.push({ label: '▶️ Resume Timer', click: () => timerEngine.resume() });
    menuItems.push({ type: 'separator' });
    // Pause durations
    menuItems.push({
        label: '⏸ Pause for...',
        submenu: [
            { label: '5 minutes', click: () => timerEngine.pauseForDuration(5) },
            { label: '10 minutes', click: () => timerEngine.pauseForDuration(10) },
            { label: '15 minutes', click: () => timerEngine.pauseForDuration(15) },
            { label: '30 minutes', click: () => timerEngine.pauseForDuration(30) },
        ],
    });
    menuItems.push({
        label: '⏳ Postpone...',
        submenu: [
            { label: '2 minutes', click: () => timerEngine.postpone(2) },
            { label: '5 minutes', click: () => timerEngine.postpone(5) },
            { label: '10 minutes', click: () => timerEngine.postpone(10) },
        ],
    });
    menuItems.push({ label: '⏭ Skip Phase', click: () => timerEngine.skipPhase() });
    menuItems.push({ type: 'separator' });
    // Office Focus Lock
    menuItems.push({
        label: '🔒 Start Focus Lock',
        submenu: [
            {
                label: 'EPAM',
                submenu: types_1.OFFICE_FOCUS_LOCK_DURATIONS.map((minutes) => ({
                    label: `${minutes} min`,
                    click: () => officeFocusLockService.start('EPAM', minutes),
                })),
            },
            {
                label: 'Resy',
                submenu: types_1.OFFICE_FOCUS_LOCK_DURATIONS.map((minutes) => ({
                    label: `${minutes} min`,
                    click: () => officeFocusLockService.start('Resy', minutes),
                })),
            },
        ],
    });
    menuItems.push({ label: '🔓 Stop Focus Lock', click: () => officeFocusLockService.stop() });
    menuItems.push({ type: 'separator' });
    // Main actions
    menuItems.push({ label: '📊 Open Dashboard', click: () => (0, windowManager_1.showMainWindow)() });
    menuItems.push({ type: 'separator' });
    menuItems.push({
        label: '❌ Quit RhythmDesk',
        click: () => {
            (0, windowManager_1.setQuitting)(true);
            electron_1.app.quit();
        },
    });
    return electron_1.Menu.buildFromTemplate(menuItems);
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