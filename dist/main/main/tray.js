"use strict";
/**
 * RhythmDesk System Tray
 *
 * LINUX APPINDICATOR/KSTATUSNOTIFIER STABILIZATION:
 *
 * Problem: Linux tray implementations (AppIndicator, KStatusNotifier) flicker
 * when the menu is rebuilt or tray is updated while menu is open.
 *
 * Solution - STRICT RULES:
 * 1. Track menu open/close state explicitly
 * 2. FREEZE all tray updates while menu is open:
 *    - No tooltip updates
 *    - No menu rebuilds
 *    - No icon changes
 * 3. Queue pending state while menu is open
 * 4. Apply ONE consolidated update when menu closes
 * 5. Menu is STATIC - no live countdown in labels
 * 6. Tooltip throttled: 10s normal, 5s during breaks
 * 7. Menu only rebuilt on critical structural changes:
 *    - pause/resume state change
 *    - focus lock start/stop
 *    - active schedule changed (name, not phase)
 *    - NOT on phase change (that's in tooltip)
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
exports.forceRefreshTrayMenu = forceRefreshTrayMenu;
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
// ============================================================================
// STATE
// ============================================================================
// Tray instance
let tray = null;
// Current tick for tooltip/menu content
let currentTick = null;
// CRITICAL: Menu open state tracking
// When true, ALL tray updates are frozen
let isMenuOpen = false;
// Pending update flag - set when update was skipped due to menu being open
let hasPendingUpdate = false;
let previousMenuState = null;
// Tooltip throttling - 5 second cadence for stability
// Immediate update on important state changes (handled separately)
const TOOLTIP_INTERVAL_MS = 5000;
let lastTooltipUpdate = 0;
// Track last phase for detecting phase changes (triggers immediate tooltip update)
let lastPhase = null;
// ============================================================================
// PUBLIC API
// ============================================================================
/**
 * Create the system tray icon
 * Called once at app startup
 */
function createTray() {
    const icon = loadTrayIcon();
    tray = new electron_1.Tray(icon.resize({ width: 22, height: 22 }));
    tray.setToolTip('RhythmDesk - Starting...');
    // Build initial static menu with menu-will-show/hide tracking
    rebuildMenuWithTracking();
    // Left-click opens dashboard (may not work on all Linux DEs)
    tray.on('click', () => {
        (0, windowManager_1.showMainWindow)();
    });
    return tray;
}
/**
 * Update tray with current timer state
 * Called every second from timer engine tick
 *
 * CRITICAL: ALL updates are FROZEN while menu is open
 * Updates are queued and applied when menu closes
 */
function updateTrayWithTick(tick) {
    // Always store latest tick for when menu closes
    currentTick = tick;
    // FREEZE: Skip ALL updates while menu is open
    if (isMenuOpen) {
        hasPendingUpdate = true;
        return;
    }
    const now = Date.now();
    // Check for phase change - triggers immediate tooltip update
    const phaseChanged = lastPhase !== null && lastPhase !== tick.currentPhase;
    lastPhase = tick.currentPhase;
    // Throttled tooltip update (5s cadence) OR immediate on phase change
    if (phaseChanged || now - lastTooltipUpdate >= TOOLTIP_INTERVAL_MS) {
        updateTrayTooltip(tick);
        lastTooltipUpdate = now;
    }
    // Check if menu needs rebuild (structural change only)
    checkAndRebuildMenuIfNeeded(tick);
}
/**
 * Force refresh tray menu
 * Call when you know state has changed (e.g., from IPC handler)
 *
 * CRITICAL: Respects menu open state - queues if menu is open
 */
function forceRefreshTrayMenu(reason) {
    if (!tray)
        return;
    // FREEZE: Queue update if menu is open
    if (isMenuOpen) {
        console.log(`[Tray] Force refresh queued (menu open): ${reason}`);
        hasPendingUpdate = true;
        return;
    }
    console.log(`[Tray] Force refresh: ${reason}`);
    rebuildMenuWithTracking();
    // Update previousMenuState to current
    if (currentTick) {
        previousMenuState = extractMenuState(currentTick);
    }
}
/**
 * Destroy tray
 */
function destroyTray() {
    if (tray) {
        tray.destroy();
        tray = null;
    }
    previousMenuState = null;
    currentTick = null;
    isMenuOpen = false;
    hasPendingUpdate = false;
}
/**
 * Get tray instance
 */
function getTray() {
    return tray;
}
// ============================================================================
// PRIVATE: ICON LOADING
// ============================================================================
/**
 * Load tray icon from resources
 * Uses smaller icon (48x48 or 32x32) for system tray
 * This is separate from the app launcher/taskbar icon
 */
function loadTrayIcon() {
    const isDev = !electron_1.app.isPackaged;
    // Try multiple icon paths in order of preference
    const iconPaths = isDev
        ? [
            path.join(__dirname, '../../../resources/icons/48x48.png'),
            path.join(__dirname, '../../../resources/icons/32x32.png'),
            path.join(__dirname, '../../../resources/icons/icon.png'),
            path.join(__dirname, '../../../resources/icon.png'),
        ]
        : [
            path.join(process.resourcesPath, 'resources/icons/48x48.png'),
            path.join(process.resourcesPath, 'resources/icons/32x32.png'),
            path.join(process.resourcesPath, 'resources/icons/icon.png'),
            path.join(process.resourcesPath, 'resources/icon.png'),
        ];
    for (const iconPath of iconPaths) {
        try {
            const icon = electron_1.nativeImage.createFromPath(iconPath);
            if (!icon.isEmpty()) {
                return icon;
            }
        }
        catch {
            // Try next path
        }
    }
    return createFallbackIcon();
}
/**
 * Create a simple fallback icon
 */
function createFallbackIcon() {
    const size = 22;
    const canvas = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
        const offset = i * 4;
        canvas[offset] = 59; // R (blue-ish)
        canvas[offset + 1] = 130; // G
        canvas[offset + 2] = 246; // B
        canvas[offset + 3] = 255; // A
    }
    return electron_1.nativeImage.createFromBuffer(canvas, { width: size, height: size });
}
// ============================================================================
// PRIVATE: TOOLTIP (Throttled, frozen while menu open)
// ============================================================================
/**
 * Update tray tooltip with comprehensive status
 *
 * Content includes:
 * - App name
 * - Schedule name and mode
 * - Focus lock status (if active)
 * - Current phase and remaining time
 * - Next phase
 * - Then phase (if available)
 * - Next break info
 * - Paused/postponed status
 *
 * ONLY called when:
 * - Menu is closed
 * - Throttle interval has passed (5s) OR phase changed
 */
function updateTrayTooltip(tick) {
    if (!tray)
        return;
    // Double-check menu is not open (defensive)
    if (isMenuOpen)
        return;
    const lines = ['RhythmDesk'];
    if (tick.scheduleName) {
        // Schedule info
        lines.push(`Schedule: ${tick.scheduleName}`);
        // Schedule mode (if available in tick)
        if (tick.scheduleMode) {
            const modeLabel = tick.scheduleMode === 'flow-based' ? 'Flow-Based' : 'Rule-Based';
            lines.push(`Mode: ${modeLabel}`);
        }
        // Focus lock status (prominent if active)
        if (tick.officeFocusLock.isActive) {
            const lockRemaining = (0, timeUtils_1.formatDuration)(tick.officeFocusLock.remainingMs);
            lines.push(`🔒 Focus: ${tick.officeFocusLock.label} (${lockRemaining})`);
        }
        // Current phase and remaining time
        const phaseName = constants_1.PHASE_DISPLAY_NAMES[tick.currentPhase] || tick.currentPhase;
        const remaining = (0, timeUtils_1.formatDuration)(tick.phaseRemainingMs);
        lines.push(`Current: ${phaseName}`);
        lines.push(`Remaining: ${remaining}`);
        // Paused/postponed status
        if (tick.isPaused) {
            lines.push('⏸ PAUSED');
        }
        else if (tick.isPostponed) {
            lines.push('⏳ POSTPONED');
        }
        // Next phase
        if (tick.nextPhase && tick.nextPhase !== 'idle') {
            const nextPhaseName = constants_1.PHASE_DISPLAY_NAMES[tick.nextPhase] || tick.nextPhase;
            const nextDuration = tick.nextPhaseDurationMs ? (0, timeUtils_1.formatDurationHuman)(tick.nextPhaseDurationMs) : '';
            lines.push(`Next: ${nextPhaseName}${nextDuration ? ` (${nextDuration})` : ''}`);
        }
        // Then phase (if available)
        if (tick.thenPhase && tick.thenPhase !== 'idle') {
            const thenPhaseName = constants_1.PHASE_DISPLAY_NAMES[tick.thenPhase] || tick.thenPhase;
            const thenDuration = tick.thenPhaseDurationMs ? (0, timeUtils_1.formatDurationHuman)(tick.thenPhaseDurationMs) : '';
            lines.push(`Then: ${thenPhaseName}${thenDuration ? ` (${thenDuration})` : ''}`);
        }
        // Next break info
        const bp = tick.breakProgress;
        if (bp.nextBreakType) {
            const nextBreakName = bp.nextBreakType === 'short-break' ? 'Short Break' : 'Long Break';
            const nextBreakIn = (0, timeUtils_1.formatDurationHuman)(bp.nextBreakInMs);
            lines.push(`Next Break: ${nextBreakName} in ${nextBreakIn}`);
        }
    }
    else {
        // No active schedule
        lines.push('No active schedule');
        // Could add "Next schedule: X at HH:MM" here if we have that info
    }
    tray.setToolTip(lines.join('\n'));
}
// ============================================================================
// PRIVATE: MENU (STATIC - rebuilt only on critical structural changes)
// ============================================================================
/**
 * Rebuild menu with open/close tracking
 * This is the ONLY place that calls tray.setContextMenu()
 */
function rebuildMenuWithTracking() {
    if (!tray)
        return;
    const menu = buildStaticTrayMenu();
    // Track menu open/close via menu-will-show/menu-will-close events
    // Note: These events are available in Electron's Menu
    menu.on('menu-will-show', () => {
        console.log('[Tray] Menu opened - freezing updates');
        isMenuOpen = true;
    });
    menu.on('menu-will-close', () => {
        console.log('[Tray] Menu closed - unfreezing updates');
        isMenuOpen = false;
        // Apply pending update if any
        if (hasPendingUpdate && currentTick) {
            hasPendingUpdate = false;
            // Use setTimeout to ensure menu is fully closed
            setTimeout(() => {
                if (currentTick && !isMenuOpen) {
                    console.log('[Tray] Applying pending update after menu close');
                    updateTrayTooltip(currentTick);
                    checkAndRebuildMenuIfNeeded(currentTick);
                }
            }, 100);
        }
    });
    tray.setContextMenu(menu);
}
/**
 * Extract menu-relevant state from tick
 * Used to detect structural changes
 * NOTE: Does NOT include currentPhase - phase changes are in tooltip only
 */
function extractMenuState(tick) {
    return {
        scheduleName: tick.scheduleName,
        isPaused: tick.isPaused,
        isPostponed: tick.isPostponed,
        focusLockActive: tick.officeFocusLock.isActive,
        focusLockLabel: tick.officeFocusLock.label,
    };
}
/**
 * Check if menu state has structurally changed
 * Only checks critical state changes, NOT phase changes
 */
function hasMenuStateChanged(current, previous) {
    if (!previous)
        return true;
    return (current.scheduleName !== previous.scheduleName ||
        current.isPaused !== previous.isPaused ||
        current.isPostponed !== previous.isPostponed ||
        current.focusLockActive !== previous.focusLockActive ||
        current.focusLockLabel !== previous.focusLockLabel);
}
/**
 * Check if menu needs refresh and rebuild if necessary
 * Only rebuilds on STRUCTURAL changes, not every tick
 * CRITICAL: Respects menu open state
 */
function checkAndRebuildMenuIfNeeded(tick) {
    if (!tray)
        return;
    // FREEZE: Never rebuild while menu is open
    if (isMenuOpen) {
        return;
    }
    const currentState = extractMenuState(tick);
    if (hasMenuStateChanged(currentState, previousMenuState)) {
        console.log('[Tray] Menu state changed, rebuilding menu');
        rebuildMenuWithTracking();
        previousMenuState = currentState;
    }
}
/**
 * Build static tray menu
 *
 * IMPORTANT: No live countdown in labels!
 * Menu shows current state (phase name, paused status) but NOT remaining time.
 * Remaining time is shown in tooltip only.
 */
function buildStaticTrayMenu() {
    const timerEngine = (0, timerEngine_1.getTimerEngine)();
    const officeFocusLockService = (0, officeFocusLockService_1.getOfficeFocusLockService)();
    const tick = currentTick;
    const menuItems = [];
    // ---- Status Header (static info, no countdown) ----
    if (tick?.scheduleName) {
        const phaseName = constants_1.PHASE_DISPLAY_NAMES[tick.currentPhase] || tick.currentPhase;
        menuItems.push({ label: `📅 ${tick.scheduleName}`, enabled: false });
        menuItems.push({ label: `⏱️ ${phaseName}`, enabled: false });
        if (tick.isPaused) {
            menuItems.push({ label: '⏸ PAUSED', enabled: false });
        }
        else if (tick.isPostponed) {
            menuItems.push({ label: '⏳ POSTPONED', enabled: false });
        }
        if (tick.officeFocusLock.isActive) {
            menuItems.push({ label: `🔒 Focus: ${tick.officeFocusLock.label}`, enabled: false });
        }
    }
    else {
        menuItems.push({ label: '💤 No active schedule', enabled: false });
    }
    menuItems.push({ type: 'separator' });
    // ---- Timer Controls ----
    menuItems.push({
        label: '⏸ Pause Timer',
        click: () => timerEngine.pause(),
        enabled: tick ? !tick.isPaused : false,
    });
    menuItems.push({
        label: '▶️ Resume Timer',
        click: () => timerEngine.resume(),
        enabled: tick?.isPaused || false,
    });
    menuItems.push({ type: 'separator' });
    // ---- Pause Durations ----
    menuItems.push({
        label: '⏸ Pause for...',
        submenu: [
            { label: '5 minutes', click: () => timerEngine.pauseForDuration(5) },
            { label: '10 minutes', click: () => timerEngine.pauseForDuration(10) },
            { label: '15 minutes', click: () => timerEngine.pauseForDuration(15) },
            { label: '30 minutes', click: () => timerEngine.pauseForDuration(30) },
        ],
    });
    // ---- Postpone Options ----
    const canPostpone = tick?.canPostpone || false;
    menuItems.push({
        label: '⏳ Postpone...',
        enabled: canPostpone,
        submenu: [
            { label: '2 minutes', click: () => timerEngine.postpone(2) },
            { label: '5 minutes', click: () => timerEngine.postpone(5) },
            { label: '10 minutes', click: () => timerEngine.postpone(10) },
        ],
    });
    menuItems.push({ label: '⏭ Skip Phase', click: () => timerEngine.skipPhase() });
    menuItems.push({ label: '✓ Complete Phase', click: () => timerEngine.completePhase() });
    menuItems.push({ type: 'separator' });
    // ---- Office Focus Lock ----
    const focusLockActive = tick?.officeFocusLock.isActive || false;
    menuItems.push({
        label: '🔒 Start Focus Lock',
        enabled: !focusLockActive,
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
    menuItems.push({
        label: '🔓 Stop Focus Lock',
        click: () => officeFocusLockService.stop(),
        enabled: focusLockActive,
    });
    menuItems.push({ type: 'separator' });
    // ---- Session Controls ----
    menuItems.push({
        label: '🔄 Reset Session',
        click: () => timerEngine.resetSession(),
        enabled: tick?.scheduleName !== null,
    });
    menuItems.push({ type: 'separator' });
    // ---- Main Actions ----
    menuItems.push({ label: '📊 Open Dashboard', click: () => (0, windowManager_1.showMainWindow)() });
    menuItems.push({
        label: '⚙️ Settings',
        click: () => {
            (0, windowManager_1.showMainWindow)();
            // Navigate to settings after window opens
            setTimeout(() => {
                const mainWindow = require('./windowManager').getMainWindow();
                if (mainWindow) {
                    mainWindow.webContents.send('navigate', '/settings');
                }
            }, 100);
        },
    });
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
//# sourceMappingURL=tray.js.map