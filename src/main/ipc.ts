/**
 * RhythmDesk IPC Handlers
 * Handles communication between main and renderer processes
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/types';
import configService from '../core/configService';
import { getTimerEngine } from '../core/timerEngine';
import { getOfficeFocusLockService } from '../core/officeFocusLockService';
import { getRestBlockService } from '../core/restBlockService';
import { showMainWindow, closeOverlay, hideMainWindow } from './windowManager';
import { app } from 'electron';
import { getOverlaySyncService, OVERLAY_SYNC_CHANNELS } from '../core/overlaySync';

/**
 * Register all IPC handlers
 */
export function registerIpcHandlers(): void {
  const timerEngine = getTimerEngine();

  // Config handlers
  ipcMain.handle(IPC_CHANNELS.GET_CONFIG, () => {
    return configService.getConfig();
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_CONFIG, (_event, config) => {
    configService.saveConfig(config);
  });

  ipcMain.handle(IPC_CHANNELS.GET_SCHEDULES, () => {
    return configService.getSchedules();
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_SCHEDULE, (_event, schedule) => {
    configService.saveSchedule(schedule);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_SCHEDULE, (_event, id) => {
    configService.deleteSchedule(id);
  });

  ipcMain.handle(IPC_CHANNELS.GET_SESSION_STATE, () => {
    return timerEngine.getState();
  });

  // Timer control handlers
  ipcMain.handle(IPC_CHANNELS.PAUSE, () => {
    timerEngine.pause();
  });

  ipcMain.handle(IPC_CHANNELS.RESUME, () => {
    timerEngine.resume();
  });

  ipcMain.handle(IPC_CHANNELS.PAUSE_FOR_DURATION, (_event, minutes: number) => {
    timerEngine.pauseForDuration(minutes);
  });

  ipcMain.handle(IPC_CHANNELS.POSTPONE, (_event, minutes: number) => {
    return timerEngine.postpone(minutes);
  });

  ipcMain.handle(IPC_CHANNELS.SKIP_PHASE, () => {
    timerEngine.skipPhase();
  });

  ipcMain.handle(IPC_CHANNELS.COMPLETE_PHASE, () => {
    timerEngine.completePhase();
  });

  ipcMain.handle(IPC_CHANNELS.RESET_SESSION, () => {
    timerEngine.resetSession();
  });

  ipcMain.handle(IPC_CHANNELS.RESET_TODAY_COUNTERS, () => {
    timerEngine.resetTodayCounters();
  });

  ipcMain.handle(IPC_CHANNELS.SHUFFLE_FLOW, () => {
    timerEngine.shuffleFlow();
  });

  ipcMain.handle(IPC_CHANNELS.REVERSE_FLOW, () => {
    timerEngine.reverseFlow();
  });

  // Window control handlers
  ipcMain.handle(IPC_CHANNELS.OPEN_SETTINGS, () => {
    showMainWindow();
  });

  ipcMain.handle(IPC_CHANNELS.CLOSE_OVERLAY, () => {
    closeOverlay();
  });

  ipcMain.handle(IPC_CHANNELS.MINIMIZE_TO_TRAY, () => {
    hideMainWindow();
  });

  ipcMain.handle(IPC_CHANNELS.QUIT_APP, () => {
    app.quit();
  });

  // Office Focus Lock handlers
  const officeFocusLockService = getOfficeFocusLockService();

  ipcMain.handle(IPC_CHANNELS.START_OFFICE_FOCUS_LOCK, (_event, label: string, durationMinutes: number, isStrictMode: boolean = false) => {
    officeFocusLockService.start(label, durationMinutes, isStrictMode);
    return officeFocusLockService.getState();
  });

  ipcMain.handle(IPC_CHANNELS.STOP_OFFICE_FOCUS_LOCK, () => {
    officeFocusLockService.stop();
    return officeFocusLockService.getState();
  });

  ipcMain.handle(IPC_CHANNELS.GET_OFFICE_FOCUS_LOCK_STATE, () => {
    return officeFocusLockService.getState();
  });

  // Rest Block handlers
  const restBlockService = getRestBlockService();

  ipcMain.handle(IPC_CHANNELS.START_REST_BLOCK, (_event, name: string, durationMinutes: number, isStrictMode: boolean = false, presetId: string | null = null) => {
    restBlockService.start(name, durationMinutes, isStrictMode, presetId);
    return restBlockService.getState();
  });

  ipcMain.handle(IPC_CHANNELS.STOP_REST_BLOCK, () => {
    const stopped = restBlockService.stop();
    return { stopped, state: restBlockService.getState() };
  });

  ipcMain.handle(IPC_CHANNELS.GET_REST_BLOCK_STATE, () => {
    return restBlockService.getState();
  });

  ipcMain.handle(IPC_CHANNELS.GET_REST_BLOCK_PRESETS, () => {
    return restBlockService.getPresets();
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_REST_BLOCK_PRESET, (_event, preset) => {
    restBlockService.savePreset(preset);
    return restBlockService.getPresets();
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_REST_BLOCK_PRESET, (_event, presetId: string) => {
    const deleted = restBlockService.deletePreset(presetId);
    return { deleted, presets: restBlockService.getPresets() };
  });

  // Phase 2: Overlay sync heartbeat handler
  ipcMain.on(OVERLAY_SYNC_CHANNELS.HEARTBEAT_RESPONSE, () => {
    getOverlaySyncService().onHeartbeatResponse();
  });
}
