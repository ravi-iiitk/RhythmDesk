/**
 * RhythmDesk Timer Engine
 * Core business logic for tracking work phases, breaks, and transitions
 * 
 * IMPORTANT RULES:
 * - Active work time = sit + stand phases ONLY
 * - Transitions, short breaks, long breaks do NOT count as work time
 * - Short/long breaks trigger based on cumulative work time thresholds
 * - Long break has highest priority, then short break, then transition
 * - Paused/postponed time does NOT count toward work time
 */

import { EventEmitter } from 'events';
import { powerMonitor } from 'electron';
import {
  Schedule,
  SessionState,
  PhaseType,
  TimerTick,
} from '../shared/types';
import { getOfficeFocusLockService } from './officeFocusLockService';
import { 
  minutesToMs, 
  secondsToMs, 
  getTodayDateString,
} from '../shared/timeUtils';
import { TIMER_TICK_INTERVAL_MS } from '../shared/constants';
import configService from './configService';
import { resolveActiveSchedule } from './scheduleResolver';
import logger from './logger';

const TIME_JUMP_THRESHOLD_MS = 5000; // 5 seconds - indicates sleep/wake or time jump
const STATE_SAVE_DEBOUNCE_MS = 5000; // Save state every 5 seconds max

export class TimerEngine extends EventEmitter {
  private state: SessionState;
  private currentSchedule: Schedule | null = null;
  private tickInterval: NodeJS.Timeout | null = null;
  private lastTickTime: number = 0;
  private lastStateSaveTime: number = 0;
  private stateChanged: boolean = false;
  // Track the phase we were in before a break interrupted
  private preBreakPhase: PhaseType | null = null;

  constructor() {
    super();
    this.state = configService.getSessionState();
    this.validateAndResetPostponeCount();
    this.recoverStateFromTimestamps();
    this.setupPowerMonitor();
  }

  /**
   * Setup power monitor for sleep/wake events
   */
  private setupPowerMonitor(): void {
    powerMonitor.on('suspend', () => {
      logger.info('TimerEngine', 'System suspending - saving state');
      this.saveStateImmediately();
    });

    powerMonitor.on('resume', () => {
      logger.info('TimerEngine', 'System resuming - recovering state');
      this.recoverStateFromTimestamps();
    });

    powerMonitor.on('lock-screen', () => {
      logger.debug('TimerEngine', 'Screen locked');
    });

    powerMonitor.on('unlock-screen', () => {
      logger.debug('TimerEngine', 'Screen unlocked - checking state');
      this.recoverStateFromTimestamps();
    });
  }

  /**
   * Recover state from persisted timestamps
   * Used after sleep/wake, time jumps, or app restart
   */
  private recoverStateFromTimestamps(): void {
    const now = Date.now();
    
    // Skip if idle
    if (this.state.currentPhase === 'idle') return;
    
    // If paused, nothing to recover
    if (this.state.isPaused) return;
    
    // If postponed, check if postpone has ended
    if (this.state.isPostponed && this.state.postponedUntil) {
      if (now >= this.state.postponedUntil) {
        this.state.isPostponed = false;
        this.state.postponedUntil = null;
        if (this.state.postponedPhase) {
          this.startPhase(this.state.postponedPhase);
        }
        this.state.postponedPhase = null;
        return;
      }
    }
    
    // Recalculate phase remaining from phaseEndsAt
    if (this.state.phaseEndsAt > 0) {
      const remaining = this.state.phaseEndsAt - now;
      if (remaining <= 0) {
        // Phase should have ended - advance
        logger.info('TimerEngine', 'Phase ended during sleep/wake - advancing', {
          phase: this.state.currentPhase,
          phaseEndsAt: this.state.phaseEndsAt,
          now,
        });
        this.advancePhase();
      } else {
        this.state.phaseRemainingMs = remaining;
      }
    }
  }

  /**
   * Reset postpone count if it's a new day
   */
  private validateAndResetPostponeCount(): void {
    const today = getTodayDateString();
    if (this.state.postponeResetDate !== today) {
      this.state.postponeCountToday = 0;
      this.state.postponeResetDate = today;
      this.saveState();
    }
  }

  /**
   * Start the timer engine
   */
  start(): void {
    if (this.tickInterval) return;
    
    logger.info('TimerEngine', 'Starting timer engine');
    this.lastTickTime = Date.now();
    this.lastStateSaveTime = Date.now();
    this.tickInterval = setInterval(() => this.tick(), TIMER_TICK_INTERVAL_MS);
    this.tick(); // Initial tick
  }

  /**
   * Stop the timer engine
   */
  stop(): void {
    logger.info('TimerEngine', 'Stopping timer engine');
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.saveStateImmediately();
  }

  /**
   * Main timer tick - called every second
   */
  private tick(): void {
    const now = Date.now();
    const deltaMs = now - this.lastTickTime;
    this.lastTickTime = now;

    // Detect time jump (sleep/wake or system time change)
    if (deltaMs > TIME_JUMP_THRESHOLD_MS) {
      logger.warn('TimerEngine', `Time jump detected: ${deltaMs}ms - recovering state`);
      this.recoverStateFromTimestamps();
    }

    this.validateAndResetPostponeCount();
    
    // Check for schedule changes
    this.checkScheduleChange();

    if (!this.currentSchedule) {
      this.setIdleState();
      this.emitTick();
      return;
    }

    // Handle postponed state
    if (this.state.isPostponed && this.state.postponedUntil) {
      if (now >= this.state.postponedUntil) {
        // Postpone ended, resume the postponed phase
        this.state.isPostponed = false;
        this.state.postponedUntil = null;
        if (this.state.postponedPhase) {
          this.startPhase(this.state.postponedPhase);
        }
        this.state.postponedPhase = null;
      } else {
        // Still postponed
        this.state.phaseRemainingMs = this.state.postponedUntil - now;
        this.emitTick();
        this.saveState();
        return;
      }
    }

    // Handle paused state
    if (this.state.isPaused) {
      if (this.state.pauseResumeAt && now >= this.state.pauseResumeAt) {
        this.resume();
      } else {
        this.emitTick();
        return;
      }
    }

    // Update phase remaining time
    this.state.phaseRemainingMs -= deltaMs;

    // Track cumulative work time (only for sit/stand phases)
    if (this.isWorkPhase(this.state.currentPhase)) {
      this.state.cumulativeWorkTimeMs += deltaMs;
    }

    // Check if current phase is complete
    if (this.state.phaseRemainingMs <= 0) {
      this.advancePhase();
    } else {
      // Check for break triggers based on cumulative work time
      this.checkBreakTriggers();
    }

    this.emitTick();
    this.saveState();
  }

  /**
   * Check if we need to switch to a different schedule
   */
  private checkScheduleChange(): void {
    const schedules = configService.getSchedules();
    const activeSchedule = resolveActiveSchedule(schedules);

    if (activeSchedule?.id !== this.currentSchedule?.id) {
      this.currentSchedule = activeSchedule;
      
      if (activeSchedule) {
        // Starting a new schedule
        this.state.activeScheduleId = activeSchedule.id;
        this.state.cumulativeWorkTimeMs = 0;
        this.state.lastShortBreakAtWorkTimeMs = 0;
        this.state.lastLongBreakAtWorkTimeMs = 0;
        this.startPhase('sit'); // Always start with sitting
      } else {
        this.setIdleState();
      }
      
      this.emit('scheduleChange', this.currentSchedule);
    }
  }

  /**
   * Check if a break should be triggered based on cumulative work time
   * Priority: long break > short break
   * RULE: Only trigger breaks during sit/stand phases, never during transitions
   */
  private checkBreakTriggers(): void {
    if (!this.currentSchedule) return;
    // Only trigger breaks during actual work phases (sit/stand), not transitions
    if (!this.isWorkPhase(this.state.currentPhase)) return;

    const workTimeMs = this.state.cumulativeWorkTimeMs;

    // Check long break first (highest priority)
    if (this.currentSchedule.longBreakEnabled) {
      const longBreakThreshold = minutesToMs(this.currentSchedule.longBreakEveryMinutes);
      const timeSinceLastLongBreak = workTimeMs - this.state.lastLongBreakAtWorkTimeMs;
      
      if (timeSinceLastLongBreak >= longBreakThreshold) {
        this.triggerBreak('long-break');
        return;
      }
    }

    // Check short break
    if (this.currentSchedule.shortBreakEnabled) {
      const shortBreakThreshold = minutesToMs(this.currentSchedule.shortBreakEveryMinutes);
      const timeSinceLastShortBreak = workTimeMs - this.state.lastShortBreakAtWorkTimeMs;
      
      if (timeSinceLastShortBreak >= shortBreakThreshold) {
        this.triggerBreak('short-break');
        return;
      }
    }
  }

  /**
   * Trigger a break, interrupting current phase
   * Stores current phase info to resume after break completes
   */
  private triggerBreak(breakType: 'short-break' | 'long-break'): void {
    // Store current phase to resume after break
    this.preBreakPhase = this.state.currentPhase;
    
    this.emit('breakDue', breakType);
    this.startPhase(breakType);
  }

  /**
   * Advance to the next phase when current phase completes
   */
  private advancePhase(): void {
    const prevPhase = this.state.currentPhase;
    let nextPhase: PhaseType;

    switch (prevPhase) {
      case 'sit':
        nextPhase = 'sit-to-stand-transition';
        break;
      case 'sit-to-stand-transition':
        nextPhase = 'stand';
        break;
      case 'stand':
        nextPhase = 'stand-to-sit-transition';
        break;
      case 'stand-to-sit-transition':
        nextPhase = 'sit';
        break;
      case 'short-break':
        this.state.lastShortBreakAtWorkTimeMs = this.state.cumulativeWorkTimeMs;
        // Resume to pre-break phase if we interrupted a work phase
        if (this.preBreakPhase && this.isWorkPhase(this.preBreakPhase)) {
          nextPhase = this.preBreakPhase;
        } else {
          nextPhase = 'sit';
        }
        this.preBreakPhase = null;
        break;
      case 'long-break':
        this.state.lastLongBreakAtWorkTimeMs = this.state.cumulativeWorkTimeMs;
        // After long break, always start fresh with sit
        // (Long break is a full reset point)
        nextPhase = 'sit';
        this.preBreakPhase = null;
        break;
      default:
        nextPhase = 'sit';
    }

    this.startPhase(nextPhase);
  }

  /**
   * Start a specific phase
   */
  private startPhase(phase: PhaseType): void {
    const prevPhase = this.state.currentPhase;
    const now = Date.now();
    const duration = this.getPhaseDurationMs(phase);
    
    this.state.currentPhase = phase;
    this.state.phaseStartedAt = now;
    this.state.phaseEndsAt = now + duration;
    this.state.phaseRemainingMs = duration;
    this.state.phaseTotalMs = duration;

    logger.info('TimerEngine', `Phase started: ${phase}`, {
      duration,
      endsAt: this.state.phaseEndsAt,
    });

    this.emit('phaseChange', { prevPhase, newPhase: phase });
    this.saveStateImmediately(); // Save immediately on phase change
  }

  /**
   * Get duration for a phase in milliseconds
   */
  private getPhaseDurationMs(phase: PhaseType): number {
    if (!this.currentSchedule) return 0;

    switch (phase) {
      case 'sit':
        return minutesToMs(this.currentSchedule.sitMinutes);
      case 'stand':
        return minutesToMs(this.currentSchedule.standMinutes);
      case 'sit-to-stand-transition':
        return secondsToMs(this.currentSchedule.sitToStandTransitionSeconds);
      case 'stand-to-sit-transition':
        return secondsToMs(this.currentSchedule.standToSitTransitionSeconds);
      case 'short-break':
        return minutesToMs(this.currentSchedule.shortBreakDurationMinutes);
      case 'long-break':
        return minutesToMs(this.currentSchedule.longBreakDurationMinutes);
      default:
        return 0;
    }
  }

  /**
   * Check if phase counts as active work time
   */
  private isWorkPhase(phase: PhaseType): boolean {
    return phase === 'sit' || phase === 'stand';
  }

  /**
   * Set idle state when no schedule is active
   */
  private setIdleState(): void {
    this.state.activeScheduleId = null;
    this.state.currentPhase = 'idle';
    this.state.phaseStartedAt = 0;
    this.state.phaseEndsAt = 0;
    this.state.phaseRemainingMs = 0;
    this.state.phaseTotalMs = 0;
  }

  /**
   * Get the next phase after current (for display purposes)
   */
  getNextPhase(): PhaseType {
    if (!this.currentSchedule) return 'idle';

    switch (this.state.currentPhase) {
      case 'sit':
        return 'sit-to-stand-transition';
      case 'sit-to-stand-transition':
        return 'stand';
      case 'stand':
        return 'stand-to-sit-transition';
      case 'stand-to-sit-transition':
        return 'sit';
      case 'short-break':
      case 'long-break':
        return 'sit';
      default:
        return 'idle';
    }
  }

  /**
   * Pause the timer
   */
  pause(): void {
    if (this.state.isPaused) return;
    this.state.isPaused = true;
    this.state.pausedAt = Date.now();
    this.state.pauseResumeAt = null;
    this.saveState();
  }

  /**
   * Pause for a specific duration in minutes
   */
  pauseForDuration(minutes: number): void {
    if (this.state.isPaused) return;
    this.state.isPaused = true;
    this.state.pausedAt = Date.now();
    this.state.pauseResumeAt = Date.now() + minutesToMs(minutes);
    this.saveState();
  }

  /**
   * Resume from pause
   */
  resume(): void {
    if (!this.state.isPaused) return;
    this.state.isPaused = false;
    this.state.pausedAt = null;
    this.state.pauseResumeAt = null;
    this.saveState();
  }

  /**
   * Postpone current phase
   */
  postpone(minutes: number): boolean {
    if (!this.currentSchedule) return false;
    if (!this.currentSchedule.allowPostpone) return false;
    if (this.state.postponeCountToday >= this.currentSchedule.maxPostponesPerDay) {
      return false;
    }

    this.state.isPostponed = true;
    this.state.postponedUntil = Date.now() + minutesToMs(minutes);
    this.state.postponedPhase = this.state.currentPhase;
    this.state.postponeCountToday++;
    this.saveState();

    // Emit event so main process can close overlay
    this.emit('postponed', { minutes, phase: this.state.postponedPhase });

    return true;
  }

  /**
   * Skip the current phase (if allowed)
   */
  skipPhase(): void {
    if (!this.currentSchedule) return;
    // Only allow skipping non-strict mode or non-work phases
    if (this.currentSchedule.strictModeEnabled && this.isWorkPhase(this.state.currentPhase)) {
      return;
    }
    this.advancePhase();
  }

  /**
   * Complete current phase (user acknowledges they're done)
   */
  completePhase(): void {
    this.advancePhase();
  }

  /**
   * Emit tick event with current state
   */
  private emitTick(): void {
    const officeFocusLockService = getOfficeFocusLockService();
    
    const tick: TimerTick = {
      scheduleId: this.currentSchedule?.id || null,
      scheduleName: this.currentSchedule?.name || null,
      currentPhase: this.state.currentPhase,
      phaseRemainingMs: this.state.phaseRemainingMs,
      phaseTotalMs: this.state.phaseTotalMs,
      nextPhase: this.getNextPhase(),
      cumulativeWorkTimeMs: this.state.cumulativeWorkTimeMs,
      isPaused: this.state.isPaused,
      isPostponed: this.state.isPostponed,
      postponeCountToday: this.state.postponeCountToday,
      maxPostponesPerDay: this.currentSchedule?.maxPostponesPerDay || 0,
      canPostpone: this.canPostpone(),
      postponeOptions: this.currentSchedule?.postponeOptionsMinutes || [],
      isStrictMode: this.currentSchedule?.strictModeEnabled || false,
      officeFocusLock: officeFocusLockService.getState(),
    };

    this.emit('tick', tick);
  }

  /**
   * Check if postpone is currently allowed
   */
  canPostpone(): boolean {
    if (!this.currentSchedule) return false;
    if (!this.currentSchedule.allowPostpone) return false;
    if (this.state.postponeCountToday >= this.currentSchedule.maxPostponesPerDay) return false;
    if (this.state.isPostponed) return false;
    return true;
  }

  /**
   * Get current state (for IPC)
   */
  getState(): SessionState {
    return { ...this.state };
  }

  /**
   * Get current schedule
   */
  getCurrentSchedule(): Schedule | null {
    return this.currentSchedule;
  }

  /**
   * Save state to persistence (debounced)
   */
  private saveState(): void {
    this.stateChanged = true;
    const now = Date.now();
    
    // Debounce: only save if enough time has passed
    if (now - this.lastStateSaveTime >= STATE_SAVE_DEBOUNCE_MS) {
      this.saveStateImmediately();
    }
  }

  /**
   * Save state immediately (bypass debounce)
   */
  private saveStateImmediately(): void {
    if (this.stateChanged || true) { // Always save for reliability
      configService.saveSessionState(this.state);
      this.lastStateSaveTime = Date.now();
      this.stateChanged = false;
    }
  }
}

// Singleton instance
let timerEngineInstance: TimerEngine | null = null;

export function getTimerEngine(): TimerEngine {
  if (!timerEngineInstance) {
    timerEngineInstance = new TimerEngine();
  }
  return timerEngineInstance;
}

export default getTimerEngine;
