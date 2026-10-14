/**
 * RhythmDesk System Idle Detector
 * 
 * Monitors system idle time using Electron's powerMonitor API.
 * When the user is idle for longer than the configured threshold,
 * emits 'idle' event. When activity resumes, emits 'active' event.
 * 
 * Used for auto-pause/resume of the schedule.
 */

import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { powerMonitor } from 'electron';
import logger from './logger';
import { getIdlePollAction, parseGnomeScreenLocked, parseMutterIdleTimeMs } from './mutterIdle';

const POLL_INTERVAL_MS = 10_000; // Check every 10 seconds
const MUTTER_IDLE_MONITOR_ARGS = [
  '--dest', 'org.gnome.Mutter.IdleMonitor',
  '--object-path', '/org/gnome/Mutter/IdleMonitor/Core',
  '--method', 'org.gnome.Mutter.IdleMonitor.GetIdletime',
];
const GNOME_SCREEN_LOCK_ARGS = [
  '--dest', 'org.gnome.ScreenSaver',
  '--object-path', '/org/gnome/ScreenSaver',
  '--method', 'org.gnome.ScreenSaver.GetActive',
];
const execFileAsync = promisify(execFile);

function sessionBusArgs(): string[] {
  const runtimeDir = process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? Number(process.env.UID ?? 0)}`;
  const address = process.env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=${runtimeDir}/bus`;
  return ['call', '--address', address];
}

export class IdleDetector extends EventEmitter {
  private pollInterval: NodeJS.Timeout | null = null;
  private thresholdSeconds: number = 180; // 3 minutes default
  private isIdle: boolean = false;
  private enabled: boolean = false;
  private checkInFlight: boolean = false;
  private lastMutterWarningAt = 0;
  private nextGnomeProbeAt = 0;
  private screenLocked = false;
  private lastIdleSource: 'gnome' | 'electron' | null = null;
  private lifecycleGeneration = 0;

  /**
   * Start monitoring system idle time
   * @param thresholdMinutes Minutes of inactivity before considered idle
   */
  start(thresholdMinutes: number = 3): void {
    this.lifecycleGeneration++;
    this.thresholdSeconds = thresholdMinutes * 60;
    this.enabled = true;
    this.isIdle = false;

    // Clear existing interval if any
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    this.pollInterval = setInterval(() => {
      void this.checkIdle();
    }, POLL_INTERVAL_MS);
    void this.checkIdle();

    logger.info('IdleDetector', 'Started monitoring', {
      thresholdMinutes,
      pollIntervalMs: POLL_INTERVAL_MS,
    });
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    this.lifecycleGeneration++;
    this.enabled = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isIdle = false;
    logger.info('IdleDetector', 'Stopped monitoring');
  }

  /**
   * Update the idle threshold without restarting
   */
  setThreshold(thresholdMinutes: number): void {
    this.thresholdSeconds = thresholdMinutes * 60;
    void this.checkIdle();
  }

  setScreenLocked(locked: boolean): void {
    this.screenLocked = locked;
    if (locked && this.enabled) {
      if (!this.isIdle) {
        logger.info('IdleDetector', 'System idle detected', { screenLocked: true, thresholdSeconds: this.thresholdSeconds });
      }
      this.isIdle = true;
      this.emit('idle', { idleSeconds: 0, screenLocked: true });
    }
    void this.checkIdle();
  }

  /**
   * Check current idle state
   */
  private async checkIdle(): Promise<void> {
    if (!this.enabled || this.checkInFlight) return;

    this.checkInFlight = true;
    const generation = this.lifecycleGeneration;
    try {
      const reading = await this.getSystemIdleReading();
      if (!this.enabled || generation !== this.lifecycleGeneration || reading === null) return;

      const { idleSeconds, screenLocked } = reading;
      const action = getIdlePollAction(this.isIdle, idleSeconds, this.thresholdSeconds, screenLocked);
      if (action === 'idle') {
        const newlyIdle = !this.isIdle;
        this.isIdle = true;
        if (newlyIdle) {
          logger.info('IdleDetector', 'System idle detected', {
            idleSeconds,
            screenLocked,
            thresholdSeconds: this.thresholdSeconds,
          });
        }
        // A break or an inactive schedule may have ended since the last poll.
        this.emit('idle', { idleSeconds, screenLocked });
      } else if (action === 'active') {
        this.isIdle = false;
        logger.info('IdleDetector', 'System activity resumed', { idleSeconds });
        this.emit('active', { idleSeconds });
      }
    } finally {
      this.checkInFlight = false;
    }
  }

  private async getSystemIdleReading(): Promise<{ idleSeconds: number; screenLocked: boolean } | null> {
    if (process.platform === 'linux' && Date.now() >= this.nextGnomeProbeAt) {
      const args = sessionBusArgs();
      let gnomeAvailable = false;
      let screenLocked = this.screenLocked;
      try {
        const { stdout } = await execFileAsync('gdbus', [...args, ...GNOME_SCREEN_LOCK_ARGS], { timeout: 3000 });
        const locked = parseGnomeScreenLocked(stdout);
        if (locked !== null) {
          gnomeAvailable = true;
          screenLocked = locked;
          this.screenLocked = locked;
        }
      } catch {
        // Other Linux desktops may not expose GNOME's screen saver service.
      }

      if (screenLocked) {
        this.logIdleSource('gnome');
        return { idleSeconds: 0, screenLocked: true };
      }

      try {
        const { stdout } = await execFileAsync('gdbus', [...args, ...MUTTER_IDLE_MONITOR_ARGS], { timeout: 3000 });
        const idleTimeMs = parseMutterIdleTimeMs(stdout);
        if (idleTimeMs === null) throw new Error('Unexpected Mutter idle-monitor response');
        this.logIdleSource('gnome');
        return { idleSeconds: Math.floor(idleTimeMs / 1000), screenLocked: false };
      } catch (error) {
        if (gnomeAvailable) {
          const now = Date.now();
          if (now - this.lastMutterWarningAt >= 60_000) {
            this.lastMutterWarningAt = now;
            logger.warn('IdleDetector', 'GNOME idle monitor unavailable; falling back to Electron', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        } else {
          this.nextGnomeProbeAt = Date.now() + 60_000;
        }
      }
    }

    try {
      this.logIdleSource('electron');
      return { idleSeconds: powerMonitor.getSystemIdleTime(), screenLocked: this.screenLocked };
    } catch (error) {
      logger.warn('IdleDetector', 'Unable to read system idle time', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private logIdleSource(source: 'gnome' | 'electron'): void {
    if (this.lastIdleSource !== source) {
      this.lastIdleSource = source;
      logger.info('IdleDetector', 'Using system idle source', { source });
    }
  }

  /**
   * Get current idle state
   */
  getIsIdle(): boolean {
    return this.isIdle;
  }

  isRunning(): boolean {
    return this.enabled;
  }
}

// Singleton instance
let idleDetectorInstance: IdleDetector | null = null;

export function getIdleDetector(): IdleDetector {
  if (!idleDetectorInstance) {
    idleDetectorInstance = new IdleDetector();
  }
  return idleDetectorInstance;
}
