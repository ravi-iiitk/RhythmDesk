"use strict";
/**
 * RhythmDesk Safe Shutdown - Phase 5 Stability Lockdown
 *
 * Handles graceful application shutdown.
 *
 * SHUTDOWN SEQUENCE:
 * 1. Stop timer engine
 * 2. Flush pending session snapshot
 * 3. Ensure snapshot persisted
 * 4. Close overlay safely
 * 5. Exit application
 *
 * HANDLES SIGNALS:
 * - SIGINT (Ctrl+C)
 * - SIGTERM (kill)
 * - app.quit()
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initiateShutdown = initiateShutdown;
exports.installShutdownHandlers = installShutdownHandlers;
exports.isShuttingDown = isShuttingDown;
exports.getShutdownState = getShutdownState;
const electron_1 = require("electron");
const logger_1 = __importDefault(require("./logger"));
const traceLogger_1 = require("./traceLogger");
const healthMonitor_1 = require("./healthMonitor");
const shutdownState = {
    isShuttingDown: false,
    shutdownStartTime: null,
    shutdownReason: null,
    snapshotFlushed: false,
    timerStopped: false,
    overlaysClosed: false,
};
// Maximum time to wait for graceful shutdown
const SHUTDOWN_TIMEOUT_MS = 5000;
// ============================================================
// SHUTDOWN HANDLERS
// ============================================================
/**
 * Initiate graceful shutdown
 */
async function initiateShutdown(reason = 'user_request') {
    // Prevent duplicate shutdown
    if (shutdownState.isShuttingDown) {
        logger_1.default.warn('Shutdown', 'Shutdown already in progress');
        return;
    }
    shutdownState.isShuttingDown = true;
    shutdownState.shutdownStartTime = Date.now();
    shutdownState.shutdownReason = reason;
    logger_1.default.info('Shutdown', 'Initiating graceful shutdown', { reason });
    traceLogger_1.trace.recovery('shutdown', { reason });
    try {
        // Set timeout for forced exit
        const forceExitTimeout = setTimeout(() => {
            logger_1.default.error('Shutdown', 'Forced exit due to timeout');
            electron_1.app.exit(1);
        }, SHUTDOWN_TIMEOUT_MS);
        // Step 1: Stop health monitor
        await stopHealthMonitor();
        // Step 2: Stop timer engine
        await stopTimerEngine();
        shutdownState.timerStopped = true;
        // Step 3: Flush session snapshot
        await flushSessionSnapshot();
        shutdownState.snapshotFlushed = true;
        // Step 4: Close overlay windows
        await closeOverlayWindows();
        shutdownState.overlaysClosed = true;
        // Clear timeout
        clearTimeout(forceExitTimeout);
        // Log completion
        const duration = Date.now() - (shutdownState.shutdownStartTime || 0);
        logger_1.default.info('Shutdown', 'Graceful shutdown complete', { duration });
        // Exit
        electron_1.app.exit(0);
    }
    catch (error) {
        logger_1.default.error('Shutdown', 'Error during shutdown', {
            error: error instanceof Error ? error.message : String(error),
        });
        // Force exit
        electron_1.app.exit(1);
    }
}
/**
 * Stop health monitor
 */
async function stopHealthMonitor() {
    try {
        const healthMonitor = (0, healthMonitor_1.getHealthMonitor)();
        healthMonitor.stop();
        logger_1.default.debug('Shutdown', 'Health monitor stopped');
    }
    catch (error) {
        logger_1.default.warn('Shutdown', 'Failed to stop health monitor', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
/**
 * Stop timer engine
 */
async function stopTimerEngine() {
    try {
        // Dynamic import to avoid circular dependencies
        const { getTimerEngine } = await Promise.resolve().then(() => __importStar(require('./timerEngine')));
        const timerEngine = getTimerEngine();
        timerEngine.stop();
        logger_1.default.debug('Shutdown', 'Timer engine stopped');
    }
    catch (error) {
        logger_1.default.warn('Shutdown', 'Failed to stop timer engine', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
/**
 * Flush session snapshot
 */
async function flushSessionSnapshot() {
    try {
        // Dynamic import to avoid circular dependencies
        const configService = (await Promise.resolve().then(() => __importStar(require('./configService')))).default;
        configService.flushSessionSnapshot();
        logger_1.default.debug('Shutdown', 'Session snapshot flushed');
    }
    catch (error) {
        logger_1.default.warn('Shutdown', 'Failed to flush session snapshot', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
/**
 * Close overlay windows
 */
async function closeOverlayWindows() {
    try {
        const windows = electron_1.BrowserWindow.getAllWindows();
        for (const window of windows) {
            // Check if this is an overlay window (typically frameless, fullscreen)
            if (window.isFullScreen() || !window.isClosable()) {
                // Force close
                window.setClosable(true);
                window.close();
            }
        }
        logger_1.default.debug('Shutdown', 'Overlay windows closed');
    }
    catch (error) {
        logger_1.default.warn('Shutdown', 'Failed to close overlay windows', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
// ============================================================
// SIGNAL HANDLERS
// ============================================================
let signalHandlersInstalled = false;
/**
 * Install signal handlers for graceful shutdown
 */
function installShutdownHandlers() {
    if (signalHandlersInstalled)
        return;
    signalHandlersInstalled = true;
    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
        logger_1.default.info('Shutdown', 'Received SIGINT');
        initiateShutdown('SIGINT');
    });
    // Handle SIGTERM
    process.on('SIGTERM', () => {
        logger_1.default.info('Shutdown', 'Received SIGTERM');
        initiateShutdown('SIGTERM');
    });
    // Handle app quit event
    electron_1.app.on('before-quit', (event) => {
        if (!shutdownState.isShuttingDown) {
            event.preventDefault();
            initiateShutdown('app_quit');
        }
    });
    // Handle window-all-closed
    electron_1.app.on('window-all-closed', () => {
        // On macOS, apps typically stay open until explicitly quit
        if (process.platform !== 'darwin') {
            initiateShutdown('windows_closed');
        }
    });
    logger_1.default.info('Shutdown', 'Shutdown handlers installed');
}
// ============================================================
// STATE ACCESS
// ============================================================
/**
 * Check if shutdown is in progress
 */
function isShuttingDown() {
    return shutdownState.isShuttingDown;
}
/**
 * Get shutdown state
 */
function getShutdownState() {
    return { ...shutdownState };
}
//# sourceMappingURL=shutdown.js.map