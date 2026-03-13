"use strict";
/**
 * RhythmDesk Overlay Safety Module
 *
 * ARCHITECTURE HARDENING: Explicit overlay safety boundaries and fallback behavior
 *
 * This module defines:
 * 1. Safe fallback behavior if overlay renderer fails
 * 2. What happens if phase becomes idle while overlay is active
 * 3. Emergency fallback for invalid kiosk/fullscreen state
 * 4. Linux limitations and graceful degradation
 *
 * SAFETY INVARIANTS:
 *
 * INV-OVERLAY-1: Overlay must never be shown for idle phase
 * INV-OVERLAY-2: Overlay must close when schedule deactivates
 * INV-OVERLAY-3: Overlay must have escape hatch in non-strict mode
 * INV-OVERLAY-4: Strict mode overlay must have time limit (break duration)
 * INV-OVERLAY-5: Renderer crash must not trap user in fullscreen
 *
 * LINUX DEGRADATION STRATEGY:
 *
 * 1. Tray menu stability: Keep menu static, reduce dynamic updates
 * 2. Kiosk mode: If window manager prevents ideal focus, preserve break semantics
 * 3. Fullscreen: May not work on all compositors, fallback to always-on-top
 * 4. Focus stealing: Some WMs prevent it, show notification instead
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LINUX_LIMITATIONS = exports.DEFAULT_OVERLAY_SAFETY_CONFIG = void 0;
exports.checkOverlaySafety = checkOverlaySafety;
exports.shouldCloseOverlayOnPhaseChange = shouldCloseOverlayOnPhaseChange;
exports.getLinuxDegradation = getLinuxDegradation;
exports.isLinuxWithLimitations = isLinuxWithLimitations;
exports.getEmergencyCloseStrategy = getEmergencyCloseStrategy;
exports.logOverlaySafetyEvent = logOverlaySafetyEvent;
exports.checkOverlayHealth = checkOverlayHealth;
const logger_1 = __importDefault(require("./logger"));
exports.DEFAULT_OVERLAY_SAFETY_CONFIG = {
    maxStrictModeDurationMs: 30 * 60 * 1000, // 30 minutes max strict mode
    rendererHealthTimeoutMs: 5000, // 5 seconds before crash detection
    heartbeatIntervalMs: 1000, // 1 second heartbeat
    linuxDegradationEnabled: process.platform === 'linux',
};
/**
 * Check if overlay state is safe given current phase
 * Returns recommended action if unsafe
 */
function checkOverlaySafety(overlayActive, overlayStrictMode, currentPhase, scheduleActive, overlayStartedAt, config = exports.DEFAULT_OVERLAY_SAFETY_CONFIG) {
    // INV-OVERLAY-1: Overlay must never be shown for idle phase
    if (overlayActive && currentPhase === 'idle') {
        return {
            safe: false,
            action: 'close',
            reason: 'Overlay active during idle phase (INV-OVERLAY-1)',
        };
    }
    // INV-OVERLAY-2: Overlay must close when schedule deactivates
    if (overlayActive && !scheduleActive) {
        return {
            safe: false,
            action: 'close',
            reason: 'Overlay active but no schedule active (INV-OVERLAY-2)',
        };
    }
    // INV-OVERLAY-4: Strict mode overlay must have time limit
    if (overlayActive && overlayStrictMode && overlayStartedAt) {
        const overlayDuration = Date.now() - overlayStartedAt;
        if (overlayDuration > config.maxStrictModeDurationMs) {
            return {
                safe: false,
                action: 'downgrade',
                reason: `Strict mode exceeded max duration (INV-OVERLAY-4): ${Math.round(overlayDuration / 60000)}min`,
            };
        }
    }
    return { safe: true, action: 'none' };
}
/**
 * Check if phase transition should close overlay
 */
function shouldCloseOverlayOnPhaseChange(prevPhase, newPhase, overlayActive) {
    if (!overlayActive)
        return false;
    // Always close on transition to idle
    if (newPhase === 'idle')
        return true;
    // Close when leaving break phases to work phases
    const wasBreak = prevPhase === 'short-break' || prevPhase === 'long-break';
    const isWork = newPhase === 'sit' || newPhase === 'stand';
    if (wasBreak && isWork)
        return true;
    return false;
}
// ============================================================
// LINUX DEGRADATION STRATEGY
// ============================================================
/**
 * Linux-specific limitations and workarounds
 */
exports.LINUX_LIMITATIONS = {
    /**
     * Tray menu behavior
     * - Some DEs (GNOME) have limited tray support
     * - Menu updates can cause flicker
     * - Keep menu static to avoid instability
     */
    trayMenu: {
        description: 'Tray menu may flicker or be unavailable on some Linux DEs',
        workaround: 'Keep menu structure static, update text content only',
        affectedDEs: ['GNOME', 'GNOME Shell'],
    },
    /**
     * Kiosk/fullscreen mode
     * - Not all compositors support true kiosk mode
     * - Some WMs allow Alt+Tab even in fullscreen
     * - Focus stealing prevention may block overlay
     */
    kioskMode: {
        description: 'True kiosk mode may not work on all Linux compositors',
        workaround: 'Use always-on-top + fullscreen as best effort',
        fallback: 'If fullscreen fails, use maximized + always-on-top',
    },
    /**
     * Focus stealing
     * - Many Linux WMs prevent focus stealing
     * - New windows may appear behind current focus
     * - User may not notice overlay
     */
    focusStealing: {
        description: 'Linux WMs may prevent overlay from stealing focus',
        workaround: 'Show system notification as backup',
        fallback: 'Use urgency hint on window',
    },
    /**
     * Multi-monitor
     * - Spanning all monitors may not work
     * - Primary monitor detection varies
     */
    multiMonitor: {
        description: 'Multi-monitor overlay behavior varies by compositor',
        workaround: 'Show on primary monitor only',
    },
};
/**
 * Get Linux degradation recommendation for current context
 */
function getLinuxDegradation(feature) {
    return exports.LINUX_LIMITATIONS[feature];
}
/**
 * Check if running on Linux with potential compositor issues
 */
function isLinuxWithLimitations() {
    if (process.platform !== 'linux')
        return false;
    // Check for known problematic environments
    const desktop = process.env.XDG_CURRENT_DESKTOP || '';
    const session = process.env.XDG_SESSION_TYPE || '';
    // Wayland has more limitations than X11
    if (session === 'wayland') {
        logger_1.default.debug('OverlaySafety', 'Running on Wayland - some features may be limited');
        return true;
    }
    // GNOME Shell has tray limitations
    if (desktop.includes('GNOME')) {
        logger_1.default.debug('OverlaySafety', 'Running on GNOME - tray features may be limited');
        return true;
    }
    return false;
}
// ============================================================
// EMERGENCY FALLBACK
// ============================================================
/**
 * Emergency overlay close - last resort when normal close fails
 * This should be called if overlay is stuck or unresponsive
 */
function getEmergencyCloseStrategy() {
    return {
        steps: [
            '1. Try normal overlay close via IPC',
            '2. If no response in 2s, force close overlay window',
            '3. If window still exists, destroy BrowserWindow',
            '4. Reset overlay state in main process',
            '5. Log emergency close for debugging',
        ],
        keyboardShortcut: process.platform === 'darwin' ? 'Cmd+Shift+Escape' : 'Ctrl+Shift+Escape',
    };
}
/**
 * Log overlay safety event
 */
function logOverlaySafetyEvent(event, details) {
    logger_1.default.warn('OverlaySafety', `[SAFETY] ${event}`, details);
}
/**
 * Check if overlay is healthy based on heartbeat
 */
function checkOverlayHealth(health, config = exports.DEFAULT_OVERLAY_SAFETY_CONFIG) {
    if (!health.lastHeartbeat) {
        return { healthy: true, action: 'none' }; // No heartbeat yet, assume OK
    }
    const timeSinceHeartbeat = Date.now() - health.lastHeartbeat;
    if (timeSinceHeartbeat > config.rendererHealthTimeoutMs) {
        return {
            healthy: false,
            action: 'recover',
        };
    }
    if (health.missedHeartbeats >= 3) {
        return {
            healthy: false,
            action: 'warn',
        };
    }
    return { healthy: true, action: 'none' };
}
//# sourceMappingURL=overlaySafety.js.map