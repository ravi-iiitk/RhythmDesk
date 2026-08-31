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

import { Tray, Menu, nativeImage, app } from 'electron';
import * as path from 'path';
import { TimerTick, OFFICE_FOCUS_LOCK_DURATIONS, PhaseType } from '../shared/types';
import { PHASE_DISPLAY_NAMES } from '../shared/constants';
import { formatDurationHuman } from '../shared/timeUtils';
import { showMainWindow, setQuitting, closeOverlay, getOverlayWindow } from './windowManager';
import { isFocusLockdownActive } from './focusLockdown';

/**
 * Format milliseconds to minutes only (rounded) for tray display
 * Shows "X min" format which doesn't look stale as quickly
 */
function formatMinutesOnly(ms: number): string {
  const totalMinutes = Math.ceil(ms / 60000);
  if (totalMinutes <= 0) return '< 1 min';
  if (totalMinutes === 1) return '1 min';
  return `${totalMinutes} min`;
}
import { getTimerEngine } from '../core/timerEngine';
import { getOfficeFocusLockService } from '../core/officeFocusLockService';
import { getRestBlockService } from '../core/restBlockService';
import { 
  logTrayCreated, 
  logTrayTooltipUpdated, 
  logTrayMenuRebuilt, 
  logTrayMenuOpen, 
  logTrayMenuClose,
  logTrayRefreshDeferred,
  logTrayRefreshApplied,
} from '../core/overlayDebug';

// ============================================================================
// STATE
// ============================================================================

// Tray instance
let tray: Tray | null = null;

// Current tick for tooltip/menu content
let currentTick: TimerTick | null = null;

// CRITICAL: Menu open state tracking
// When true, ALL tray updates are frozen
let isMenuOpen: boolean = false;

// Pending update flag - set when update was skipped due to menu being open
let hasPendingUpdate: boolean = false;

// Previous state for detecting structural changes (menu rebuild triggers)
// NOTE: Does NOT include currentPhase - phase changes don't rebuild menu
interface TrayMenuState {
  scheduleName: string | null;
  isPaused: boolean;
  isPostponed: boolean;
  focusLockActive: boolean;
  focusLockLabel: string;
}

let previousMenuState: TrayMenuState | null = null;

// Track last phase for detecting phase changes
let lastPhase: PhaseType | null = null;

// 30-second refresh interval for tooltip/menu - balances accuracy vs flickering
const REFRESH_INTERVAL_MS = 30000;
let lastRefresh: number = 0;


// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Create the system tray icon
 * Called once at app startup
 */
export function createTray(): Tray {
  const icon = loadTrayIcon();

  tray = new Tray(icon.resize({ width: 22, height: 22 }));
  tray.setToolTip('RhythmDesk - Starting...');

  // Build initial static menu with menu-will-show/hide tracking
  rebuildMenuWithTracking();

  // Left-click opens dashboard (may not work on all Linux DEs)
  tray.on('click', () => {
    showMainWindow();
  });

  logTrayCreated();
  return tray;
}

/**
 * Update tray with current timer state
 * Called every second from timer engine tick
 * 
 * CRITICAL: ALL updates are FROZEN while menu is open
 * Updates are queued and applied when menu closes
 */
export function updateTrayWithTick(tick: TimerTick): void {
  // Always store latest tick for when menu closes
  currentTick = tick;
  
  // FREEZE: Skip ALL updates while menu is open
  if (isMenuOpen) {
    hasPendingUpdate = true;
    logTrayRefreshDeferred();
    return;
  }
  
  // Check for phase change - triggers immediate update
  const phaseChanged = lastPhase !== null && lastPhase !== tick.currentPhase;
  lastPhase = tick.currentPhase;
  
  // Check for 30-second refresh interval
  const now = Date.now();
  const needsTimeRefresh = now - lastRefresh >= REFRESH_INTERVAL_MS;
  
  // Update tooltip on phase change OR every 30 seconds
  if (phaseChanged || needsTimeRefresh) {
    updateTrayTooltip(tick);
    lastRefresh = now;
  }
  
  // Rebuild menu on phase change OR every 30 seconds (for time accuracy)
  if (phaseChanged || needsTimeRefresh) {
    rebuildMenuWithTracking();
  } else {
    // Still check for structural changes (pause/resume, etc.)
    checkAndRebuildMenuIfNeeded(tick);
  }
}

/**
 * Force refresh tray menu
 * Call when you know state has changed (e.g., from IPC handler)
 * 
 * CRITICAL: Respects menu open state - queues if menu is open
 */
export function forceRefreshTrayMenu(reason: string): void {
  if (!tray) return;
  
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
export function destroyTray(): void {
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
export function getTray(): Tray | null {
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
function loadTrayIcon(): Electron.NativeImage {
  const isDev = !app.isPackaged;
  
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
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        return icon;
      }
    } catch {
      // Try next path
    }
  }
  
  return createFallbackIcon();
}

/**
 * Create a simple fallback icon
 */
function createFallbackIcon(): Electron.NativeImage {
  const size = 22;
  const canvas = Buffer.alloc(size * size * 4);
  
  for (let i = 0; i < size * size; i++) {
    const offset = i * 4;
    canvas[offset] = 59;      // R (blue-ish)
    canvas[offset + 1] = 130; // G
    canvas[offset + 2] = 246; // B
    canvas[offset + 3] = 255; // A
  }
  
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
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
function updateTrayTooltip(tick: TimerTick): void {
  if (!tray) return;
  // Double-check menu is not open (defensive)
  if (isMenuOpen) return;
  
  logTrayTooltipUpdated(tick.currentPhase, tick.phaseRemainingMs);

  const lines: string[] = [];
  
  if (tick.scheduleName) {
    // Header with schedule name
    lines.push(`RhythmDesk - ${tick.scheduleName}`);
    
    // Focus lock status (prominent if active)
    if (tick.officeFocusLock.isActive) {
      const lockRemaining = formatMinutesOnly(tick.officeFocusLock.remainingMs);
      lines.push(`🔒 Focus Lock: ${tick.officeFocusLock.label} (${lockRemaining})`);
    }
    
    // Current activity with time - MOST IMPORTANT INFO (in minutes)
    const phaseName = tick.currentPhaseLabel || PHASE_DISPLAY_NAMES[tick.currentPhase] || tick.currentPhase;
    const remaining = formatMinutesOnly(tick.phaseRemainingMs);
    const phaseEmoji = getPhaseEmoji(tick.currentPhase);
    lines.push(`${phaseEmoji} Now: ${phaseName} - ${remaining} left`);
    
    // Paused/postponed status
    if (tick.isPaused) {
      lines.push('⏸️ PAUSED');
    } else if (tick.isPostponed) {
      lines.push('⏳ POSTPONED');
    }
    
    // Next activity
    if (tick.nextPhase && tick.nextPhase !== 'idle') {
      const nextPhaseName = tick.nextPhaseLabel || PHASE_DISPLAY_NAMES[tick.nextPhase] || tick.nextPhase;
      const nextDuration = tick.nextPhaseDurationMs ? formatDurationHuman(tick.nextPhaseDurationMs) : '';
      const nextEmoji = getPhaseEmoji(tick.nextPhase);
      lines.push(`${nextEmoji} Next: ${nextPhaseName}${nextDuration ? ` (${nextDuration})` : ''}`);
    }
    
    // Then activity (what comes after next)
    if (tick.thenPhase && tick.thenPhase !== 'idle') {
      const thenPhaseName = tick.thenPhaseLabel || PHASE_DISPLAY_NAMES[tick.thenPhase] || tick.thenPhase;
      const thenDuration = tick.thenPhaseDurationMs ? formatDurationHuman(tick.thenPhaseDurationMs) : '';
      const thenEmoji = getPhaseEmoji(tick.thenPhase);
      lines.push(`${thenEmoji} Then: ${thenPhaseName}${thenDuration ? ` (${thenDuration})` : ''}`);
    }
    
    // Next break info (when is the next scheduled break)
    const bp = tick.breakProgress;
    if (bp.nextBreakType && bp.nextBreakInMs > 0) {
      const nextBreakName = bp.nextBreakType === 'short-break' ? 'Short Break' : 'Long Break';
      const nextBreakIn = formatMinutesOnly(bp.nextBreakInMs);
      lines.push(`☕ ${nextBreakName} in ${nextBreakIn}`);
    }
    
    // Cumulative work time
    if (tick.cumulativeWorkTimeMs > 0) {
      const workTime = formatDurationHuman(tick.cumulativeWorkTimeMs);
      lines.push(`📊 Work time: ${workTime}`);
    }
  } else {
    // No active schedule
    lines.push('RhythmDesk');
    lines.push('No active schedule');
  }

  tray.setToolTip(lines.join('\n'));
}

/**
 * Get emoji for phase type for visual distinction in tooltip
 */
function getPhaseEmoji(phase: PhaseType): string {
  switch (phase) {
    case 'sit': return '🪑';
    case 'stand': return '🧍';
    case 'sit-to-stand-transition': return '⬆️';
    case 'stand-to-sit-transition': return '⬇️';
    case 'short-break': return '☕';
    case 'long-break': return '🌴';
    case 'idle': return '💤';
    default: return '▶️';
  }
}

// ============================================================================
// PRIVATE: MENU (STATIC - rebuilt only on critical structural changes)
// ============================================================================

/**
 * Rebuild menu with open/close tracking
 * This is the ONLY place that calls tray.setContextMenu()
 */
function rebuildMenuWithTracking(): void {
  if (!tray) return;
  
  const menu = buildStaticTrayMenu();
  
  // Track menu open/close via menu-will-show/menu-will-close events
  // Note: These events are available in Electron's Menu
  menu.on('menu-will-show', () => {
    logTrayMenuOpen();
    isMenuOpen = true;
  });
  
  menu.on('menu-will-close', () => {
    logTrayMenuClose();
    isMenuOpen = false;
    
    // Apply pending update if any
    if (hasPendingUpdate && currentTick) {
      hasPendingUpdate = false;
      // Use setTimeout to ensure menu is fully closed
      setTimeout(() => {
        if (currentTick && !isMenuOpen) {
          logTrayRefreshApplied();
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
function extractMenuState(tick: TimerTick): TrayMenuState {
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
function hasMenuStateChanged(current: TrayMenuState, previous: TrayMenuState | null): boolean {
  if (!previous) return true;
  
  return (
    current.scheduleName !== previous.scheduleName ||
    current.isPaused !== previous.isPaused ||
    current.isPostponed !== previous.isPostponed ||
    current.focusLockActive !== previous.focusLockActive ||
    current.focusLockLabel !== previous.focusLockLabel
  );
}

/**
 * Check if menu needs refresh and rebuild if necessary
 * Only rebuilds on STRUCTURAL changes, not every tick
 * CRITICAL: Respects menu open state
 */
function checkAndRebuildMenuIfNeeded(tick: TimerTick): void {
  if (!tray) return;
  
  // FREEZE: Never rebuild while menu is open
  if (isMenuOpen) {
    return;
  }
  
  const currentState = extractMenuState(tick);
  
  if (hasMenuStateChanged(currentState, previousMenuState)) {
    logTrayMenuRebuilt('state changed');
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
function buildStaticTrayMenu(): Electron.Menu {
  const timerEngine = getTimerEngine();
  const officeFocusLockService = getOfficeFocusLockService();
  const tick = currentTick;

  const menuItems: Electron.MenuItemConstructorOptions[] = [];
  
  // ---- Status Header with full info (using minutes only to avoid looking stale) ----
  if (tick?.scheduleName) {
    const phaseName = tick.currentPhaseLabel || PHASE_DISPLAY_NAMES[tick.currentPhase] || tick.currentPhase;
    const remaining = formatMinutesOnly(tick.phaseRemainingMs);
    const phaseEmoji = getPhaseEmoji(tick.currentPhase);
    
    // Schedule name
    menuItems.push({ label: `📅 ${tick.scheduleName}`, enabled: false });
    
    // Current activity with time remaining (in minutes)
    menuItems.push({ label: `${phaseEmoji} ${phaseName} - ${remaining} left`, enabled: false });
    
    // Paused/Postponed status
    if (tick.isPaused) {
      menuItems.push({ label: '⏸ PAUSED', enabled: false });
    } else if (tick.isPostponed) {
      menuItems.push({ label: '⏳ POSTPONED', enabled: false });
    }
    
    // Next activity
    if (tick.nextPhase && tick.nextPhase !== 'idle') {
      const nextPhaseName = tick.nextPhaseLabel || PHASE_DISPLAY_NAMES[tick.nextPhase] || tick.nextPhase;
      const nextDuration = tick.nextPhaseDurationMs ? formatDurationHuman(tick.nextPhaseDurationMs) : '';
      const nextEmoji = getPhaseEmoji(tick.nextPhase);
      menuItems.push({ label: `${nextEmoji} Next: ${nextPhaseName}${nextDuration ? ` (${nextDuration})` : ''}`, enabled: false });
    }
    
    // Then activity (what comes after next)
    if (tick.thenPhase && tick.thenPhase !== 'idle') {
      const thenPhaseName = tick.thenPhaseLabel || PHASE_DISPLAY_NAMES[tick.thenPhase] || tick.thenPhase;
      const thenDuration = tick.thenPhaseDurationMs ? formatDurationHuman(tick.thenPhaseDurationMs) : '';
      const thenEmoji = getPhaseEmoji(tick.thenPhase);
      menuItems.push({ label: `${thenEmoji} Then: ${thenPhaseName}${thenDuration ? ` (${thenDuration})` : ''}`, enabled: false });
    }
    
    // Next break info
    const bp = tick.breakProgress;
    if (bp.nextBreakType && bp.nextBreakInMs > 0) {
      const nextBreakName = bp.nextBreakType === 'short-break' ? 'Short Break' : 'Long Break';
      const nextBreakIn = formatMinutesOnly(bp.nextBreakInMs);
      menuItems.push({ label: `☕ ${nextBreakName} in ${nextBreakIn}`, enabled: false });
    }
    
    // Focus lock status
    if (tick.officeFocusLock.isActive) {
      const lockRemaining = formatMinutesOnly(tick.officeFocusLock.remainingMs);
      menuItems.push({ label: `🔒 Focus: ${tick.officeFocusLock.label} (${lockRemaining})`, enabled: false });
    }
    
    // Rest block status
    const restState = getRestBlockService().getState();
    if (restState.isActive) {
      const restRemaining = formatMinutesOnly(restState.remainingMs);
      menuItems.push({ label: `🛋️ Rest: ${restState.name || 'Rest Block'} (${restRemaining})`, enabled: false });
    }
    
    // Water reminder active
    if (tick.waterReminderActive) {
      menuItems.push({ label: '� Water Reminder Active', enabled: false });
    }
  } else {
    menuItems.push({ label: '�� No active schedule', enabled: false });
  }
  
  if (tick?.cumulativeWorkTimeMs && tick.cumulativeWorkTimeMs > 60000) {
    menuItems.push({ label: `📊 Work: ${formatDurationHuman(tick.cumulativeWorkTimeMs)}`, enabled: false });
  }
  menuItems.push({ type: 'separator' });

  // State flags for smart visibility
  const hasSchedule = !!tick?.scheduleName;
  const isPaused = tick?.isPaused || false;
  const isInBreak = tick?.currentPhase === 'short-break' || tick?.currentPhase === 'long-break';
  const canExtend = tick && ['sit', 'stand', 'short-break', 'long-break', 'custom'].includes(tick.currentPhase);
  const canPostpone = tick?.canPostpone || false;
  const focusLockActive = tick?.officeFocusLock.isActive || false;
  const restBlockService = getRestBlockService();
  const isInRestBlock = restBlockService.getState().isActive;

  // Quick actions — show only what's relevant
  if (isPaused) {
    menuItems.push({ label: '▶️ Resume Timer', click: () => timerEngine.resume() });
  } else {
    menuItems.push({ label: '⏸ Pause Timer', click: () => timerEngine.pause(), enabled: hasSchedule });
  }
  if (hasSchedule && !isPaused) {
    menuItems.push({ label: '⏭ Skip Phase', click: () => timerEngine.skipPhase() });
  }
  if (isInBreak || isInRestBlock) {
    menuItems.push({ label: '⏹️ Stop Break', click: () => { if (isInRestBlock) restBlockService.stop(); else timerEngine.skipPhase(); } });
  }
  menuItems.push({ type: 'separator' });

  // ---- Pause for... (top-level submenu, only when not paused) ----
  if (!isPaused) {
    menuItems.push({
      label: '⏸ Pause for...',
      submenu: [
        { label: '5 minutes', click: () => timerEngine.pauseForDuration(5) },
        { label: '10 minutes', click: () => timerEngine.pauseForDuration(10) },
        { label: '15 minutes', click: () => timerEngine.pauseForDuration(15) },
        { label: '30 minutes', click: () => timerEngine.pauseForDuration(30) },
        { label: '1 hour', click: () => timerEngine.pauseForDuration(60) },
      ],
    });
  }

  // ---- Postpone (top-level submenu, only when can postpone) ----
  if (canPostpone) {
    menuItems.push({
      label: '⏳ Postpone...',
      submenu: [
        { label: '2 minutes', click: () => timerEngine.postpone(2) },
        { label: '5 minutes', click: () => timerEngine.postpone(5) },
        { label: '10 minutes', click: () => timerEngine.postpone(10) },
      ],
    });
  }

  // ---- Extend / Reduce Phase (always visible, disabled when not applicable) ----
  menuItems.push({
    label: '⏱️ Extend Phase...',
    enabled: !!canExtend,
    submenu: [
      { label: '+2 minutes', click: () => timerEngine.extendBreak(2) },
      { label: '+5 minutes', click: () => timerEngine.extendBreak(5) },
      { label: '+10 minutes', click: () => timerEngine.extendBreak(10) },
    ],
  });
  menuItems.push({
    label: '⏪ Reduce Phase...',
    enabled: !!canExtend,
    submenu: [
      { label: '-1 minute', click: () => timerEngine.preponePhase(1) },
      { label: '-2 minutes', click: () => timerEngine.preponePhase(2) },
      { label: '-5 minutes', click: () => timerEngine.preponePhase(5) },
    ],
  });

  // ============================================================
  // 2. MORE CONTROLS — grouped submenu (less-frequent actions)
  // ============================================================
  menuItems.push({
    label: '⏯️ More Controls',
    submenu: [
      { label: '✓ Complete Phase', click: () => timerEngine.completePhase(), enabled: hasSchedule },
      { label: '🔁 Restart Activity', click: () => timerEngine.restartCurrentActivity(), enabled: hasSchedule },
      { type: 'separator' },
      { label: '🔀 Shuffle Flow', click: () => timerEngine.shuffleFlow(), enabled: hasSchedule },
      { label: '↩️ Reverse Flow', click: () => timerEngine.reverseFlow(), enabled: hasSchedule },
      { type: 'separator' },
      { label: '🔄 Reset Session', click: () => timerEngine.resetSession(), enabled: hasSchedule },
    ],
  });

  // ============================================================
  // 3. BREAKS — grouped submenu (hidden when in break/rest)
  // ============================================================
  if (!isInBreak && !isInRestBlock) {
    menuItems.push({
      label: '☕ Take a Break',
      submenu: [
        { label: '2 min — Quick', click: () => timerEngine.startAdHocBreak(2) },
        { label: '5 min — Short', click: () => timerEngine.startAdHocBreak(5) },
        { label: '10 min — Medium', click: () => timerEngine.startAdHocBreak(10) },
        { label: '15 min — Long', click: () => timerEngine.startAdHocBreak(15) },
        { label: '30 min — Extended', click: () => timerEngine.startAdHocBreak(30) },
        { type: 'separator' },
        { label: '🚻 Bio Break (2 min)', click: () => restBlockService.start('Bio Break', 2, false) },
        { label: '🛋️ Quick Rest (5 min)', click: () => restBlockService.start('Quick Rest', 5, false) },
        { label: '🍽️ Lunch (30 min)', click: () => restBlockService.start('Lunch Break', 30, false) },
        { label: '🍛 Dinner (45 min)', click: () => restBlockService.start('Dinner', 45, false) },
        { label: '🕐 1 Hour', click: () => restBlockService.start('Long Break', 60, false) },
      ],
    });
  }

  // ============================================================
  // 4. FOCUS LOCK — show/hide based on state
  // ============================================================
  if (focusLockActive) {
    menuItems.push({ label: '🔓 Stop Focus Lock', click: () => officeFocusLockService.stop() });
  } else {
    menuItems.push({
      label: '🔒 Focus Lock',
      submenu: [
        {
          label: 'Deep Work',
          submenu: OFFICE_FOCUS_LOCK_DURATIONS.map((m) => ({
            label: `${m} min`, click: () => officeFocusLockService.start('Deep Work', m),
          })),
        },
        {
          label: 'Meeting',
          submenu: OFFICE_FOCUS_LOCK_DURATIONS.map((m) => ({
            label: `${m} min`, click: () => officeFocusLockService.start('Meeting', m),
          })),
        },
      ],
    });
  }
  menuItems.push({ type: 'separator' });

  // ============================================================
  // 5. EMERGENCY & WATER CONTROLS
  // ============================================================
  const overlayExists = !!getOverlayWindow();
  if (overlayExists) {
    menuItems.push({
      label: '🚨 Kill Overlay (Emergency)',
      click: () => {
        closeOverlay();
        if (!timerEngine.getState().isPaused) {
          timerEngine.pause();
        }
      },
    });
  }
  if (timerEngine.isWaterReminderActive()) {
    menuItems.push({
      label: '💧 Dismiss Water Reminder',
      click: () => timerEngine.dismissWaterReminder(),
    });
  }
  menuItems.push({ type: 'separator' });

  // ============================================================
  // 6. NAVIGATION — always present
  // ============================================================
  menuItems.push({ label: '📊 Open Dashboard', click: () => showMainWindow() });
  menuItems.push({
    label: '⚙️ Settings',
    click: () => {
      showMainWindow();
      setTimeout(() => {
        const mainWindow = require('./windowManager').getMainWindow();
        if (mainWindow) mainWindow.webContents.send('navigate', '/settings');
      }, 100);
    },
  });
  menuItems.push({ type: 'separator' });

  if (isFocusLockdownActive()) {
    menuItems.push({
      label: '🔒 Focus Session Active — Quit Locked',
      enabled: false,
    });
  } else {
    menuItems.push({ label: '❌ Quit RhythmDesk', click: () => { setQuitting(true); app.quit(); } });
  }

  return Menu.buildFromTemplate(menuItems);
}
