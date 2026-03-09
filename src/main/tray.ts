/**
 * PostureGuard System Tray
 * Provides quick access to timer state and controls
 */

import { Tray, Menu, nativeImage, app } from 'electron';
import * as path from 'path';
import { TimerTick, PhaseType, OFFICE_FOCUS_LOCK_DURATIONS } from '../shared/types';
import { PHASE_DISPLAY_NAMES } from '../shared/constants';
import { formatDuration } from '../shared/timeUtils';
import { showMainWindow } from './windowManager';
import { getTimerEngine } from '../core/timerEngine';
import { getOfficeFocusLockService } from '../core/officeFocusLockService';

let tray: Tray | null = null;
let currentTick: TimerTick | null = null;

/**
 * Create the system tray icon
 */
export function createTray(): Tray {
  // Create a simple tray icon (would be replaced with actual icon)
  const iconPath = path.join(__dirname, '../../resources/icon.png');
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
  tray.setToolTip('PostureGuard');
  
  updateTrayMenu();

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
 */
export function updateTrayWithTick(tick: TimerTick): void {
  currentTick = tick;
  updateTrayMenu();
  updateTrayTooltip();
}

/**
 * Update tray tooltip
 * Format:
 * PostureGuard
 * Schedule: <name>
 * Phase: <phase>
 * Remaining: <time>
 * Focus Lock: <state>
 */
function updateTrayTooltip(): void {
  if (!tray || !currentTick) return;

  let tooltip = 'PostureGuard';
  
  if (currentTick.scheduleName) {
    const phaseName = PHASE_DISPLAY_NAMES[currentTick.currentPhase] || currentTick.currentPhase;
    const remaining = formatDuration(currentTick.phaseRemainingMs);
    
    tooltip = 'PostureGuard';
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
    tooltip = 'PostureGuard\nStatus: Idle';
  }

  tray.setToolTip(tooltip);
}

/**
 * Update tray context menu
 */
function updateTrayMenu(): void {
  if (!tray) return;

  const timerEngine = getTimerEngine();
  const menuItems: Electron.MenuItemConstructorOptions[] = [];

  // Status header
  if (currentTick?.scheduleName) {
    const phaseName = PHASE_DISPLAY_NAMES[currentTick.currentPhase] || currentTick.currentPhase;
    const remaining = formatDuration(currentTick.phaseRemainingMs);
    
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
    } else if (currentTick.isPostponed) {
      menuItems.push({ label: '⏳ Postponed', enabled: false });
    }
    
    menuItems.push({ type: 'separator' });

    // Pause/Resume
    if (currentTick.isPaused) {
      menuItems.push({
        label: 'Resume',
        click: () => timerEngine.resume(),
      });
    } else {
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
  } else {
    menuItems.push({
      label: 'Idle - No active schedule',
      enabled: false,
    });
    menuItems.push({ type: 'separator' });
  }

  // Office Focus Lock controls
  const officeFocusLockService = getOfficeFocusLockService();
  const lockState = officeFocusLockService.getState();
  
  if (lockState.isActive) {
    // Show active Office Focus Lock status and stop option
    const lockRemaining = formatDuration(lockState.remainingMs);
    menuItems.push({
      label: `🔒 Office Focus Lock (${lockState.label})`,
      enabled: false,
    });
    menuItems.push({
      label: `   Remaining: ${lockRemaining}`,
      enabled: false,
    });
    menuItems.push({
      label: 'Stop Office Focus Lock',
      click: () => officeFocusLockService.stop(),
    });
  } else {
    // Show Start Office Focus Lock submenu with labels
    menuItems.push({
      label: '🔒 Start Office Focus Lock',
      submenu: [
        // EPAM submenu
        {
          label: 'EPAM',
          submenu: OFFICE_FOCUS_LOCK_DURATIONS.map((minutes) => ({
            label: `${minutes} minutes`,
            click: () => officeFocusLockService.start('EPAM', minutes),
          })),
        },
        // Resy submenu
        {
          label: 'Resy',
          submenu: OFFICE_FOCUS_LOCK_DURATIONS.map((minutes) => ({
            label: `${minutes} minutes`,
            click: () => officeFocusLockService.start('Resy', minutes),
          })),
        },
        { type: 'separator' as const },
        {
          label: 'Custom...',
          click: () => {
            // For custom label/duration, open main window
            showMainWindow();
          },
        },
      ],
    });
  }

  menuItems.push({ type: 'separator' });

  // Dashboard and Settings
  menuItems.push({
    label: '📊 Open Dashboard',
    click: () => showMainWindow(),
  });

  menuItems.push({
    label: '⚙️ Settings',
    click: () => showMainWindow(),
  });

  menuItems.push({ type: 'separator' });

  // Quit
  menuItems.push({
    label: 'Quit PostureGuard',
    click: () => app.quit(),
  });

  const contextMenu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(contextMenu);
}

/**
 * Check if phase is a work phase
 */
function isWorkPhase(phase: PhaseType): boolean {
  return phase === 'sit' || phase === 'stand';
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
