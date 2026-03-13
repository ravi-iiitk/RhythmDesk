"use strict";
/**
 * RhythmDesk Centralized Error Handler - Phase 5 Stability Lockdown
 *
 * Catches unhandled exceptions in main process and provides
 * structured error logging with safe recovery mechanisms.
 *
 * CATEGORIES:
 * - Uncaught exceptions (process.on('uncaughtException'))
 * - Unhandled rejections (process.on('unhandledRejection'))
 * - Runtime errors from timer engine
 * - IPC errors
 *
 * ACTIONS:
 * - Log structured error information
 * - Prevent application crash when possible
 * - Fallback to safe session reset if runtime state invalid
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
exports.handleError = handleError;
exports.setupMainProcessErrorHandlers = setupMainProcessErrorHandlers;
exports.getErrorStats = getErrorStats;
exports.resetErrorStats = resetErrorStats;
exports.withErrorHandling = withErrorHandling;
exports.safeExecute = safeExecute;
exports.safeExecuteAsync = safeExecuteAsync;
const electron_1 = require("electron");
const logger_1 = __importDefault(require("./logger"));
const failsafe_1 = require("./failsafe");
const traceLogger_1 = require("./traceLogger");
const errorTracker = {
    totalErrors: 0,
    errorsByCategory: {
        uncaught_exception: 0,
        unhandled_rejection: 0,
        timer_error: 0,
        ipc_error: 0,
        overlay_error: 0,
        storage_error: 0,
        validation_error: 0,
        unknown: 0,
    },
    lastError: null,
    consecutiveErrors: 0,
    lastErrorTime: 0,
};
// Threshold for triggering failsafe
const MAX_CONSECUTIVE_ERRORS = 5;
const ERROR_RESET_INTERVAL_MS = 60000; // 1 minute
// ============================================================
// ERROR HANDLING
// ============================================================
/**
 * Handle and log a structured error
 */
function handleError(error, category = 'unknown', context, recoverable = true) {
    const now = Date.now();
    // Reset consecutive counter if enough time has passed
    if (now - errorTracker.lastErrorTime > ERROR_RESET_INTERVAL_MS) {
        errorTracker.consecutiveErrors = 0;
    }
    // Build structured error
    const structuredError = {
        category,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        context,
        timestamp: now,
        recoverable,
    };
    // Update tracker
    errorTracker.totalErrors++;
    errorTracker.errorsByCategory[category]++;
    errorTracker.lastError = structuredError;
    errorTracker.consecutiveErrors++;
    errorTracker.lastErrorTime = now;
    // Log error
    logger_1.default.error('ErrorHandler', `[${category.toUpperCase()}] ${structuredError.message}`, {
        stack: structuredError.stack,
        context,
        consecutiveErrors: errorTracker.consecutiveErrors,
        totalErrors: errorTracker.totalErrors,
    });
    // Trace for debugging
    traceLogger_1.trace.invariantViolation(`error:${category}`, {
        message: structuredError.message,
        recoverable,
    });
    // Check if we need failsafe
    if (errorTracker.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        logger_1.default.error('ErrorHandler', 'Too many consecutive errors - triggering failsafe');
        triggerFailsafe('Too many consecutive errors');
    }
}
/**
 * Trigger failsafe recovery
 */
function triggerFailsafe(reason) {
    const failsafe = (0, failsafe_1.getFailsafeManager)();
    // Report to failsafe manager
    for (let i = 0; i < 5; i++) {
        failsafe.reportValidationFailure({ reason });
    }
    // Reset consecutive error counter
    errorTracker.consecutiveErrors = 0;
}
/**
 * Handle uncaught exception
 */
function handleUncaughtException(error) {
    handleError(error, 'uncaught_exception', undefined, false);
    // For truly fatal errors, we may need to exit
    // But try to save state first
    logger_1.default.error('ErrorHandler', 'FATAL: Uncaught exception - attempting graceful shutdown');
    // Don't exit immediately - let the app try to recover
    // Only exit if this keeps happening
    if (errorTracker.errorsByCategory.uncaught_exception > 10) {
        logger_1.default.error('ErrorHandler', 'Too many uncaught exceptions - exiting');
        electron_1.app.exit(1);
    }
}
/**
 * Handle unhandled promise rejection
 */
function handleUnhandledRejection(reason, promise) {
    handleError(reason instanceof Error ? reason : new Error(String(reason)), 'unhandled_rejection', { promise: String(promise) }, true);
}
// ============================================================
// SETUP
// ============================================================
let isSetup = false;
/**
 * Setup global error handlers for main process
 */
function setupMainProcessErrorHandlers() {
    if (isSetup)
        return;
    isSetup = true;
    // Uncaught exceptions
    process.on('uncaughtException', (error) => {
        handleUncaughtException(error);
    });
    // Unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
        handleUnhandledRejection(reason, promise);
    });
    // Handle SIGINT/SIGTERM for graceful shutdown
    process.on('SIGINT', () => {
        logger_1.default.info('ErrorHandler', 'Received SIGINT - initiating graceful shutdown');
        gracefulShutdown();
    });
    process.on('SIGTERM', () => {
        logger_1.default.info('ErrorHandler', 'Received SIGTERM - initiating graceful shutdown');
        gracefulShutdown();
    });
    logger_1.default.info('ErrorHandler', 'Main process error handlers installed');
}
/**
 * Graceful shutdown
 */
async function gracefulShutdown() {
    logger_1.default.info('ErrorHandler', 'Starting graceful shutdown...');
    try {
        // Import dynamically to avoid circular deps
        const { getTimerEngine } = await Promise.resolve().then(() => __importStar(require('./timerEngine')));
        const configService = (await Promise.resolve().then(() => __importStar(require('./configService')))).default;
        // Stop timer engine
        const timerEngine = getTimerEngine();
        timerEngine.stop();
        // Flush session snapshot
        configService.flushSessionSnapshot();
        logger_1.default.info('ErrorHandler', 'Graceful shutdown complete');
    }
    catch (error) {
        logger_1.default.error('ErrorHandler', 'Error during graceful shutdown', { error });
    }
    // Exit
    electron_1.app.exit(0);
}
// ============================================================
// UTILITIES
// ============================================================
/**
 * Get error statistics
 */
function getErrorStats() {
    return { ...errorTracker };
}
/**
 * Reset error counters (for testing)
 */
function resetErrorStats() {
    errorTracker.totalErrors = 0;
    errorTracker.consecutiveErrors = 0;
    errorTracker.lastError = null;
    Object.keys(errorTracker.errorsByCategory).forEach(key => {
        errorTracker.errorsByCategory[key] = 0;
    });
}
/**
 * Wrap a function with error handling
 */
function withErrorHandling(fn, category = 'unknown', context) {
    return ((...args) => {
        try {
            const result = fn(...args);
            // Handle async functions
            if (result instanceof Promise) {
                return result.catch((error) => {
                    handleError(error, category, { ...context, args });
                    throw error;
                });
            }
            return result;
        }
        catch (error) {
            handleError(error, category, { ...context, args });
            throw error;
        }
    });
}
/**
 * Safe execution wrapper - doesn't throw
 */
function safeExecute(fn, fallback, category = 'unknown', context) {
    try {
        return fn();
    }
    catch (error) {
        handleError(error, category, context, true);
        return fallback;
    }
}
/**
 * Safe async execution wrapper
 */
async function safeExecuteAsync(fn, fallback, category = 'unknown', context) {
    try {
        return await fn();
    }
    catch (error) {
        handleError(error, category, context, true);
        return fallback;
    }
}
//# sourceMappingURL=errorHandler.js.map