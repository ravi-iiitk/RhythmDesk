"use strict";
/**
 * Overlay Sync Module - Phase 2 Runtime Stabilization
 *
 * Provides heartbeat, watchdog, and resync mechanisms to ensure
 * overlay stays alive and responsive during long breaks.
 *
 * ARCHITECTURE:
 * - Main process sends heartbeat requests every few seconds
 * - Overlay renderer responds with heartbeat ACK
 * - If no ACK received within timeout, overlay is considered stale
 * - Stale overlay triggers recovery (reload or recreate)
 *
 * This prevents:
 * - Custom break overlay freeze
 * - Blank/stale overlay during long rest blocks
 * - User getting stuck in unresponsive kiosk mode
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OVERLAY_SYNC_CHANNELS = void 0;
exports.getOverlaySyncService = getOverlaySyncService;
const events_1 = require("events");
const logger_1 = __importDefault(require("./logger"));
// ============================================================
// CONSTANTS
// ============================================================
const HEARTBEAT_INTERVAL_MS = 5000; // Send heartbeat every 5 seconds
const HEARTBEAT_TIMEOUT_MS = 10000; // Consider stale after 10 seconds no response
const MAX_MISSED_HEARTBEATS = 2; // Recover after 2 missed heartbeats
// ============================================================
// OVERLAY SYNC SERVICE
// ============================================================
class OverlaySyncService extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.state = {
            isOverlayActive: false,
            lastHeartbeatSent: 0,
            lastHeartbeatReceived: 0,
            missedHeartbeats: 0,
            isStale: false,
            lastResync: 0,
        };
        this.heartbeatInterval = null;
        this.sendHeartbeatFn = null;
        this.recoverOverlayFn = null;
    }
    /**
     * Start the heartbeat watchdog
     * @param sendHeartbeat Function to send heartbeat to overlay
     * @param recoverOverlay Function to recover/recreate overlay
     */
    start(sendHeartbeat, recoverOverlay) {
        this.sendHeartbeatFn = sendHeartbeat;
        this.recoverOverlayFn = recoverOverlay;
        this.state.isOverlayActive = true;
        this.state.missedHeartbeats = 0;
        this.state.isStale = false;
        // Clear any existing interval
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        // Start heartbeat loop
        this.heartbeatInterval = setInterval(() => {
            this.checkHeartbeat();
        }, HEARTBEAT_INTERVAL_MS);
        // Send initial heartbeat
        this.sendHeartbeat();
        this.logEvent('heartbeat-sent', 'Overlay sync started');
    }
    /**
     * Stop the heartbeat watchdog
     */
    stop() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        this.state.isOverlayActive = false;
        this.sendHeartbeatFn = null;
        this.recoverOverlayFn = null;
        this.logEvent('heartbeat-sent', 'Overlay sync stopped');
    }
    /**
     * Called when overlay responds to heartbeat
     */
    onHeartbeatResponse() {
        const now = Date.now();
        this.state.lastHeartbeatReceived = now;
        this.state.missedHeartbeats = 0;
        // Clear stale flag if it was set
        if (this.state.isStale) {
            this.state.isStale = false;
            this.logEvent('overlay-recovered', 'Overlay responded after being stale');
            this.emit('overlay-recovered');
        }
        this.logEvent('heartbeat-received', 'Heartbeat ACK received');
    }
    /**
     * Request resync of overlay state
     * Called when overlay needs fresh data from main process
     */
    requestResync() {
        this.state.lastResync = Date.now();
        this.logEvent('resync-requested', 'Overlay requested resync');
        this.emit('resync-requested');
    }
    /**
     * Confirm resync completed
     */
    confirmResync() {
        this.logEvent('resync-completed', 'Resync completed');
        this.emit('resync-completed');
    }
    /**
     * Get current sync state
     */
    getState() {
        return { ...this.state };
    }
    /**
     * Check if overlay is considered healthy
     */
    isHealthy() {
        if (!this.state.isOverlayActive)
            return true; // Not active = not unhealthy
        return !this.state.isStale;
    }
    /**
     * Check heartbeat and handle missed beats
     */
    checkHeartbeat() {
        if (!this.state.isOverlayActive)
            return;
        const now = Date.now();
        const timeSinceLastResponse = now - this.state.lastHeartbeatReceived;
        // Check if we missed a heartbeat
        if (this.state.lastHeartbeatSent > 0 && timeSinceLastResponse > HEARTBEAT_TIMEOUT_MS) {
            this.state.missedHeartbeats++;
            this.logEvent('heartbeat-missed', `Missed heartbeat #${this.state.missedHeartbeats}`);
            this.emit('heartbeat-missed', this.state.missedHeartbeats);
            // Check if overlay is stale
            if (this.state.missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
                this.handleStaleOverlay();
            }
        }
        // Send next heartbeat
        this.sendHeartbeat();
    }
    /**
     * Send heartbeat to overlay
     */
    sendHeartbeat() {
        if (this.sendHeartbeatFn) {
            this.state.lastHeartbeatSent = Date.now();
            this.sendHeartbeatFn();
        }
    }
    /**
     * Handle stale overlay - attempt recovery
     */
    handleStaleOverlay() {
        if (this.state.isStale)
            return; // Already handling
        this.state.isStale = true;
        this.logEvent('overlay-stale', 'Overlay is stale - attempting recovery');
        this.emit('overlay-stale');
        // Attempt recovery
        if (this.recoverOverlayFn) {
            this.recoverOverlayFn();
            this.state.missedHeartbeats = 0; // Reset after recovery attempt
        }
    }
    /**
     * Log sync event
     */
    logEvent(event, message) {
        logger_1.default.debug('OverlaySync', `[OVERLAY_SYNC] event=${event} ${message}`, {
            isActive: this.state.isOverlayActive,
            missedHeartbeats: this.state.missedHeartbeats,
            isStale: this.state.isStale,
        });
        // Also log to console in dev mode
        if (process.env.NODE_ENV === 'development') {
            console.log(`[OVERLAY_SYNC] event=${event} ${message}`);
        }
    }
}
// Singleton instance
let overlaySyncService = null;
function getOverlaySyncService() {
    if (!overlaySyncService) {
        overlaySyncService = new OverlaySyncService();
    }
    return overlaySyncService;
}
// ============================================================
// IPC CHANNEL NAMES
// ============================================================
exports.OVERLAY_SYNC_CHANNELS = {
    HEARTBEAT_REQUEST: 'overlay-sync:heartbeat-request',
    HEARTBEAT_RESPONSE: 'overlay-sync:heartbeat-response',
    RESYNC_REQUEST: 'overlay-sync:resync-request',
    RESYNC_DATA: 'overlay-sync:resync-data',
};
//# sourceMappingURL=overlaySync.js.map