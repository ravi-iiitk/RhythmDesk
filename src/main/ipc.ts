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
import { getOverlayPolicy, OverlayPolicyInput, isBreakOrTransitionPhase } from '../core/overlayPolicy';
import { isFocusLockdownActive } from './focusLockdown';
import { getFocusSessionService } from '../core/focusSessionService';
import { app } from 'electron';
import { getOverlaySyncService, OVERLAY_SYNC_CHANNELS } from '../core/overlaySync';
import { syncLoginItemWithSettings } from './autostart';
import { getOverlayWatchdog } from '../core/watchdog';
import logger from '../core/logger';
import { clearPauseReminderFlag, isPauseReminderShowing } from './pauseReminderState';
import {
  getActivityLogEntries,
  clearActivityLog,
  pruneActivityLog,
  logSessionPaused,
  logSessionResumed,
  logBreakPostponed,
  logBreakSkipped,
  logFlowShuffled,
  logFlowReversed,
  logFlowOrderApplied,
} from '../core/activityLogService';

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
    if (isFocusLockdownActive()) {
      logger.warn('IPC', 'PAUSE blocked — focus session is active');
      return;
    }
    const state = timerEngine.getState();
    timerEngine.pause();
    logSessionPaused(state.currentPhase, (timerEngine as any).currentSchedule?.name);
    // Only close overlay during work/idle phases — keep it open for breaks, transitions,
    // and custom steps with showOverlay so the user sees the paused state on the overlay.
    const schedule = timerEngine.getCurrentSchedule();
    const currentFlowStep = schedule?.mode === 'flow-based' && schedule.flowSteps
      && state.currentFlowStepIndex !== undefined
      ? schedule.flowSteps[state.currentFlowStepIndex]
      : undefined;
    if (!isBreakOrTransitionPhase(state.currentPhase, currentFlowStep)) {
      closeOverlay();
    }
  });

  ipcMain.handle(IPC_CHANNELS.RESUME, () => {
    const preResumeState = timerEngine.getState();
    const pausedForMs = preResumeState.pausedAt ? Date.now() - preResumeState.pausedAt : undefined;
    timerEngine.resume();
    logSessionResumed(pausedForMs, (timerEngine as any).currentSchedule?.name);
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
    // Always clear pause reminder flag on resume to prevent stale overlays
    clearPauseReminderFlag();
  });

  ipcMain.handle(IPC_CHANNELS.PAUSE_FOR_DURATION, (_event, minutes: number) => {
    timerEngine.pauseForDuration(minutes);
    // Close overlay when user pauses
    closeOverlay();
  });

  ipcMain.handle(IPC_CHANNELS.POSTPONE, (_event, minutes: number) => {
    const state = timerEngine.getState();
    const result = timerEngine.postpone(minutes);
    if (result) {
      logBreakPostponed(minutes, state.currentPhase, (timerEngine as any).currentSchedule?.name);
    }
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.SKIP_PHASE, () => {
    const state = timerEngine.getState();
    timerEngine.skipPhase();
    logBreakSkipped(state.currentPhase, (timerEngine as any).currentSchedule?.name);
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
    const result = timerEngine.shuffleFlow();
    logFlowShuffled(undefined, (timerEngine as any).currentSchedule?.name);
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.REVERSE_FLOW, () => {
    const result = timerEngine.reverseFlow();
    logFlowReversed(undefined, (timerEngine as any).currentSchedule?.name);
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.APPLY_FLOW_ORDER, () => {
    timerEngine.applyFlowOrder();
    logFlowOrderApplied((timerEngine as any).currentSchedule?.name);
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

  ipcMain.handle(IPC_CHANNELS.PREPONE_PHASE, (_event, minutes: number) => {
    return timerEngine.preponePhase(minutes);
  });

  ipcMain.handle(IPC_CHANNELS.RESET_PHASE_DURATION, () => {
    return timerEngine.resetPhaseDuration();
  });

  ipcMain.handle(IPC_CHANNELS.START_AD_HOC_BREAK, (_event, durationMinutes: number) => {
    return timerEngine.startAdHocBreak(durationMinutes);
  });

  // Window control handlers
  ipcMain.handle(IPC_CHANNELS.OPEN_SETTINGS, () => {
    showMainWindow();
  });

  ipcMain.handle(IPC_CHANNELS.CLOSE_OVERLAY, () => {
    const syncService = getOverlaySyncService();
    if (syncService.getState().isOverlayActive) {
      syncService.stop();
    }
    closeOverlay();
    clearPauseReminderFlag();
  });

  ipcMain.handle(IPC_CHANNELS.DISMISS_PAUSE_REMINDER, () => {
    const syncService = getOverlaySyncService();
    if (syncService.getState().isOverlayActive) {
      syncService.stop();
    }
    closeOverlay();
    clearPauseReminderFlag();
  });

  ipcMain.handle(IPC_CHANNELS.DISMISS_WATER_REMINDER, () => {
    timerEngine.dismissWaterReminder();
    // Don't close overlay if pause reminder is still showing
    if (!isPauseReminderShowing()) {
      closeOverlay();
    }
  });

  ipcMain.handle(IPC_CHANNELS.MINIMIZE_TO_TRAY, () => {
    if (isFocusLockdownActive()) {
      logger.warn('IPC', 'MINIMIZE_TO_TRAY blocked — focus session is active');
      return;
    }
    hideMainWindow();
  });

  ipcMain.handle(IPC_CHANNELS.QUIT_APP, () => {
    if (isFocusLockdownActive()) {
      logger.warn('IPC', 'QUIT_APP blocked — focus session is active');
      return; // silently reject
    }
    app.quit();
  });

  ipcMain.handle(IPC_CHANNELS.GET_FOCUS_SESSION_STATE, () => {
    const svc = getFocusSessionService();
    return {
      isActive: svc.isActive(),
      activeSession: svc.getActiveSession(),
      timeUntilEndMs: svc.getTimeUntilEndMs(),
    };
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

  // Activity Log handlers
  ipcMain.handle(IPC_CHANNELS.GET_ACTIVITY_LOG, (_event, fromTimestamp?: number, toTimestamp?: number) => {
    // Prune old entries on each fetch based on retention setting
    const config = configService.getConfig();
    const retentionDays = config?.generalSettings?.logRetentionDays ?? 30;
    pruneActivityLog(retentionDays);
    return getActivityLogEntries(fromTimestamp, toTimestamp);
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_ACTIVITY_LOG, () => {
    clearActivityLog();
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
    const state = timerEngine.getState();

    const tick = latestTick
      ? { ...latestTick, restBlock }
      : null;

    // Include pause reminder data so renderer doesn't race-close the overlay
    const pauseReminder = (state.isPaused && isPauseReminderShowing() && state.pausedAt)
      ? { pausedForMs: Date.now() - state.pausedAt, pausedAt: state.pausedAt }
      : null;

    event.sender.send(OVERLAY_SYNC_CHANNELS.RESYNC_DATA, {
      requestedAt: Date.now(),
      tick,
      restBlock,
      overlayStateVersion: restBlock.startedAt ?? Date.now(),
      pauseReminder,
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

  // Voice commands: Transcribe audio via OpenAI Whisper API
  ipcMain.handle(IPC_CHANNELS.VOICE_TRANSCRIBE, async (_event, audioBuffer: ArrayBuffer) => {
    const settings = configService.getGeneralSettings();
    const apiKey = settings.openaiApiKey;
    if (!apiKey) {
      return { success: false, text: '', error: 'No OpenAI API key configured. Add it in Settings.' };
    }

    try {
      // Build multipart form data manually (no external deps)
      const boundary = '----RhythmDeskVoice' + Date.now();
      const wavBuffer = Buffer.from(audioBuffer);

      const formParts: Buffer[] = [];
      // file field
      formParts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.wav"\r\nContent-Type: audio/wav\r\n\r\n`
      ));
      formParts.push(wavBuffer);
      formParts.push(Buffer.from('\r\n'));
      // model field
      formParts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
      ));
      // language field (optimize for English)
      formParts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n`
      ));
      // prompt field (helps Whisper understand context)
      formParts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nRhythmDesk voice command: pause, resume, break, skip, extend, reduce, shuffle, reverse, reset, time left\r\n`
      ));
      formParts.push(Buffer.from(`--${boundary}--\r\n`));

      const body = Buffer.concat(formParts);

      const { net } = require('electron');
      const response = await net.fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.warn('Voice', 'Whisper API error', { status: response.status, error: errText });
        if (response.status === 401) {
          return { success: false, text: '', error: 'Invalid API key. Check Settings.' };
        }
        return { success: false, text: '', error: `API error: ${response.status}` };
      }

      const result = await response.json();
      const text = (result.text || '').trim();
      logger.info('Voice', 'Transcription result', { text });
      return { success: true, text, error: null };
    } catch (err: any) {
      logger.error('Voice', 'Transcription failed', { error: err.message });
      return { success: false, text: '', error: `Failed: ${err.message}` };
    }
  });

  // Voice commands: Local transcription via whisper.cpp CLI binary
  ipcMain.handle(IPC_CHANNELS.VOICE_TRANSCRIBE_LOCAL, async (_event, audioBuffer: ArrayBuffer) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const { execFile } = require('child_process');

      // Write WAV buffer to temp file
      const tmpDir = os.tmpdir();
      const tmpFile = path.join(tmpDir, `rhythmdesk-voice-${Date.now()}.wav`);
      fs.writeFileSync(tmpFile, Buffer.from(audioBuffer));

      // Find resources directory
      const resourcesDir = app.isPackaged
        ? path.join(process.resourcesPath, 'resources')
        : path.join(app.getAppPath(), 'resources');

      // Find model file
      const modelPath = path.join(resourcesDir, 'models', 'ggml-base.en.bin');
      if (!fs.existsSync(modelPath)) {
        return { success: false, text: '', error: 'Whisper model not found. Download ggml-base.en.bin to resources/models/' };
      }

      // Find whisper-cli binary
      const binDir = path.join(resourcesDir, 'bin');
      const whisperBin = path.join(binDir, 'whisper-cli');
      if (!fs.existsSync(whisperBin)) {
        return { success: false, text: '', error: 'whisper-cli binary not found in resources/bin/' };
      }

      // Run whisper-cli with LD_LIBRARY_PATH set to find shared libs
      const text = await new Promise<string>((resolve, reject) => {
        const args = [
          '-m', modelPath,
          '-f', tmpFile,
          '-l', 'en',
          '--no-timestamps',
        ];
        const env = { ...process.env, LD_LIBRARY_PATH: binDir };
        execFile(whisperBin, args, { env, timeout: 30000 }, (err: any, stdout: string, stderr: string) => {
          if (err) {
            reject(new Error(stderr || err.message));
          } else {
            resolve(stdout);
          }
        });
      });

      // Clean up temp file
      try { fs.unlinkSync(tmpFile); } catch (_e) { /* ignore */ }

      // Parse output - whisper-cli outputs text lines (may have leading whitespace)
      const cleanText = text
        .split('\n')
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0 && !line.startsWith('['))
        .join(' ')
        .trim();

      logger.info('Voice', 'Local transcription result', { text: cleanText });
      return { success: true, text: cleanText, error: null };
    } catch (err: any) {
      logger.error('Voice', 'Local transcription failed', { error: err.message });
      return { success: false, text: '', error: `Local transcription failed: ${err.message}` };
    }
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
