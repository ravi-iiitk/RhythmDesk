/**
 * Overlay & Tray Debug Logging - Phase 2 Runtime Stabilization
 * 
 * Structured logging for overlay and tray events.
 * Makes overlay/tray issues visible in console during development.
 */

import logger from './logger';

// ============================================================
// OVERLAY EVENT TYPES
// ============================================================

export type OverlayEventType =
  | 'overlay-show'
  | 'overlay-hide'
  | 'overlay-reload'
  | 'overlay-resync'
  | 'overlay-crash'
  | 'overlay-unresponsive'
  | 'overlay-recovered'
  | 'overlay-blank-fallback'
  | 'custom-break-start'
  | 'custom-break-tick'
  | 'custom-break-end'
  | 'rest-block-start'
  | 'rest-block-tick'
  | 'rest-block-end';

export type TrayEventType =
  | 'tray-created'
  | 'tray-tooltip-updated'
  | 'tray-menu-rebuilt'
  | 'tray-menu-open'
  | 'tray-menu-close'
  | 'tray-refresh-deferred'
  | 'tray-refresh-applied';

// ============================================================
// OVERLAY DEBUG LOGGING
// ============================================================

interface OverlayEventData {
  event: OverlayEventType;
  phase?: string;
  strictMode?: boolean;
  remainingMs?: number;
  reason?: string;
  [key: string]: unknown;
}

/**
 * Log an overlay event in structured format
 * Format: [OVERLAY] event=eventType field=value field=value
 */
export function logOverlayEvent(data: OverlayEventData): void {
  const { event, ...fields } = data;
  
  // Build structured log string
  const parts: string[] = [`event=${event}`];
  
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      if (key === 'remainingMs' && typeof value === 'number') {
        parts.push(`${key}=${Math.round(value / 1000)}s`);
      } else {
        parts.push(`${key}=${value}`);
      }
    }
  }
  
  const logLine = `[OVERLAY] ${parts.join(' ')}`;
  
  // Log as info for important events
  const infoEvents: OverlayEventType[] = [
    'overlay-show', 'overlay-hide', 'overlay-crash', 
    'overlay-unresponsive', 'overlay-blank-fallback',
    'custom-break-start', 'custom-break-end',
    'rest-block-start', 'rest-block-end'
  ];
  
  if (infoEvents.includes(event)) {
    logger.info('OverlayDebug', logLine);
  } else {
    logger.debug('OverlayDebug', logLine);
  }
  
  // Also log to console in dev mode
  if (process.env.NODE_ENV === 'development') {
    console.log(logLine);
  }
}

// ============================================================
// TRAY DEBUG LOGGING
// ============================================================

interface TrayEventData {
  event: TrayEventType;
  scheduleName?: string;
  phase?: string;
  remainingMs?: number;
  reason?: string;
  [key: string]: unknown;
}

/**
 * Log a tray event in structured format
 * Format: [TRAY] event=eventType field=value field=value
 */
export function logTrayEvent(data: TrayEventData): void {
  const { event, ...fields } = data;
  
  // Build structured log string
  const parts: string[] = [`event=${event}`];
  
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      if (key === 'remainingMs' && typeof value === 'number') {
        parts.push(`${key}=${Math.round(value / 1000)}s`);
      } else {
        parts.push(`${key}=${value}`);
      }
    }
  }
  
  const logLine = `[TRAY] ${parts.join(' ')}`;
  
  // Log as info for important events
  const infoEvents: TrayEventType[] = [
    'tray-created', 'tray-menu-rebuilt'
  ];
  
  if (infoEvents.includes(event)) {
    logger.info('TrayDebug', logLine);
  } else {
    logger.debug('TrayDebug', logLine);
  }
  
  // Also log to console in dev mode
  if (process.env.NODE_ENV === 'development') {
    console.log(logLine);
  }
}

// ============================================================
// CONVENIENCE FUNCTIONS
// ============================================================

export function logOverlayShow(phase: string, strictMode: boolean): void {
  logOverlayEvent({ event: 'overlay-show', phase, strictMode });
}

export function logOverlayHide(reason: string): void {
  logOverlayEvent({ event: 'overlay-hide', reason });
}

export function logOverlayCrash(reason: string): void {
  logOverlayEvent({ event: 'overlay-crash', reason });
}

export function logOverlayRecovered(): void {
  logOverlayEvent({ event: 'overlay-recovered' });
}

export function logRestBlockStart(name: string, durationMs: number, strictMode: boolean): void {
  logOverlayEvent({ 
    event: 'rest-block-start', 
    phase: name, 
    remainingMs: durationMs,
    strictMode 
  });
}

export function logRestBlockTick(name: string, remainingMs: number): void {
  logOverlayEvent({ 
    event: 'rest-block-tick', 
    phase: name, 
    remainingMs 
  });
}

export function logRestBlockEnd(name: string, reason: string): void {
  logOverlayEvent({ 
    event: 'rest-block-end', 
    phase: name, 
    reason 
  });
}

export function logTrayCreated(): void {
  logTrayEvent({ event: 'tray-created' });
}

export function logTrayTooltipUpdated(phase: string, remainingMs: number): void {
  logTrayEvent({ event: 'tray-tooltip-updated', phase, remainingMs });
}

export function logTrayMenuRebuilt(reason: string): void {
  logTrayEvent({ event: 'tray-menu-rebuilt', reason });
}

export function logTrayMenuOpen(): void {
  logTrayEvent({ event: 'tray-menu-open' });
}

export function logTrayMenuClose(): void {
  logTrayEvent({ event: 'tray-menu-close' });
}

export function logTrayRefreshDeferred(): void {
  logTrayEvent({ event: 'tray-refresh-deferred' });
}

export function logTrayRefreshApplied(): void {
  logTrayEvent({ event: 'tray-refresh-applied' });
}
