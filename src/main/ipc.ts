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
import { showMainWindow, closeOverlay, showOverlay, hideMainWindow, onMainWindowHealthCheckResponse } from './windowManager';
import { getOverlayPolicy, OverlayPolicyInput } from '../core/overlayPolicy';
import { app } from 'electron';
import { getOverlaySyncService, OVERLAY_SYNC_CHANNELS } from '../core/overlaySync';
import { syncLoginItemWithSettings } from './autostart';
import { getOverlayWatchdog } from '../core/watchdog';
import logger from '../core/logger';

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
    // Apply autostart immediately when settings are saved
    const generalSettings = config?.generalSettings;
    if (generalSettings !== undefined) {
      syncLoginItemWithSettings(generalSettings.startOnLogin ?? false);
    }
    // Notify timer engine so idle detection and other features can re-init
    timerEngine.emit('configSaved');
  });

  ipcMain.handle(IPC_CHANNELS.GET_SCHEDULES, () => {
    return configService.getSchedules();
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_SCHEDULE, (_event, schedule) => {
    configService.saveSchedule(schedule);
    // Notify timer engine if this is the active schedule
    timerEngine.onScheduleUpdated(schedule);
  });

  ipcMain.handle(IPC_CHANNELS.DELETE_SCHEDULE, (_event, id) => {
    configService.deleteSchedule(id);
  });

  ipcMain.handle(IPC_CHANNELS.GET_SESSION_STATE, () => {
    return timerEngine.getState();
  });

  // Timer control handlers
  ipcMain.handle(IPC_CHANNELS.PAUSE, () => {
    const state = timerEngine.getState();
    timerEngine.pause();
    // Only close overlay during work phases (sit/stand) - user shouldn't be trapped
    // Keep overlay open during transitions/breaks so user sees the paused state
    const workPhases = ['sit', 'stand', 'idle'];
    if (workPhases.includes(state.currentPhase)) {
      closeOverlay();
    }
  });

  ipcMain.handle(IPC_CHANNELS.RESUME, () => {
    timerEngine.resume();
    // After resume, check if the current phase still needs an overlay
    // (e.g. if a break was paused mid-way, reopen the break overlay)
    const state = timerEngine.getState();
    const schedule = timerEngine.getCurrentSchedule();
    const officeFocusLockService = getOfficeFocusLockService();
    const currentFlowStep = schedule?.mode === 'flow-based' && schedule.flowSteps
      && state.currentFlowStepIndex !== undefined
      ? schedule.flowSteps[state.currentFlowStepIndex]
      : undefined;
    const input: OverlayPolicyInput = {
      phase: state.currentPhase,
      schedule,
      focusLockActive: officeFocusLockService.isActive(),
      focusLockState: officeFocusLockService.getState(),
      isPaused: false,
      isPostponed: state.isPostponed,
      isWaitingForNextActivity: state.isWaitingForNextActivity,
      currentFlowStep,
    };
    const policy = getOverlayPolicy(input);
    if (policy.showOverlay) {
      // Phase needs overlay — reopen it
      showOverlay(policy.strictMode);
    } else {
      // Phase does not need overlay — close any open one (pause reminder)
      closeOverlay();
    }
  });

  ipcMain.handle(IPC_CHANNELS.PAUSE_FOR_DURATION, (_event, minutes: number) => {
    timerEngine.pauseForDuration(minutes);
    // Close overlay when user pauses
    closeOverlay();
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
    return timerEngine.shuffleFlow();
  });

  ipcMain.handle(IPC_CHANNELS.REVERSE_FLOW, () => {
    return timerEngine.reverseFlow();
  });

  ipcMain.handle(IPC_CHANNELS.TRIGGER_PENDING_BREAK_NOW, () => {
    return timerEngine.triggerPendingBreakNow();
  });

  ipcMain.handle(IPC_CHANNELS.START_NEXT_ACTIVITY, () => {
    return timerEngine.startNextActivity();
  });

  ipcMain.handle(IPC_CHANNELS.RESTART_CURRENT_ACTIVITY, () => {
    return timerEngine.restartCurrentActivity();
  });

  ipcMain.handle(IPC_CHANNELS.EXTEND_BREAK, (_event, minutes: number) => {
    return timerEngine.extendBreak(minutes);
  });

  // Window control handlers
  ipcMain.handle(IPC_CHANNELS.OPEN_SETTINGS, () => {
    showMainWindow();
  });

  ipcMain.handle(IPC_CHANNELS.CLOSE_OVERLAY, () => {
    closeOverlay();
  });

  ipcMain.handle(IPC_CHANNELS.DISMISS_PAUSE_REMINDER, () => {
    closeOverlay();
  });

  ipcMain.handle(IPC_CHANNELS.DISMISS_WATER_REMINDER, () => {
    timerEngine.dismissWaterReminder();
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
  // Report to BOTH watchdog systems to keep them in sync
  ipcMain.on(OVERLAY_SYNC_CHANNELS.HEARTBEAT_RESPONSE, () => {
    logger.debug('IPC', '[OVERLAY_SYNC] heartbeat response received');
    getOverlaySyncService().onHeartbeatResponse();
    getOverlayWatchdog().reportHeartbeat();
  });

  ipcMain.on(OVERLAY_SYNC_CHANNELS.RESYNC_REQUEST, (event) => {
    logger.warn('IPC', '[OVERLAY_SYNC] resync requested by overlay renderer');
    getOverlaySyncService().requestResync();

    const latestTick = timerEngine.getLastEmittedTick();
    const restBlock = restBlockService.getState();

    const tick = latestTick
      ? { ...latestTick, restBlock }
      : null;

    event.sender.send(OVERLAY_SYNC_CHANNELS.RESYNC_DATA, {
      requestedAt: Date.now(),
      tick,
      restBlock,
      overlayStateVersion: restBlock.startedAt ?? Date.now(),
    });

    logger.info('IPC', '[OVERLAY_SYNC] resync data sent to overlay', {
      hasTick: !!tick,
      restBlockActive: restBlock.isActive,
      currentPhase: tick?.currentPhase,
      remainingMs: restBlock.remainingMs,
    });

    getOverlaySyncService().confirmResync();
  });

  // Main window health check response handler
  ipcMain.on('main-window:health-check-response', () => {
    onMainWindowHealthCheckResponse();
  });

  // Sound management
  ipcMain.handle(IPC_CHANNELS.GET_AVAILABLE_SOUNDS, () => {
    const { getSoundService } = require('../core/soundService');
    return getSoundService().getAvailableSounds();
  });

  ipcMain.handle(IPC_CHANNELS.PLAY_TEST_SOUND, (_event: any, filename: string, volume: number) => {
    const { getSoundService } = require('../core/soundService');
    return getSoundService().playTestSound(filename, volume);
  });

  // Dev mode: Clear all data (config + session)
  ipcMain.handle(IPC_CHANNELS.DEV_CLEAR_ALL_DATA, () => {
    if (process.env.NODE_ENV !== 'development') {
      return { success: false, message: 'Only available in dev mode' };
    }
    
    const { configStore, sessionSnapshot } = require('../core/configService');
    configStore.clear();
    sessionSnapshot.clearSnapshot();
    
    // Reset timer engine state
    timerEngine.resetSession();
    
    return { success: true, message: 'All data cleared. Restart app for full reset.' };
  });
}
