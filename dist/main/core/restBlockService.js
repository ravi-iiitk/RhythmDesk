"use strict";
/**
 * RhythmDesk Rest Block Service
 * Manual rest/break blocks for non-working time
 *
 * Rest Blocks: User-triggered breaks with customizable duration and strict mode
 * Shows fullscreen overlay with timer countdown
 * Presets can be saved for quick access (e.g., "Quick Rest", "Lunch", "Meditation")
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRestBlockService = getRestBlockService;
const events_1 = require("events");
const types_1 = require("../shared/types");
const timeUtils_1 = require("../shared/timeUtils");
const logger_1 = __importDefault(require("./logger"));
class RestBlockService extends events_1.EventEmitter {
    constructor() {
        super();
        this.tickInterval = null;
        this.state = { ...types_1.INITIAL_REST_BLOCK_STATE };
        this.presets = [...types_1.DEFAULT_REST_BLOCK_PRESETS];
    }
    /**
     * Start a rest block with specified parameters
     * @param name Display name for the rest block
     * @param durationMinutes Duration in minutes
     * @param isStrictMode If true, cannot stop early
     * @param presetId Optional preset ID if using a saved preset
     */
    start(name, durationMinutes, isStrictMode = false, presetId = null) {
        const durationMs = (0, timeUtils_1.minutesToMs)(durationMinutes);
        logger_1.default.info('RestBlockService', 'Starting rest block', {
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
    startFromPreset(presetId) {
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
    stop() {
        if (this.state.isStrictMode && this.state.remainingMs > 0) {
            return false; // Cannot stop in strict mode
        }
        this.forceStop();
        return true;
    }
    /**
     * Force stop (used when timer expires)
     */
    forceStop() {
        logger_1.default.info('RestBlockService', 'Force stopping rest block');
        this.stopTicking();
        this.state = { ...types_1.INITIAL_REST_BLOCK_STATE };
        this.emit('stopped');
        this.emit('changed', this.state);
    }
    /**
     * Get current rest block state
     */
    getState() {
        return { ...this.state };
    }
    /**
     * Check if rest block is currently active
     */
    isActive() {
        return this.state.isActive;
    }
    /**
     * Get remaining time in milliseconds
     */
    getRemainingMs() {
        return this.state.remainingMs;
    }
    /**
     * Get all saved presets
     */
    getPresets() {
        return [...this.presets];
    }
    /**
     * Save or update a preset
     */
    savePreset(preset) {
        const existingIndex = this.presets.findIndex(p => p.id === preset.id);
        if (existingIndex >= 0) {
            this.presets[existingIndex] = { ...preset };
        }
        else {
            this.presets.push({ ...preset });
        }
        this.emit('presetsChanged', this.presets);
    }
    /**
     * Delete a preset
     */
    deletePreset(presetId) {
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
    loadPresets(presets) {
        this.presets = [...presets];
    }
    /**
     * Internal tick to update remaining time
     * Emits 'tick' event on every update for overlay sync
     */
    tick() {
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
            logger_1.default.debug('RestBlockService', 'Rest block progress', {
                name: this.state.name,
                remainingMinutes: currentMinutes,
                elapsedMs: elapsed,
            });
        }
        if (remaining <= 0) {
            // Rest block duration expired
            logger_1.default.info('RestBlockService', 'Rest block expired', { name: this.state.name });
            this.forceStop();
            this.emit('expired');
        }
    }
    /**
     * Start the internal tick interval
     */
    startTicking() {
        this.stopTicking();
        this.tickInterval = setInterval(() => this.tick(), 1000);
    }
    /**
     * Stop the internal tick interval
     */
    stopTicking() {
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }
    }
}
// Singleton instance
let restBlockServiceInstance = null;
function getRestBlockService() {
    if (!restBlockServiceInstance) {
        restBlockServiceInstance = new RestBlockService();
    }
    return restBlockServiceInstance;
}
exports.default = getRestBlockService;
//# sourceMappingURL=restBlockService.js.map