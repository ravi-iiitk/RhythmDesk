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
import { formatDuration, formatDurationHuman } from '../shared/timeUtils';
import { showMainWindow, setQuitting } from './windowManager';
import { getTimerEngine } from '../core/timerEngine';
import { getOfficeFocusLockService } from '../core/officeFocusLockService';

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

// Tooltip throttling
// Normal phases: 10 seconds
// Break phases: 5 seconds
const TOOLTIP_INTERVAL_NORMAL_MS = 10000;
const TOOLTIP_INTERVAL_BREAK_MS = 5000;
let lastTooltipUpdate: number = 0;

// ============================================================================
// HELPER: Check if phase is a break/transition
// ============================================================================

function isBreakPhase(phase: PhaseType): boolean {
  return [
    'sit-to-stand-transition',
    'stand-to-sit-transition',
    'short-break',
    'long-break',
  ].includes(phase);
}

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
    return;
  }
  
  const now = Date.now();
  
  // Determine throttle interval based on phase
  // Breaks: 5 seconds, Normal: 10 seconds
  const throttleInterval = isBreakPhase(tick.currentPhase) 
    ? TOOLTIP_INTERVAL_BREAK_MS 
    : TOOLTIP_INTERVAL_NORMAL_MS;
  
  // Throttled tooltip update
  if (now - lastTooltipUpdate >= throttleInterval) {
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
 * Update tray tooltip with live countdown
 * ONLY called when:
 * - Menu is closed
 * - Throttle interval has passed
 */
function updateTrayTooltip(tick: TimerTick): void {
  if (!tray) return;
  // Double-check menu is not open (defensive)
  if (isMenuOpen) return;

  let tooltip = 'RhythmDesk';
  
  if (tick.scheduleName) {
    const phaseName = PHASE_DISPLAY_NAMES[tick.currentPhase] || tick.currentPhase;
    const remaining = formatDuration(tick.phaseRemainingMs);
    
    tooltip += `\n📅 ${tick.scheduleName}`;
    tooltip += `\n⏱️ ${phaseName}: ${remaining}`;
    
    if (tick.isPaused) {
      tooltip += '\n⏸ PAUSED';
    } else if (tick.isPostponed) {
      tooltip += '\n⏳ POSTPONED';
    }
    
    // Break progress info
    const bp = tick.breakProgress;
    if (bp.nextBreakType) {
      const nextBreakName = bp.nextBreakType === 'short-break' ? 'Short Break' : 'Long Break';
      const nextBreakIn = formatDurationHuman(bp.nextBreakInMs);
      tooltip += `\n☕ Next: ${nextBreakName} in ${nextBreakIn}`;
    }
    
    // Show long break separately if both enabled and short break is next
    if (bp.shortBreakEnabled && bp.longBreakEnabled && bp.nextBreakType === 'short-break') {
      const longBreakIn = formatDurationHuman(bp.msUntilNextLongBreak);
      tooltip += `\n🌴 Long Break: ${longBreakIn}`;
    }
    
    if (tick.officeFocusLock.isActive) {
      const lockRemaining = formatDuration(tick.officeFocusLock.remainingMs);
      tooltip += `\n🔒 ${tick.officeFocusLock.label}: ${lockRemaining}`;
    }
  } else {
    tooltip += '\n💤 No active schedule';
  }

  tray.setToolTip(tooltip);
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
function buildStaticTrayMenu(): Electron.Menu {
  const timerEngine = getTimerEngine();
  const officeFocusLockService = getOfficeFocusLockService();
  const tick = currentTick;

  const menuItems: Electron.MenuItemConstructorOptions[] = [];
  
  // ---- Status Header (static info, no countdown) ----
  if (tick?.scheduleName) {
    const phaseName = PHASE_DISPLAY_NAMES[tick.currentPhase] || tick.currentPhase;
    menuItems.push({ label: `📅 ${tick.scheduleName}`, enabled: false });
    menuItems.push({ label: `⏱️ ${phaseName}`, enabled: false });
    
    if (tick.isPaused) {
      menuItems.push({ label: '⏸ PAUSED', enabled: false });
    } else if (tick.isPostponed) {
      menuItems.push({ label: '⏳ POSTPONED', enabled: false });
    }
    
    if (tick.officeFocusLock.isActive) {
      menuItems.push({ label: `🔒 Focus: ${tick.officeFocusLock.label}`, enabled: false });
    }
  } else {
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
        submenu: OFFICE_FOCUS_LOCK_DURATIONS.map((minutes) => ({
          label: `${minutes} min`,
          click: () => officeFocusLockService.start('EPAM', minutes),
        })),
      },
      {
        label: 'Resy',
        submenu: OFFICE_FOCUS_LOCK_DURATIONS.map((minutes) => ({
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
  
  // ---- Main Actions ----
  menuItems.push({ label: '📊 Open Dashboard', click: () => showMainWindow() });
  menuItems.push({ type: 'separator' });
  menuItems.push({
    label: '❌ Quit RhythmDesk',
    click: () => {
      setQuitting(true);
      app.quit();
    },
  });

  return Menu.buildFromTemplate(menuItems);
}
