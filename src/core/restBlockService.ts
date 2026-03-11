/**
 * RhythmDesk Rest Block Service
 * Manual rest/break blocks for non-working time
 * 
 * Rest Blocks: User-triggered breaks with customizable duration and strict mode
 * Shows fullscreen overlay with timer countdown
 * Presets can be saved for quick access (e.g., "Quick Rest", "Lunch", "Meditation")
 */

import { EventEmitter } from 'events';
import { 
  RestBlockState, 
  RestBlockPreset,
  INITIAL_REST_BLOCK_STATE, 
  DEFAULT_REST_BLOCK_PRESETS 
} from '../shared/types';
import { minutesToMs } from '../shared/timeUtils';
import logger from './logger';

class RestBlockService extends EventEmitter {
  private state: RestBlockState;
  private presets: RestBlockPreset[];
  private tickInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.state = { ...INITIAL_REST_BLOCK_STATE };
    this.presets = [...DEFAULT_REST_BLOCK_PRESETS];
  }

  /**
   * Start a rest block with specified parameters
   * @param name Display name for the rest block
   * @param durationMinutes Duration in minutes
   * @param isStrictMode If true, cannot stop early
   * @param presetId Optional preset ID if using a saved preset
   */
  start(name: string, durationMinutes: number, isStrictMode: boolean = false, presetId: string | null = null): void {
    const durationMs = minutesToMs(durationMinutes);
    
    logger.info('RestBlockService', 'Starting rest block', {
      name,
      durationMinutes,
      durationMs,
      isStrictMode,
      presetId,
    });
    
    this.state = {
      isActive: true,
      presetId,
      name,
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
   * Start a rest block using a saved preset
   * @param presetId ID of the preset to use
   */
  startFromPreset(presetId: string): boolean {
    const preset = this.presets.find(p => p.id === presetId);
    if (!preset) {
      return false;
    }
    this.start(preset.name, preset.durationMinutes, preset.strictMode, preset.id);
    return true;
  }

  /**
   * Stop rest block manually (only if not in strict mode)
   */
  stop(): boolean {
    if (this.state.isStrictMode && this.state.remainingMs > 0) {
      return false; // Cannot stop in strict mode
    }
    this.forceStop();
    return true;
  }

  /**
   * Force stop (used when timer expires)
   */
  private forceStop(): void {
    logger.info('RestBlockService', 'Force stopping rest block');
    this.stopTicking();
    this.state = { ...INITIAL_REST_BLOCK_STATE };
    this.emit('stopped');
    this.emit('changed', this.state);
  }

  /**
   * Get current rest block state
   */
  getState(): RestBlockState {
    return { ...this.state };
  }

  /**
   * Check if rest block is currently active
   */
  isActive(): boolean {
    return this.state.isActive;
  }

  /**
   * Get remaining time in milliseconds
   */
  getRemainingMs(): number {
    return this.state.remainingMs;
  }

  /**
   * Get all saved presets
   */
  getPresets(): RestBlockPreset[] {
    return [...this.presets];
  }

  /**
   * Save or update a preset
   */
  savePreset(preset: RestBlockPreset): void {
    const existingIndex = this.presets.findIndex(p => p.id === preset.id);
    if (existingIndex >= 0) {
      this.presets[existingIndex] = { ...preset };
    } else {
      this.presets.push({ ...preset });
    }
    this.emit('presetsChanged', this.presets);
  }

  /**
   * Delete a preset
   */
  deletePreset(presetId: string): boolean {
    const index = this.presets.findIndex(p => p.id === presetId);
    if (index >= 0) {
      this.presets.splice(index, 1);
      this.emit('presetsChanged', this.presets);
      return true;
    }
    return false;
  }

  /**
   * Load presets from config (called during initialization)
   */
  loadPresets(presets: RestBlockPreset[]): void {
    this.presets = [...presets];
  }

  /**
   * Internal tick to update remaining time
   * Emits 'tick' event on every update for overlay sync
   */
  private tick(): void {
    if (!this.state.isActive || !this.state.startedAt) {
      return;
    }

    const elapsed = Date.now() - this.state.startedAt;
    const remaining = Math.max(0, this.state.durationMs - elapsed);
    const prevRemaining = this.state.remainingMs;

    this.state.remainingMs = remaining;
    
    // Emit tick event for overlay sync - this is critical for long rest blocks
    this.emit('tick', this.state);
    
    // Log progress every minute for debugging
    const prevMinutes = Math.floor(prevRemaining / 60000);
    const currentMinutes = Math.floor(remaining / 60000);
    if (prevMinutes !== currentMinutes) {
      logger.debug('RestBlockService', 'Rest block progress', {
        name: this.state.name,
        remainingMinutes: currentMinutes,
        elapsedMs: elapsed,
      });
    }

    if (remaining <= 0) {
      // Rest block duration expired
      logger.info('RestBlockService', 'Rest block expired', { name: this.state.name });
      this.forceStop();
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
let restBlockServiceInstance: RestBlockService | null = null;

export function getRestBlockService(): RestBlockService {
  if (!restBlockServiceInstance) {
    restBlockServiceInstance = new RestBlockService();
  }
  return restBlockServiceInstance;
}

export default getRestBlockService;
