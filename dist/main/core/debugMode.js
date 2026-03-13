"use strict";
/**
 * RhythmDesk Debug Mode - Phase 5 Stability Lockdown
 *
 * Debug mode toggle for advanced diagnostics.
 *
 * ENABLED VIA:
 * - Environment variable: RHYTHMDESK_DEBUG=true
 * - Runtime toggle
 *
 * WHEN ENABLED:
 * - Verbose logging
 * - Session diagnostics panel
 * - Trace logs
 * - Invariant assertions
 *
 * WHEN DISABLED:
 * - Minimal logs
 * - Production behavior
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDebugMode = initDebugMode;
exports.setDebugMode = setDebugMode;
exports.updateDebugConfig = updateDebugConfig;
exports.getDebugConfig = getDebugConfig;
exports.isDebugMode = isDebugMode;
exports.isVerboseLogging = isVerboseLogging;
exports.shouldShowDiagnostics = shouldShowDiagnostics;
exports.areAssertionsEnabled = areAssertionsEnabled;
exports.debugAssert = debugAssert;
exports.debugLog = debugLog;
exports.debugTime = debugTime;
exports.getDebugInfo = getDebugInfo;
exports.printDebugInfo = printDebugInfo;
const traceLogger_1 = require("./traceLogger");
const logger_1 = __importDefault(require("./logger"));
const DEFAULT_DEBUG_CONFIG = {
    enabled: false,
    verboseLogging: false,
    showDiagnosticsPanel: false,
    enableTracing: false,
    enableInvariantAssertions: false,
    logToFile: true,
    logToConsole: false,
};
const FULL_DEBUG_CONFIG = {
    enabled: true,
    verboseLogging: true,
    showDiagnosticsPanel: true,
    enableTracing: true,
    enableInvariantAssertions: true,
    logToFile: true,
    logToConsole: true,
};
// ============================================================
// DEBUG STATE
// ============================================================
let currentConfig = { ...DEFAULT_DEBUG_CONFIG };
/**
 * Initialize debug mode from environment
 */
function initDebugMode() {
    const envDebug = process.env.RHYTHMDESK_DEBUG;
    const nodeEnv = process.env.NODE_ENV;
    // Check environment variable
    if (envDebug === 'true' || envDebug === '1') {
        currentConfig = { ...FULL_DEBUG_CONFIG };
        logger_1.default.info('DebugMode', 'Debug mode enabled via RHYTHMDESK_DEBUG');
    }
    else if (nodeEnv === 'development') {
        // Partial debug in dev mode
        currentConfig = {
            ...DEFAULT_DEBUG_CONFIG,
            enabled: true,
            showDiagnosticsPanel: true,
            logToConsole: true,
        };
        logger_1.default.info('DebugMode', 'Debug mode enabled (development)');
    }
    else {
        currentConfig = { ...DEFAULT_DEBUG_CONFIG };
    }
    // Apply tracing setting
    if (currentConfig.enableTracing) {
        (0, traceLogger_1.enableTracing)(true);
    }
    return currentConfig;
}
/**
 * Enable or disable debug mode at runtime
 */
function setDebugMode(enabled) {
    if (enabled) {
        currentConfig = { ...FULL_DEBUG_CONFIG };
        (0, traceLogger_1.enableTracing)(true);
        logger_1.default.info('DebugMode', 'Debug mode enabled');
    }
    else {
        currentConfig = { ...DEFAULT_DEBUG_CONFIG };
        (0, traceLogger_1.enableTracing)(false);
        logger_1.default.info('DebugMode', 'Debug mode disabled');
    }
}
/**
 * Update specific debug config options
 */
function updateDebugConfig(updates) {
    currentConfig = { ...currentConfig, ...updates };
    // Sync tracing
    if (updates.enableTracing !== undefined) {
        (0, traceLogger_1.enableTracing)(updates.enableTracing);
    }
}
/**
 * Get current debug config
 */
function getDebugConfig() {
    return { ...currentConfig };
}
/**
 * Check if debug mode is enabled
 */
function isDebugMode() {
    return currentConfig.enabled;
}
/**
 * Check if verbose logging is enabled
 */
function isVerboseLogging() {
    return currentConfig.verboseLogging;
}
/**
 * Check if diagnostics panel should be shown
 */
function shouldShowDiagnostics() {
    return currentConfig.showDiagnosticsPanel;
}
/**
 * Check if invariant assertions are enabled
 */
function areAssertionsEnabled() {
    return currentConfig.enableInvariantAssertions;
}
// ============================================================
// DEBUG ASSERTIONS
// ============================================================
/**
 * Assert a condition (only in debug mode)
 */
function debugAssert(condition, message, context) {
    if (!currentConfig.enableInvariantAssertions)
        return;
    if (!condition) {
        logger_1.default.error('DebugAssert', `ASSERTION FAILED: ${message}`, context);
        // In development, also throw to make failures obvious
        if (process.env.NODE_ENV === 'development') {
            throw new Error(`Assertion failed: ${message}`);
        }
    }
}
/**
 * Debug log (only in verbose mode)
 */
function debugLog(component, message, data) {
    if (!currentConfig.verboseLogging)
        return;
    logger_1.default.debug(component, message, data);
}
/**
 * Debug timing
 */
function debugTime(label) {
    if (!currentConfig.verboseLogging) {
        return () => 0;
    }
    const start = performance.now();
    return () => {
        const elapsed = performance.now() - start;
        logger_1.default.debug('DebugTime', `${label}: ${elapsed.toFixed(2)}ms`);
        return elapsed;
    };
}
// ============================================================
// DEBUG INFO
// ============================================================
/**
 * Get debug info summary
 */
function getDebugInfo() {
    return {
        debugMode: currentConfig.enabled,
        config: currentConfig,
        tracing: (0, traceLogger_1.isTracingEnabled)(),
        nodeEnv: process.env.NODE_ENV,
        platform: process.platform,
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
    };
}
/**
 * Print debug info to console
 */
function printDebugInfo() {
    if (!currentConfig.enabled)
        return;
    const info = getDebugInfo();
    console.log('=== RhythmDesk Debug Info ===');
    console.log(JSON.stringify(info, null, 2));
    console.log('============================');
}
//# sourceMappingURL=debugMode.js.map