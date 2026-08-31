/**
 * FocusSessionService
 *
 * Detects when a schedule's FocusSession time-window is active and emits
 * 'started' / 'ended' events.  The actual window-lockdown is handled in
 * main/focusLockdown.ts; this service only concerns itself with time logic.
 *
 * Events:
 *   'started'  (session: FocusSession, endsAtMs: number)
 *   'ended'    (session: FocusSession)
 */

import { EventEmitter } from 'events';
import { FocusSession, Schedule } from '../shared/types';
import logger from './logger';

export class FocusSessionService extends EventEmitter {
  private activeSession: FocusSession | null = null;

  /**
   * Call every ~30 s (or on schedule change) to update the active session.
   * Returns true if a focus session is currently active.
   */
  check(schedule: Schedule | null, now: number = Date.now()): boolean {
    const sessions = schedule?.focusSessions ?? [];

    const candidate = sessions.length > 0
      ? this.findActive(sessions, now)
      : null;

    if (candidate) {
      if (!this.activeSession || this.activeSession.id !== candidate.id) {
        if (this.activeSession) {
          const prev = this.activeSession;
          this.activeSession = null;
          logger.info('FocusSession', 'Session ended (superseded)', { id: prev.id, name: prev.name });
          this.emit('ended', prev);
        }
        this.activeSession = candidate;
        const endsAtMs = this.computeEndMs(candidate, now);
        logger.info('FocusSession', 'Session started', {
          id: candidate.id,
          name: candidate.name,
          endsAt: new Date(endsAtMs).toISOString(),
        });
        this.emit('started', candidate, endsAtMs);
      }
      return true;
    }

    if (this.activeSession) {
      const prev = this.activeSession;
      this.activeSession = null;
      logger.info('FocusSession', 'Session ended', { id: prev.id, name: prev.name });
      this.emit('ended', prev);
    }
    return false;
  }

  /**
   * Force-end the active session (e.g. schedule deactivated).
   */
  forceEnd(): void {
    if (!this.activeSession) return;
    const prev = this.activeSession;
    this.activeSession = null;
    logger.info('FocusSession', 'Session force-ended', { id: prev.id });
    this.emit('ended', prev);
  }

  isActive(): boolean {
    return !!this.activeSession;
  }

  getActiveSession(): FocusSession | null {
    return this.activeSession;
  }

  /** ms remaining until the active session ends; null if no session is active */
  getTimeUntilEndMs(now: number = Date.now()): number | null {
    if (!this.activeSession) return null;
    return Math.max(0, this.computeEndMs(this.activeSession, now) - now);
  }

  computeEndMs(session: FocusSession, now: number): number {
    const date = new Date(now);
    const [h, m] = session.endTime.split(':').map(Number);
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      h,
      m,
      0,
      0,
    ).getTime();
  }

  // ---------------------------------------------------------------------------

  private findActive(sessions: FocusSession[], now: number): FocusSession | null {
    const date = new Date(now);
    const dow = date.getDay(); // 0 = Sun
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const timeStr = `${hh}:${mm}`;

    for (const s of sessions) {
      if (!s.enabled) continue;
      if (s.daysOfWeek.length > 0 && !s.daysOfWeek.includes(dow)) continue;
      if (timeStr >= s.startTime && timeStr < s.endTime) return s;
    }
    return null;
  }
}

let instance: FocusSessionService | null = null;

export function getFocusSessionService(): FocusSessionService {
  if (!instance) instance = new FocusSessionService();
  return instance;
}
