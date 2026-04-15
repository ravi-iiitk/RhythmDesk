/**
 * RhythmDesk Office Focus Lock Service
 * Manual mode for enforcing fullscreen overlay during work phases
 * 
 * Office Focus Lock: When active, forces fullscreen overlay during work phases (sit/stand)
 * This is a MANUAL mode - no automatic detection from windows/apps/processes
 * Does NOT affect break calculations or cumulative work time tracking
 */

import { EventEmitter } from 'events';
import { OfficeFocusLockState, INITIAL_OFFICE_FOCUS_LOCK_STATE } from '../shared/types';
import { minutesToMs } from '../shared/timeUtils';

class OfficeFocusLockService extends EventEmitter {
  private state: OfficeFocusLockState;
  private tickInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    // Office Focus Lock always starts inactive (not persisted across restarts)
    this.state = { ...INITIAL_OFFICE_FOCUS_LOCK_STATE };
  }

  /**
   * Start Office Focus Lock for a specified duration with a work label
   * @param label Work label (e.g., "Deep Work", "Meeting", or custom)
   * @param durationMinutes Duration in minutes
   * @param isStrictMode If true, cannot stop focus mode early
   */
  start(label: string, durationMinutes: number, isStrictMode: boolean = false): void {
    const durationMs = minutesToMs(durationMinutes);
    
    this.state = {
      isActive: true,
      label,
      startedAt: Date.now(),
      durationMs,
      remainingMs: durationMs,
      isStrictMode,
    };

    this.startTicking();
    this.emit('started', this.state);
    this.emit('changed', this.state);
  }

  /**
   * Stop Office Focus Lock manually
   */
  stop(): void {
    this.stopTicking();
    this.state = { ...INITIAL_OFFICE_FOCUS_LOCK_STATE };
    this.emit('stopped');
    this.emit('changed', this.state);
  }

  /**
   * Get current Office Focus Lock state
   */
  getState(): OfficeFocusLockState {
    return { ...this.state };
  }

  /**
   * Check if Office Focus Lock is currently active
   */
  isActive(): boolean {
    return this.state.isActive;
  }

  /**
   * Get the current work label
   */
  getLabel(): string {
    return this.state.label;
  }

  /**
   * Get remaining time in milliseconds
   */
  getRemainingMs(): number {
    return this.state.remainingMs;
  }

  /**
   * Internal tick to update remaining time
   */
  private tick(): void {
    if (!this.state.isActive || !this.state.startedAt) {
      return;
    }

    const elapsed = Date.now() - this.state.startedAt;
    const remaining = Math.max(0, this.state.durationMs - elapsed);

    this.state.remainingMs = remaining;

    if (remaining <= 0) {
      // Office Focus Lock duration expired
      this.stop();
      this.emit('expired');
    }
  }

  /**
   * Start the internal tick interval
   */
  private startTicking(): void {
    this.stopTicking();
    this.tickInterval = setInterval(() => this.tick(), 1000);
  }

  /**
   * Stop the internal tick interval
   */
  private stopTicking(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }
}

// Singleton instance
let officeFocusLockServiceInstance: OfficeFocusLockService | null = null;

export function getOfficeFocusLockService(): OfficeFocusLockService {
  if (!officeFocusLockServiceInstance) {
    officeFocusLockServiceInstance = new OfficeFocusLockService();
  }
  return officeFocusLockServiceInstance;
}

export default getOfficeFocusLockService;
