"use strict";
/**
 * Overlay & Tray Debug Logging - Phase 2 Runtime Stabilization
 *
 * Structured logging for overlay and tray events.
 * Makes overlay/tray issues visible in console during development.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logOverlayEvent = logOverlayEvent;
exports.logTrayEvent = logTrayEvent;
exports.logOverlayShow = logOverlayShow;
exports.logOverlayHide = logOverlayHide;
exports.logOverlayCrash = logOverlayCrash;
exports.logOverlayRecovered = logOverlayRecovered;
exports.logRestBlockStart = logRestBlockStart;
exports.logRestBlockTick = logRestBlockTick;
exports.logRestBlockEnd = logRestBlockEnd;
exports.logTrayCreated = logTrayCreated;
exports.logTrayTooltipUpdated = logTrayTooltipUpdated;
exports.logTrayMenuRebuilt = logTrayMenuRebuilt;
exports.logTrayMenuOpen = logTrayMenuOpen;
exports.logTrayMenuClose = logTrayMenuClose;
exports.logTrayRefreshDeferred = logTrayRefreshDeferred;
exports.logTrayRefreshApplied = logTrayRefreshApplied;
const logger_1 = __importDefault(require("./logger"));
/**
 * Log an overlay event in structured format
 * Format: [OVERLAY] event=eventType field=value field=value
 */
function logOverlayEvent(data) {
    const { event, ...fields } = data;
    // Build structured log string
    const parts = [`event=${event}`];
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null) {
            if (key === 'remainingMs' && typeof value === 'number') {
                parts.push(`${key}=${Math.round(value / 1000)}s`);
            }
            else {
                parts.push(`${key}=${value}`);
            }
        }
    }
    const logLine = `[OVERLAY] ${parts.join(' ')}`;
    // Log as info for important events
    const infoEvents = [
        'overlay-show', 'overlay-hide', 'overlay-crash',
        'overlay-unresponsive', 'overlay-blank-fallback',
        'custom-break-start', 'custom-break-end',
        'rest-block-start', 'rest-block-end'
    ];
    if (infoEvents.includes(event)) {
        logger_1.default.info('OverlayDebug', logLine);
    }
    else {
        logger_1.default.debug('OverlayDebug', logLine);
    }
    // Also log to console in dev mode
    if (process.env.NODE_ENV === 'development') {
        console.log(logLine);
    }
}
/**
 * Log a tray event in structured format
 * Format: [TRAY] event=eventType field=value field=value
 */
function logTrayEvent(data) {
    const { event, ...fields } = data;
    // Build structured log string
    const parts = [`event=${event}`];
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null) {
            if (key === 'remainingMs' && typeof value === 'number') {
                parts.push(`${key}=${Math.round(value / 1000)}s`);
            }
            else {
                parts.push(`${key}=${value}`);
            }
        }
    }
    const logLine = `[TRAY] ${parts.join(' ')}`;
    // Log as info for important events
    const infoEvents = [
        'tray-created', 'tray-menu-rebuilt'
    ];
    if (infoEvents.includes(event)) {
        logger_1.default.info('TrayDebug', logLine);
    }
    else {
        logger_1.default.debug('TrayDebug', logLine);
    }
    // Also log to console in dev mode
    if (process.env.NODE_ENV === 'development') {
        console.log(logLine);
    }
}
// ============================================================
// CONVENIENCE FUNCTIONS
// ============================================================
function logOverlayShow(phase, strictMode) {
    logOverlayEvent({ event: 'overlay-show', phase, strictMode });
}
function logOverlayHide(reason) {
    logOverlayEvent({ event: 'overlay-hide', reason });
}
function logOverlayCrash(reason) {
    logOverlayEvent({ event: 'overlay-crash', reason });
}
function logOverlayRecovered() {
    logOverlayEvent({ event: 'overlay-recovered' });
}
function logRestBlockStart(name, durationMs, strictMode) {
    logOverlayEvent({
        event: 'rest-block-start',
        phase: name,
        remainingMs: durationMs,
        strictMode
    });
}
function logRestBlockTick(name, remainingMs) {
    logOverlayEvent({
        event: 'rest-block-tick',
        phase: name,
        remainingMs
    });
}
function logRestBlockEnd(name, reason) {
    logOverlayEvent({
        event: 'rest-block-end',
        phase: name,
        reason
    });
}
function logTrayCreated() {
    logTrayEvent({ event: 'tray-created' });
}
function logTrayTooltipUpdated(phase, remainingMs) {
    logTrayEvent({ event: 'tray-tooltip-updated', phase, remainingMs });
}
function logTrayMenuRebuilt(reason) {
    logTrayEvent({ event: 'tray-menu-rebuilt', reason });
}
function logTrayMenuOpen() {
    logTrayEvent({ event: 'tray-menu-open' });
}
function logTrayMenuClose() {
    logTrayEvent({ event: 'tray-menu-close' });
}
function logTrayRefreshDeferred() {
    logTrayEvent({ event: 'tray-refresh-deferred' });
}
function logTrayRefreshApplied() {
    logTrayEvent({ event: 'tray-refresh-applied' });
}
//# sourceMappingURL=overlayDebug.js.map