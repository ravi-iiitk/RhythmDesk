/**
 * RhythmDesk Sound Service
 * 
 * Plays different sounds for different events.
 * Supports custom sound files and system notification sounds.
 */

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import logger from './logger';
import configService from './configService';

// ============================================================
// SOUND EVENT TYPES
// ============================================================

export type SoundEvent =
  | 'break_start'           // Short/long break starting
  | 'break_end'             // Break ending, work resuming
  | 'transition_start'      // Sit-to-stand or stand-to-sit transition
  | 'phase_warning'         // Warning before phase ends (e.g., 1 min left)
  | 'session_start'         // Session/schedule started
  | 'session_reset'         // Session reset
  | 'postpone'              // Break postponed
  | 'focus_lock_start'      // Office Focus Lock started
  | 'focus_lock_end'        // Office Focus Lock ended
  | 'rest_block_start'      // Custom rest block started
  | 'rest_block_end';       // Custom rest block ended

// ============================================================
// SOUND CONFIGURATION
// ============================================================

export interface SoundConfig {
  enabled: boolean;
  volume: number; // 0-100
  sounds: {
    [key in SoundEvent]: {
      enabled: boolean;
      file: string; // Filename or 'default' or 'none'
    };
  };
}

export const DEFAULT_SOUND_CONFIG: SoundConfig = {
  enabled: true,
  volume: 50,
  sounds: {
    break_start: { enabled: true, file: 'chime.wav' },
    break_end: { enabled: true, file: 'bell.wav' },
    transition_start: { enabled: true, file: 'ding.wav' },
    phase_warning: { enabled: true, file: 'tick.wav' },
    session_start: { enabled: true, file: 'start.wav' },
    session_reset: { enabled: true, file: 'reset.wav' },
    postpone: { enabled: true, file: 'swoosh.wav' },
    focus_lock_start: { enabled: true, file: 'lock.wav' },
    focus_lock_end: { enabled: true, file: 'unlock.wav' },
    rest_block_start: { enabled: true, file: 'rest.wav' },
    rest_block_end: { enabled: true, file: 'bell.wav' },
  },
};

// Human-readable names for UI
export const SOUND_EVENT_NAMES: Record<SoundEvent, string> = {
  break_start: 'Break Starting',
  break_end: 'Break Ending',
  transition_start: 'Transition Starting',
  phase_warning: 'Phase Warning (1 min)',
  session_start: 'Session Started',
  session_reset: 'Session Reset',
  postpone: 'Break Postponed',
  focus_lock_start: 'Focus Lock Started',
  focus_lock_end: 'Focus Lock Ended',
  rest_block_start: 'Rest Block Started',
  rest_block_end: 'Rest Block Ended',
};

// ============================================================
// SOUND SERVICE
// ============================================================

class SoundService {
  private static instance: SoundService;
  private soundsDir: string;
  private isInitialized: boolean = false;

  private constructor() {
    // Determine sounds directory based on packaged vs dev
    if (app.isPackaged) {
      this.soundsDir = path.join(process.resourcesPath, 'resources/sounds');
    } else {
      // In dev mode, app.getAppPath() points to project root reliably
      this.soundsDir = path.join(app.getAppPath(), 'resources/sounds');
    }
  }

  static getInstance(): SoundService {
    if (!SoundService.instance) {
      SoundService.instance = new SoundService();
    }
    return SoundService.instance;
  }

  /**
   * Initialize the sound service
   */
  initialize(): void {
    if (this.isInitialized) return;
    
    // Ensure sounds directory exists
    this.ensureSoundsDirectory();
    
    this.isInitialized = true;
    logger.info('SoundService', 'Initialized', { soundsDir: this.soundsDir });
  }

  /**
   * Ensure sounds directory exists and has default sounds
   */
  private ensureSoundsDirectory(): void {
    try {
      if (!fs.existsSync(this.soundsDir)) {
        fs.mkdirSync(this.soundsDir, { recursive: true });
        logger.info('SoundService', 'Created sounds directory');
      }
    } catch (error) {
      logger.warn('SoundService', 'Could not create sounds directory', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get path to a sound file
   */
  private getSoundPath(filename: string): string {
    return path.join(this.soundsDir, filename);
  }

  /**
   * Check if a sound file exists
   */
  soundExists(filename: string): boolean {
    if (filename === 'none' || filename === 'default') return true;
    return fs.existsSync(this.getSoundPath(filename));
  }

  /**
   * Get list of available sound files
   */
  getAvailableSounds(): string[] {
    try {
      if (!fs.existsSync(this.soundsDir)) {
        return ['none'];
      }
      const files = fs.readdirSync(this.soundsDir)
        .filter(f => f.endsWith('.wav') || f.endsWith('.mp3') || f.endsWith('.ogg'));
      return ['none', ...files];
    } catch {
      return ['none'];
    }
  }

  /**
   * Play a sound for a specific event
   */
  async playSound(event: SoundEvent): Promise<void> {
    const settings = configService.getGeneralSettings();
    
    // Check if sounds are globally enabled
    if (!settings.soundEnabled) {
      return;
    }

    // Get sound config (use defaults if not configured)
    const soundConfig = (settings as any).soundConfig as SoundConfig | undefined;
    const eventConfig = soundConfig?.sounds?.[event] ?? DEFAULT_SOUND_CONFIG.sounds[event];
    
    // Check if this specific sound is enabled
    if (!eventConfig.enabled || eventConfig.file === 'none') {
      return;
    }

    const volume = (soundConfig?.volume ?? settings.soundVolume ?? 50) / 100;
    
    try {
      await this.playSoundFile(eventConfig.file, volume);
      logger.debug('SoundService', `Played sound for ${event}`, { file: eventConfig.file });
    } catch (error) {
      logger.warn('SoundService', `Failed to play sound for ${event}`, {
        file: eventConfig.file,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Play a specific sound file
   */
  private async playSoundFile(filename: string, volume: number): Promise<void> {
    if (filename === 'none') return;
    
    const soundPath = this.getSoundPath(filename);
    
    // Check if file exists
    if (!fs.existsSync(soundPath)) {
      // Try to use system beep as fallback
      await this.playSystemBeep();
      return;
    }

    // Use shell command to play sound (cross-platform approach for Electron main process)
    const { exec } = require('child_process');
    
    // Linux: try pw-play (PipeWire), then paplay (PulseAudio), then aplay (ALSA)
    const paVolume = Math.floor(volume * 65536);
    const command = `pw-play --volume=${volume.toFixed(2)} "${soundPath}" 2>/dev/null || paplay "${soundPath}" --volume=${paVolume} 2>/dev/null || aplay "${soundPath}" 2>/dev/null`;
    
    exec(command, (error: Error | null) => {
      if (error) {
        logger.debug('SoundService', 'Sound playback command failed, trying fallback', {
          error: error.message,
        });
        // Fallback to system beep
        this.playSystemBeep();
      }
    });
  }

  /**
   * Play system beep as fallback
   */
  private async playSystemBeep(): Promise<void> {
    const { shell } = require('electron');
    shell.beep();
  }

  /**
   * Play a test sound
   */
  async playTestSound(filename: string, volume: number = 50): Promise<void> {
    await this.playSoundFile(filename, volume / 100);
  }
}

// ============================================================
// EXPORTS
// ============================================================

export const soundService = SoundService.getInstance();

/**
 * Convenience function to play a sound event
 */
export function playSound(event: SoundEvent): void {
  soundService.playSound(event).catch(() => {
    // Ignore errors - sound is non-critical
  });
}

/**
 * Get the sound service instance
 */
export function getSoundService(): SoundService {
  return soundService;
}
