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
import { powerMonitor } from 'electron';
import logger from './logger';

const POLL_INTERVAL_MS = 10_000; // Check every 10 seconds

export class IdleDetector extends EventEmitter {
  private pollInterval: NodeJS.Timeout | null = null;
  private thresholdSeconds: number = 180; // 3 minutes default
  private isIdle: boolean = false;
  private enabled: boolean = false;

  /**
   * Start monitoring system idle time
   * @param thresholdMinutes Minutes of inactivity before considered idle
   */
  start(thresholdMinutes: number = 3): void {
    this.thresholdSeconds = thresholdMinutes * 60;
    this.enabled = true;
    this.isIdle = false;

    // Clear existing interval if any
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    this.pollInterval = setInterval(() => {
      this.checkIdle();
    }, POLL_INTERVAL_MS);

    logger.info('IdleDetector', 'Started monitoring', {
      thresholdMinutes,
      pollIntervalMs: POLL_INTERVAL_MS,
    });
  }

  /**
   * Stop monitoring
   */
  stop(): void {
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
  }

  /**
   * Check current idle state
   */
  private checkIdle(): void {
    if (!this.enabled) return;

    const idleSeconds = powerMonitor.getSystemIdleTime();

    if (!this.isIdle && idleSeconds >= this.thresholdSeconds) {
      // User just became idle
      this.isIdle = true;
      logger.info('IdleDetector', 'System idle detected', {
        idleSeconds,
        thresholdSeconds: this.thresholdSeconds,
      });
      this.emit('idle', { idleSeconds });
    } else if (this.isIdle && idleSeconds < this.thresholdSeconds) {
      // User became active again
      this.isIdle = false;
      logger.info('IdleDetector', 'System activity resumed', { idleSeconds });
      this.emit('active', { idleSeconds });
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
