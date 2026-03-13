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

import { app } from 'electron';
import logger from './logger';
import { getFailsafeManager } from './failsafe';
import { trace } from './traceLogger';

// ============================================================
// ERROR CATEGORIES
// ============================================================

export type ErrorCategory = 
  | 'uncaught_exception'
  | 'unhandled_rejection'
  | 'timer_error'
  | 'ipc_error'
  | 'overlay_error'
  | 'storage_error'
  | 'validation_error'
  | 'unknown';

export interface StructuredError {
  category: ErrorCategory;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  timestamp: number;
  recoverable: boolean;
}

// ============================================================
// ERROR TRACKING
// ============================================================

interface ErrorTracker {
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  lastError: StructuredError | null;
  consecutiveErrors: number;
  lastErrorTime: number;
}

const errorTracker: ErrorTracker = {
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
export function handleError(
  error: Error | unknown,
  category: ErrorCategory = 'unknown',
  context?: Record<string, unknown>,
  recoverable: boolean = true
): void {
  const now = Date.now();
  
  // Reset consecutive counter if enough time has passed
  if (now - errorTracker.lastErrorTime > ERROR_RESET_INTERVAL_MS) {
    errorTracker.consecutiveErrors = 0;
  }
  
  // Build structured error
  const structuredError: StructuredError = {
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
  logger.error('ErrorHandler', `[${category.toUpperCase()}] ${structuredError.message}`, {
    stack: structuredError.stack,
    context,
    consecutiveErrors: errorTracker.consecutiveErrors,
    totalErrors: errorTracker.totalErrors,
  });
  
  // Trace for debugging
  trace.invariantViolation(`error:${category}`, {
    message: structuredError.message,
    recoverable,
  });
  
  // Check if we need failsafe
  if (errorTracker.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    logger.error('ErrorHandler', 'Too many consecutive errors - triggering failsafe');
    triggerFailsafe('Too many consecutive errors');
  }
}

/**
 * Trigger failsafe recovery
 */
function triggerFailsafe(reason: string): void {
  const failsafe = getFailsafeManager();
  
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
function handleUncaughtException(error: Error): void {
  handleError(error, 'uncaught_exception', undefined, false);
  
  // For truly fatal errors, we may need to exit
  // But try to save state first
  logger.error('ErrorHandler', 'FATAL: Uncaught exception - attempting graceful shutdown');
  
  // Don't exit immediately - let the app try to recover
  // Only exit if this keeps happening
  if (errorTracker.errorsByCategory.uncaught_exception > 10) {
    logger.error('ErrorHandler', 'Too many uncaught exceptions - exiting');
    app.exit(1);
  }
}

/**
 * Handle unhandled promise rejection
 */
function handleUnhandledRejection(reason: unknown, promise: Promise<unknown>): void {
  handleError(
    reason instanceof Error ? reason : new Error(String(reason)),
    'unhandled_rejection',
    { promise: String(promise) },
    true
  );
}

// ============================================================
// SETUP
// ============================================================

let isSetup = false;

/**
 * Setup global error handlers for main process
 */
export function setupMainProcessErrorHandlers(): void {
  if (isSetup) return;
  isSetup = true;
  
  // Uncaught exceptions
  process.on('uncaughtException', (error: Error) => {
    handleUncaughtException(error);
  });
  
  // Unhandled promise rejections
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    handleUnhandledRejection(reason, promise);
  });
  
  // Handle SIGINT/SIGTERM for graceful shutdown
  process.on('SIGINT', () => {
    logger.info('ErrorHandler', 'Received SIGINT - initiating graceful shutdown');
    gracefulShutdown();
  });
  
  process.on('SIGTERM', () => {
    logger.info('ErrorHandler', 'Received SIGTERM - initiating graceful shutdown');
    gracefulShutdown();
  });
  
  logger.info('ErrorHandler', 'Main process error handlers installed');
}

/**
 * Graceful shutdown
 */
async function gracefulShutdown(): Promise<void> {
  logger.info('ErrorHandler', 'Starting graceful shutdown...');
  
  try {
    // Import dynamically to avoid circular deps
    const { getTimerEngine } = await import('./timerEngine');
    const configService = (await import('./configService')).default;
    
    // Stop timer engine
    const timerEngine = getTimerEngine();
    timerEngine.stop();
    
    // Flush session snapshot
    configService.flushSessionSnapshot();
    
    logger.info('ErrorHandler', 'Graceful shutdown complete');
  } catch (error) {
    logger.error('ErrorHandler', 'Error during graceful shutdown', { error });
  }
  
  // Exit
  app.exit(0);
}

// ============================================================
// UTILITIES
// ============================================================

/**
 * Get error statistics
 */
export function getErrorStats(): ErrorTracker {
  return { ...errorTracker };
}

/**
 * Reset error counters (for testing)
 */
export function resetErrorStats(): void {
  errorTracker.totalErrors = 0;
  errorTracker.consecutiveErrors = 0;
  errorTracker.lastError = null;
  Object.keys(errorTracker.errorsByCategory).forEach(key => {
    errorTracker.errorsByCategory[key as ErrorCategory] = 0;
  });
}

/**
 * Wrap a function with error handling
 */
export function withErrorHandling<T extends (...args: unknown[]) => unknown>(
  fn: T,
  category: ErrorCategory = 'unknown',
  context?: Record<string, unknown>
): T {
  return ((...args: unknown[]) => {
    try {
      const result = fn(...args);
      
      // Handle async functions
      if (result instanceof Promise) {
        return result.catch((error: unknown) => {
          handleError(error, category, { ...context, args });
          throw error;
        });
      }
      
      return result;
    } catch (error) {
      handleError(error, category, { ...context, args });
      throw error;
    }
  }) as T;
}

/**
 * Safe execution wrapper - doesn't throw
 */
export function safeExecute<T>(
  fn: () => T,
  fallback: T,
  category: ErrorCategory = 'unknown',
  context?: Record<string, unknown>
): T {
  try {
    return fn();
  } catch (error) {
    handleError(error, category, context, true);
    return fallback;
  }
}

/**
 * Safe async execution wrapper
 */
export async function safeExecuteAsync<T>(
  fn: () => Promise<T>,
  fallback: T,
  category: ErrorCategory = 'unknown',
  context?: Record<string, unknown>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    handleError(error, category, context, true);
    return fallback;
  }
}
