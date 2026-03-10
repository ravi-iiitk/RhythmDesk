/**
 * RhythmDesk Preload Script
 * Exposes safe IPC methods to renderer process
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/types';

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
  
  // Office Focus Lock controls
  startOfficeFocusLock: (label: string, durationMinutes: number) => Promise<any>;
  stopOfficeFocusLock: () => Promise<any>;
  getOfficeFocusLockState: () => Promise<any>;
  
  // Window controls
  openSettings: () => Promise<void>;
  closeOverlay: () => Promise<void>;
  minimizeToTray: () => Promise<void>;
  quitApp: () => Promise<void>;
  
  // Event listeners
  onTimerTick: (callback: (tick: any) => void) => () => void;
  onPhaseChange: (callback: (data: any) => void) => () => void;
  onShowOverlay: (callback: (data: any) => void) => () => void;
  onHideOverlay: (callback: () => void) => () => void;
  onConfigUpdated: (callback: (config: any) => void) => () => void;
  onOfficeFocusLockChanged: (callback: (state: any) => void) => () => void;
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

  // Office Focus Lock controls
  startOfficeFocusLock: (label, durationMinutes) => ipcRenderer.invoke(IPC_CHANNELS.START_OFFICE_FOCUS_LOCK, label, durationMinutes),
  stopOfficeFocusLock: () => ipcRenderer.invoke(IPC_CHANNELS.STOP_OFFICE_FOCUS_LOCK),
  getOfficeFocusLockState: () => ipcRenderer.invoke(IPC_CHANNELS.GET_OFFICE_FOCUS_LOCK_STATE),

  // Window controls
  openSettings: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_SETTINGS),
  closeOverlay: () => ipcRenderer.invoke(IPC_CHANNELS.CLOSE_OVERLAY),
  minimizeToTray: () => ipcRenderer.invoke(IPC_CHANNELS.MINIMIZE_TO_TRAY),
  quitApp: () => ipcRenderer.invoke(IPC_CHANNELS.QUIT_APP),

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
};

contextBridge.exposeInMainWorld('rhythmDesk', api);

// Type declaration for window object
declare global {
  interface Window {
    rhythmDesk: RhythmDeskAPI;
  }
}
