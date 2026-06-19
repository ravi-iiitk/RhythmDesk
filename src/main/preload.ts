/**
 * RhythmDesk Preload Script
 * Exposes safe IPC methods to renderer process
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/types';
import { OVERLAY_SYNC_CHANNELS } from '../core/overlaySync';

// Type for the exposed API
export interface RhythmDeskAPI {
  // Config
  getConfig: () => Promise<any>;
  saveConfig: (config: any) => Promise<void>;
  getSchedules: () => Promise<any[]>;
  saveSchedule: (schedule: any) => Promise<void>;
  deleteSchedule: (id: string) => Promise<void>;
  getSessionState: () => Promise<any>;
  
  // Timer controls
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  pauseForDuration: (minutes: number) => Promise<void>;
  postpone: (minutes: number) => Promise<boolean>;
  skipPhase: () => Promise<void>;
  completePhase: () => Promise<void>;
  resetSession: () => Promise<void>;
  resetTodayCounters: () => Promise<void>;
  shuffleFlow: () => Promise<void>;
  reverseFlow: () => Promise<void>;
  triggerPendingBreakNow: () => Promise<boolean>;
  startNextActivity: () => Promise<boolean>;
  restartCurrentActivity: () => Promise<boolean>;
  extendBreak: (minutes: number) => Promise<boolean>;
  preponePhase: (minutes: number) => Promise<boolean>;
  resetPhaseDuration: () => Promise<boolean>;
  startAdHocBreak: (durationMinutes: number) => Promise<boolean>;
  
  // Office Focus Lock controls
  startOfficeFocusLock: (label: string, durationMinutes: number, isStrictMode?: boolean) => Promise<any>;
  stopOfficeFocusLock: () => Promise<any>;
  getOfficeFocusLockState: () => Promise<any>;
  
  // Rest Block controls
  startRestBlock: (name: string, durationMinutes: number, isStrictMode?: boolean, presetId?: string | null) => Promise<any>;
  stopRestBlock: () => Promise<{ stopped: boolean; state: any }>;
  getRestBlockState: () => Promise<any>;
  getRestBlockPresets: () => Promise<any[]>;
  saveRestBlockPreset: (preset: any) => Promise<any[]>;
  deleteRestBlockPreset: (presetId: string) => Promise<{ deleted: boolean; presets: any[] }>;
  
  // Window controls
  openSettings: () => Promise<void>;
  closeOverlay: () => Promise<void>;
  minimizeToTray: () => Promise<void>;
  quitApp: () => Promise<void>;
  
  // Sound management
  getAvailableSounds: () => Promise<string[]>;
  playTestSound: (filename: string, volume: number) => Promise<void>;
  
  // Voice commands
  voiceTranscribe: (audioBuffer: ArrayBuffer) => Promise<{ success: boolean; text: string; error: string | null }>;
  voiceTranscribeLocal: (audioBuffer: ArrayBuffer) => Promise<{ success: boolean; text: string; error: string | null }>;
  
  // Dev mode only
  devClearAllData: () => Promise<{ success: boolean; message: string }>;
  
  // Pause reminder
  dismissPauseReminder: () => Promise<void>;
  
  // Water reminder
  dismissWaterReminder: () => Promise<void>;
  
  // Event listeners
  onTimerTick: (callback: (tick: any) => void) => () => void;
  onPhaseChange: (callback: (data: any) => void) => () => void;
  onShowOverlay: (callback: (data: any) => void) => () => void;
  onHideOverlay: (callback: () => void) => () => void;
  onConfigUpdated: (callback: (config: any) => void) => () => void;
  onOfficeFocusLockChanged: (callback: (state: any) => void) => () => void;
  onRestBlockChanged: (callback: (state: any) => void) => () => void;
  onShowPauseReminder: (callback: (data: any) => void) => () => void;
  onShowWaterReminder: (callback: (data: any) => void) => () => void;
  
  // Phase 2: Overlay sync (heartbeat)
  sendHeartbeatResponse: () => void;
  onHeartbeatRequest: (callback: () => void) => () => void;
  requestOverlayResync: () => void;
  onOverlayResyncData: (callback: (data: any) => void) => () => void;
  
  // Main window health check
  onHealthCheck: (callback: () => void) => () => void;
  sendHealthCheckResponse: () => void;
}

const api: RhythmDeskAPI = {
  // Config operations
  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CONFIG),
  saveConfig: (config) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_CONFIG, config),
  getSchedules: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SCHEDULES),
  saveSchedule: (schedule) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_SCHEDULE, schedule),
  deleteSchedule: (id) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_SCHEDULE, id),
  getSessionState: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SESSION_STATE),

  // Timer controls
  pause: () => ipcRenderer.invoke(IPC_CHANNELS.PAUSE),
  resume: () => ipcRenderer.invoke(IPC_CHANNELS.RESUME),
  pauseForDuration: (minutes) => ipcRenderer.invoke(IPC_CHANNELS.PAUSE_FOR_DURATION, minutes),
  postpone: (minutes) => ipcRenderer.invoke(IPC_CHANNELS.POSTPONE, minutes),
  skipPhase: () => ipcRenderer.invoke(IPC_CHANNELS.SKIP_PHASE),
  completePhase: () => ipcRenderer.invoke(IPC_CHANNELS.COMPLETE_PHASE),
  resetSession: () => ipcRenderer.invoke(IPC_CHANNELS.RESET_SESSION),
  resetTodayCounters: () => ipcRenderer.invoke(IPC_CHANNELS.RESET_TODAY_COUNTERS),
  shuffleFlow: () => ipcRenderer.invoke(IPC_CHANNELS.SHUFFLE_FLOW),
  reverseFlow: () => ipcRenderer.invoke(IPC_CHANNELS.REVERSE_FLOW),
  triggerPendingBreakNow: () => ipcRenderer.invoke(IPC_CHANNELS.TRIGGER_PENDING_BREAK_NOW),
  startNextActivity: () => ipcRenderer.invoke(IPC_CHANNELS.START_NEXT_ACTIVITY),
  restartCurrentActivity: () => ipcRenderer.invoke(IPC_CHANNELS.RESTART_CURRENT_ACTIVITY),
  extendBreak: (minutes) => ipcRenderer.invoke(IPC_CHANNELS.EXTEND_BREAK, minutes),
  preponePhase: (minutes) => ipcRenderer.invoke(IPC_CHANNELS.PREPONE_PHASE, minutes),
  resetPhaseDuration: () => ipcRenderer.invoke(IPC_CHANNELS.RESET_PHASE_DURATION),
  startAdHocBreak: (durationMinutes) => ipcRenderer.invoke(IPC_CHANNELS.START_AD_HOC_BREAK, durationMinutes),

  // Office Focus Lock controls
  startOfficeFocusLock: (label, durationMinutes, isStrictMode = false) => ipcRenderer.invoke(IPC_CHANNELS.START_OFFICE_FOCUS_LOCK, label, durationMinutes, isStrictMode),
  stopOfficeFocusLock: () => ipcRenderer.invoke(IPC_CHANNELS.STOP_OFFICE_FOCUS_LOCK),
  getOfficeFocusLockState: () => ipcRenderer.invoke(IPC_CHANNELS.GET_OFFICE_FOCUS_LOCK_STATE),

  // Rest Block controls
  startRestBlock: (name, durationMinutes, isStrictMode = false, presetId = null) => ipcRenderer.invoke(IPC_CHANNELS.START_REST_BLOCK, name, durationMinutes, isStrictMode, presetId),
  stopRestBlock: () => ipcRenderer.invoke(IPC_CHANNELS.STOP_REST_BLOCK),
  getRestBlockState: () => ipcRenderer.invoke(IPC_CHANNELS.GET_REST_BLOCK_STATE),
  getRestBlockPresets: () => ipcRenderer.invoke(IPC_CHANNELS.GET_REST_BLOCK_PRESETS),
  saveRestBlockPreset: (preset) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_REST_BLOCK_PRESET, preset),
  deleteRestBlockPreset: (presetId) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_REST_BLOCK_PRESET, presetId),

  // Pause reminder
  dismissPauseReminder: () => ipcRenderer.invoke(IPC_CHANNELS.DISMISS_PAUSE_REMINDER),

  // Water reminder
  dismissWaterReminder: () => ipcRenderer.invoke(IPC_CHANNELS.DISMISS_WATER_REMINDER),

  // Window controls
  openSettings: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_SETTINGS),
  closeOverlay: () => ipcRenderer.invoke(IPC_CHANNELS.CLOSE_OVERLAY),
  minimizeToTray: () => ipcRenderer.invoke(IPC_CHANNELS.MINIMIZE_TO_TRAY),
  quitApp: () => ipcRenderer.invoke(IPC_CHANNELS.QUIT_APP),

  // Sound management
  getAvailableSounds: () => ipcRenderer.invoke(IPC_CHANNELS.GET_AVAILABLE_SOUNDS),
  playTestSound: (filename, volume) => ipcRenderer.invoke(IPC_CHANNELS.PLAY_TEST_SOUND, filename, volume),

  // Voice commands
  voiceTranscribe: (audioBuffer) => ipcRenderer.invoke(IPC_CHANNELS.VOICE_TRANSCRIBE, audioBuffer),
  voiceTranscribeLocal: (audioBuffer) => ipcRenderer.invoke(IPC_CHANNELS.VOICE_TRANSCRIBE_LOCAL, audioBuffer),

  // Dev mode only
  devClearAllData: () => ipcRenderer.invoke(IPC_CHANNELS.DEV_CLEAR_ALL_DATA),

  // Event listeners with cleanup
  onTimerTick: (callback) => {
    const handler = (_event: any, tick: any) => callback(tick);
    ipcRenderer.on(IPC_CHANNELS.TIMER_TICK, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TIMER_TICK, handler);
  },

  onPhaseChange: (callback) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.PHASE_CHANGE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PHASE_CHANGE, handler);
  },

  onShowOverlay: (callback) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.SHOW_OVERLAY, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SHOW_OVERLAY, handler);
  },

  onHideOverlay: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IPC_CHANNELS.HIDE_OVERLAY, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.HIDE_OVERLAY, handler);
  },

  onConfigUpdated: (callback) => {
    const handler = (_event: any, config: any) => callback(config);
    ipcRenderer.on(IPC_CHANNELS.CONFIG_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CONFIG_UPDATED, handler);
  },

  onOfficeFocusLockChanged: (callback) => {
    const handler = (_event: any, state: any) => callback(state);
    ipcRenderer.on(IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.OFFICE_FOCUS_LOCK_CHANGED, handler);
  },

  onRestBlockChanged: (callback) => {
    const handler = (_event: any, state: any) => callback(state);
    ipcRenderer.on(IPC_CHANNELS.REST_BLOCK_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.REST_BLOCK_CHANGED, handler);
  },

  onShowPauseReminder: (callback) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.SHOW_PAUSE_REMINDER, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SHOW_PAUSE_REMINDER, handler);
  },

  onShowWaterReminder: (callback) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.SHOW_WATER_REMINDER, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SHOW_WATER_REMINDER, handler);
  },

  // Phase 2: Overlay sync (heartbeat)
  sendHeartbeatResponse: () => {
    ipcRenderer.send(OVERLAY_SYNC_CHANNELS.HEARTBEAT_RESPONSE);
  },
  
  onHeartbeatRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(OVERLAY_SYNC_CHANNELS.HEARTBEAT_REQUEST, handler);
    return () => ipcRenderer.removeListener(OVERLAY_SYNC_CHANNELS.HEARTBEAT_REQUEST, handler);
  },

  requestOverlayResync: () => {
    ipcRenderer.send(OVERLAY_SYNC_CHANNELS.RESYNC_REQUEST);
  },

  onOverlayResyncData: (callback) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(OVERLAY_SYNC_CHANNELS.RESYNC_DATA, handler);
    return () => ipcRenderer.removeListener(OVERLAY_SYNC_CHANNELS.RESYNC_DATA, handler);
  },

  // Main window health check
  onHealthCheck: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('main-window:health-check', handler);
    return () => ipcRenderer.removeListener('main-window:health-check', handler);
  },

  sendHealthCheckResponse: () => {
    ipcRenderer.send('main-window:health-check-response');
  },
};

contextBridge.exposeInMainWorld('rhythmDesk', api);

// Type declaration for window object
declare global {
  interface Window {
    rhythmDesk: RhythmDeskAPI;
  }
}
