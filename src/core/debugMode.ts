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

import { enableTracing, isTracingEnabled } from './traceLogger';
import logger from './logger';

// ============================================================
// DEBUG CONFIGURATION
// ============================================================

export interface DebugConfig {
  enabled: boolean;
  verboseLogging: boolean;
  showDiagnosticsPanel: boolean;
  enableTracing: boolean;
  enableInvariantAssertions: boolean;
  logToFile: boolean;
  logToConsole: boolean;
}

const DEFAULT_DEBUG_CONFIG: DebugConfig = {
  enabled: false,
  verboseLogging: false,
  showDiagnosticsPanel: false,
  enableTracing: false,
  enableInvariantAssertions: false,
  logToFile: true,
  logToConsole: false,
};

const FULL_DEBUG_CONFIG: DebugConfig = {
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

let currentConfig: DebugConfig = { ...DEFAULT_DEBUG_CONFIG };

/**
 * Initialize debug mode from environment
 */
export function initDebugMode(): DebugConfig {
  const envDebug = process.env.RHYTHMDESK_DEBUG;
  const nodeEnv = process.env.NODE_ENV;
  
  // Check environment variable
  if (envDebug === 'true' || envDebug === '1') {
    currentConfig = { ...FULL_DEBUG_CONFIG };
    logger.info('DebugMode', 'Debug mode enabled via RHYTHMDESK_DEBUG');
  } else if (nodeEnv === 'development') {
    // Partial debug in dev mode
    currentConfig = {
      ...DEFAULT_DEBUG_CONFIG,
      enabled: true,
      showDiagnosticsPanel: true,
      logToConsole: true,
    };
    logger.info('DebugMode', 'Debug mode enabled (development)');
  } else {
    currentConfig = { ...DEFAULT_DEBUG_CONFIG };
  }
  
  // Apply tracing setting
  if (currentConfig.enableTracing) {
    enableTracing(true);
  }
  
  return currentConfig;
}

/**
 * Enable or disable debug mode at runtime
 */
export function setDebugMode(enabled: boolean): void {
  if (enabled) {
    currentConfig = { ...FULL_DEBUG_CONFIG };
    enableTracing(true);
    logger.info('DebugMode', 'Debug mode enabled');
  } else {
    currentConfig = { ...DEFAULT_DEBUG_CONFIG };
    enableTracing(false);
    logger.info('DebugMode', 'Debug mode disabled');
  }
}

/**
 * Update specific debug config options
 */
export function updateDebugConfig(updates: Partial<DebugConfig>): void {
  currentConfig = { ...currentConfig, ...updates };
  
  // Sync tracing
  if (updates.enableTracing !== undefined) {
    enableTracing(updates.enableTracing);
  }
}

/**
 * Get current debug config
 */
export function getDebugConfig(): DebugConfig {
  return { ...currentConfig };
}

/**
 * Check if debug mode is enabled
 */
export function isDebugMode(): boolean {
  return currentConfig.enabled;
}

/**
 * Check if verbose logging is enabled
 */
export function isVerboseLogging(): boolean {
  return currentConfig.verboseLogging;
}

/**
 * Check if diagnostics panel should be shown
 */
export function shouldShowDiagnostics(): boolean {
  return currentConfig.showDiagnosticsPanel;
}

/**
 * Check if invariant assertions are enabled
 */
export function areAssertionsEnabled(): boolean {
  return currentConfig.enableInvariantAssertions;
}

// ============================================================
// DEBUG ASSERTIONS
// ============================================================

/**
 * Assert a condition (only in debug mode)
 */
export function debugAssert(
  condition: boolean,
  message: string,
  context?: Record<string, unknown>
): void {
  if (!currentConfig.enableInvariantAssertions) return;
  
  if (!condition) {
    logger.error('DebugAssert', `ASSERTION FAILED: ${message}`, context);
    
    // In development, also throw to make failures obvious
    if (process.env.NODE_ENV === 'development') {
      throw new Error(`Assertion failed: ${message}`);
    }
  }
}

/**
 * Debug log (only in verbose mode)
 */
export function debugLog(
  component: string,
  message: string,
  data?: Record<string, unknown>
): void {
  if (!currentConfig.verboseLogging) return;
  logger.debug(component, message, data);
}

/**
 * Debug timing
 */
export function debugTime(label: string): () => number {
  if (!currentConfig.verboseLogging) {
    return () => 0;
  }
  
  const start = performance.now();
  return () => {
    const elapsed = performance.now() - start;
    logger.debug('DebugTime', `${label}: ${elapsed.toFixed(2)}ms`);
    return elapsed;
  };
}

// ============================================================
// DEBUG INFO
// ============================================================

/**
 * Get debug info summary
 */
export function getDebugInfo(): Record<string, unknown> {
  return {
    debugMode: currentConfig.enabled,
    config: currentConfig,
    tracing: isTracingEnabled(),
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
export function printDebugInfo(): void {
  if (!currentConfig.enabled) return;
  
  const info = getDebugInfo();
  console.log('=== RhythmDesk Debug Info ===');
  console.log(JSON.stringify(info, null, 2));
  console.log('============================');
}
