/**
 * RhythmDesk System Tray
 * Provides quick access to timer state and controls
 */

import { Tray, Menu, nativeImage, app } from 'electron';
import * as path from 'path';
import { TimerTick, OFFICE_FOCUS_LOCK_DURATIONS } from '../shared/types';
import { PHASE_DISPLAY_NAMES } from '../shared/constants';
import { formatDuration } from '../shared/timeUtils';
import { showMainWindow, setQuitting } from './windowManager';
import { getTimerEngine } from '../core/timerEngine';
import { getOfficeFocusLockService } from '../core/officeFocusLockService';

let tray: Tray | null = null;
let currentTick: TimerTick | null = null;

/**
 * Create the system tray icon
 */
export function createTray(): Tray {
  // Resolve icon path for both dev and production
  // In dev: __dirname is dist/main/main, project root is 3 levels up
  // In prod (packaged): resources are in app.asar or extraResources
  const isDev = !app.isPackaged;
  let iconPath: string;
  
  if (isDev) {
    // Development: go up from dist/main/main to project root
    iconPath = path.join(__dirname, '../../../resources/icon.png');
  } else {
    // Production: use extraResources path
    iconPath = path.join(process.resourcesPath, 'resources/icon.png');
  }
  
  let icon: Electron.NativeImage;
  
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // Create a fallback icon if file doesn't exist
      icon = createFallbackIcon();
    }
  } catch {
    icon = createFallbackIcon();
  }

  tray = new Tray(icon.resize({ width: 22, height: 22 }));
  tray.setToolTip('RhythmDesk');

  // Set static menu once - on Linux/AppIndicator, dynamic updates cause flicker
  // Status info is shown in tooltip instead (updates every second)
  const menu = buildContextMenu();
  tray.setContextMenu(menu);

  // Left-click opens dashboard (may not work on all Linux DEs)
  tray.on('click', () => {
    showMainWindow();
  });

  return tray;
}

/**
 * Create a simple fallback icon
 */
function createFallbackIcon(): Electron.NativeImage {
  // Create a simple 22x22 colored square as fallback
  const size = 22;
  const canvas = Buffer.alloc(size * size * 4);
  
  for (let i = 0; i < size * size; i++) {
    const offset = i * 4;
    canvas[offset] = 59;     // R (blue-ish)
    canvas[offset + 1] = 130; // G
    canvas[offset + 2] = 246; // B
    canvas[offset + 3] = 255; // A
  }
  
  return nativeImage.createFromBuffer(canvas, {
    width: size,
    height: size,
  });
}

/**
 * Update tray with current timer state
 * Only updates tooltip - menu is completely static to avoid Linux AppIndicator flicker
 */
export function updateTrayWithTick(tick: TimerTick): void {
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
function updateTrayTooltip(): void {
  if (!tray || !currentTick) return;

  let tooltip = 'RhythmDesk';
  
  if (currentTick.scheduleName) {
    const phaseName = PHASE_DISPLAY_NAMES[currentTick.currentPhase] || currentTick.currentPhase;
    const remaining = formatDuration(currentTick.phaseRemainingMs);
    
    tooltip = 'RhythmDesk';
    tooltip += `\nSchedule: ${currentTick.scheduleName}`;
    tooltip += `\nPhase: ${phaseName}`;
    tooltip += `\nRemaining: ${remaining}`;
    
    if (currentTick.isPaused) {
      tooltip += '\nStatus: ⏸ Paused';
    } else if (currentTick.isPostponed) {
      tooltip += '\nStatus: ⏳ Postponed';
    }
    
    // Add Office Focus Lock status to tooltip
    if (currentTick.officeFocusLock.isActive) {
      const lockRemaining = formatDuration(currentTick.officeFocusLock.remainingMs);
      tooltip += `\nFocus Lock: ${currentTick.officeFocusLock.label} (${lockRemaining})`;
    }
  } else {
    tooltip = 'RhythmDesk\nStatus: Idle';
  }

  tray.setToolTip(tooltip);
}

/**
 * Build static context menu - no dynamic content to avoid AppIndicator flicker
 * All status info is shown in tooltip instead (hover over icon)
 */
function buildContextMenu(): Electron.Menu {
  const timerEngine = getTimerEngine();
  const officeFocusLockService = getOfficeFocusLockService();

  const menuItems: Electron.MenuItemConstructorOptions[] = [];
  
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
  menuItems.push({ label: '🔓 Stop Focus Lock', click: () => officeFocusLockService.stop() });
  menuItems.push({ type: 'separator' });
  
  // Main actions
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


/**
 * Destroy tray
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

/**
 * Get tray instance
 */
export function getTray(): Tray | null {
  return tray;
}
