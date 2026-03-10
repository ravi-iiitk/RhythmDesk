"use strict";
/**
 * RhythmDesk Office Focus Lock Service
 * Manual mode for enforcing fullscreen overlay during work phases
 *
 * Office Focus Lock: When active, forces fullscreen overlay during work phases (sit/stand)
 * This is a MANUAL mode - no automatic detection from windows/apps/processes
 * Does NOT affect break calculations or cumulative work time tracking
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOfficeFocusLockService = getOfficeFocusLockService;
const events_1 = require("events");
const types_1 = require("../shared/types");
const timeUtils_1 = require("../shared/timeUtils");
class OfficeFocusLockService extends events_1.EventEmitter {
    constructor() {
        super();
        this.tickInterval = null;
        // Office Focus Lock always starts inactive (not persisted across restarts)
        this.state = { ...types_1.INITIAL_OFFICE_FOCUS_LOCK_STATE };
    }
    /**
     * Start Office Focus Lock for a specified duration with a work label
     * @param label Work label (e.g., "EPAM", "Resy", or custom)
     * @param durationMinutes Duration in minutes
     * @param isStrictMode If true, cannot stop focus mode early
     */
    start(label, durationMinutes, isStrictMode = false) {
        const durationMs = (0, timeUtils_1.minutesToMs)(durationMinutes);
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
    stop() {
        this.stopTicking();
        this.state = { ...types_1.INITIAL_OFFICE_FOCUS_LOCK_STATE };
        this.emit('stopped');
        this.emit('changed', this.state);
    }
    /**
     * Get current Office Focus Lock state
     */
    getState() {
        return { ...this.state };
    }
    /**
     * Check if Office Focus Lock is currently active
     */
    isActive() {
        return this.state.isActive;
    }
    /**
     * Get the current work label
     */
    getLabel() {
        return this.state.label;
    }
    /**
     * Get remaining time in milliseconds
     */
    getRemainingMs() {
        return this.state.remainingMs;
    }
    /**
     * Internal tick to update remaining time
     */
    tick() {
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
let officeFocusLockServiceInstance = null;
function getOfficeFocusLockService() {
    if (!officeFocusLockServiceInstance) {
        officeFocusLockServiceInstance = new OfficeFocusLockService();
    }
    return officeFocusLockServiceInstance;
}
exports.default = getOfficeFocusLockService;
//# sourceMappingURL=officeFocusLockService.js.map