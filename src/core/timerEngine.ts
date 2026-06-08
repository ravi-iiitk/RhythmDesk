/**
 * RhythmDesk Timer Engine
 * Core business logic for tracking work phases, breaks, and transitions
 * 
 * IMPORTANT RULES:
 * - Cumulative work time = sit + stand + transitions + short breaks
 * - Only long breaks reset cumulative work time
 * - Long breaks trigger based on cumulative work time threshold
 * - Long break has highest priority, then short break, then transition
 * - Paused/postponed time does NOT count toward cumulative time
 */

import { EventEmitter } from 'events';
import { powerMonitor } from 'electron';
import {
  Schedule,
  SessionState,
  PhaseType,
  TimerTick,
  BreakType,
  BreakProgress,
  ConfiguredDurations,
  FlowStep,
  INITIAL_BREAK_SKIP_COUNTS,
  INITIAL_POSTPONE_COUNTS,
  computeFlowConfigHash,
} from '../shared/types';
import { getOfficeFocusLockService } from './officeFocusLockService';
import { getRestBlockService } from './restBlockService';
import { 
  minutesToMs, 
  secondsToMs, 
  getTodayDateString,
} from '../shared/timeUtils';
import { TIMER_TICK_INTERVAL_MS, SIMULATE_MODE_SPEED } from '../shared/constants';
import configService from './configService';
import { resolveActiveSchedule } from './scheduleResolver';
import { phaseToBreakType, getMaxPostponesForBreakType } from './overlayPolicy';
import logger from './logger';
import { 
  isFlowBasedSchedule, 
  getFlowStepDurationMs,
} from './flowUtils';
import {
  TransitionType,
  computeNextFlowPhase,
  computeThenFlowPhase,
  computeNextRuleBasedPhase,
  computeThenRuleBasedPhase,
  computeResetState,
  isBreakPhase,
  findFirstWorkPhaseIndex,
  findPhaseIndex,
  isValidFlowIndex,
  logTransition,
} from './transitions';
import {
  BreakPhaseType,
  BreakState,
  resolveBreakConflict,
  shouldClearPendingOnBreakEntry,
  shouldSkipFlowBreakStep,
  isBreakPhase as isBreakPhaseType,
} from './breakConflict';
import {
  validateSessionState,
  normalizeSessionState,
  logValidationResult,
} from './sessionValidator';
import {
  logSessionEvent,
  normalizeFlowIndex,
  validateRuntimeState,
  attemptSafeRecovery,
  createDebugSnapshot,
} from './sessionDebug';
import {
  checkRuntimeInvariants,
  validateTransitionPreconditions,
  logInvariantViolations,
  TransitionContext,
} from './runtimeInvariants';
import { trace } from './traceLogger';
import { getPhaseDisplayLabel } from './displayLabels';

const TIME_JUMP_THRESHOLD_MS = 5000; // 5 seconds - indicates sleep/wake or time jump
const STATE_SAVE_DEBOUNCE_MS = 5000; // Save state every 5 seconds max

export class TimerEngine extends EventEmitter {
  private state: SessionState;
  private currentSchedule: Schedule | null = null;
  private lastEmittedTick: TimerTick | null = null;
  private tickInterval: NodeJS.Timeout | null = null;
  private lastTickTime: number = 0;
  private lastStateSaveTime: number = 0;
  private stateChanged: boolean = false;
  // Track the phase we were in before a break interrupted
  private preBreakPhase: PhaseType | null = null;
  
  // PHASE 1.5: Frozen flow snapshot for active runtime
  // This prevents config edits from leaking into active session
  // Only updated on session start or explicit reset
  private runtimeFlowSnapshot: FlowStep[] | null = null;
  
  // Pause reminder: tracks when the last pause reminder was shown
  private pauseReminderLastShownAt: number = 0;
  private static readonly PAUSE_REMINDER_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * PHASE 1.5: Get the runtime flow steps (frozen snapshot)
   * Returns the frozen snapshot if available, otherwise falls back to config
   * This ensures config edits don't affect active runtime until reset
   */
  private getRuntimeFlowSteps(): FlowStep[] | undefined {
    // Use frozen snapshot if available
    if (this.runtimeFlowSnapshot && this.runtimeFlowSnapshot.length > 0) {
      return this.runtimeFlowSnapshot;
    }
    // Fall back to schedule config (for recovery/initial state)
    return this.currentSchedule?.flowSteps;
  }

  /**
   * PHASE 1.5: Freeze the current flow config as runtime snapshot
   * Called when session starts or is explicitly reset
   */
  private freezeFlowSnapshot(): void {
    if (this.currentSchedule && isFlowBasedSchedule(this.currentSchedule)) {
      // Deep copy to prevent mutation
      this.runtimeFlowSnapshot = JSON.parse(JSON.stringify(this.currentSchedule.flowSteps));
      logger.info('TimerEngine', 'Flow snapshot frozen', {
        stepCount: this.runtimeFlowSnapshot?.length,
        hash: this.runtimeFlowSnapshot ? computeFlowConfigHash(this.runtimeFlowSnapshot) : undefined,
      });
    } else {
      this.runtimeFlowSnapshot = null;
    }
  }

  /**
   * ARCHITECTURE HARDENING: Create transition context for invariant checks
   */
  private getTransitionContext(): TransitionContext {
    return {
      schedule: this.currentSchedule,
      runtimeFlowSnapshot: this.runtimeFlowSnapshot,
    };
  }

  /**
   * ARCHITECTURE HARDENING: Validate current state against runtime invariants
   * Called before committing state changes to prevent invalid states
   */
  private validateStateInvariants(label: string): boolean {
    const context = this.getTransitionContext();
    const result = checkRuntimeInvariants(this.state, context);
    
    if (!result.valid) {
      logInvariantViolations(result.violations, label);
      return false;
    }
    
    return true;
  }

  /**
   * ARCHITECTURE HARDENING: Validate preconditions before transition
   */
  private canPerformTransition(transitionType: string): { allowed: boolean; reason?: string } {
    const context = this.getTransitionContext();
    const result = validateTransitionPreconditions(transitionType, this.state, context);
    
    if (!result.valid) {
      logger.debug('TimerEngine', `Transition ${transitionType} blocked`, {
        failedPreconditions: result.failedPreconditions,
      });
      return { allowed: false, reason: result.failedPreconditions[0] };
    }
    
    return { allowed: true };
  }

  constructor() {
    super();
    this.state = configService.getSessionState();
    this.validateAndResetDailyCounters();
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
   * 
   * RECOVERY BEHAVIOR:
   * - Validates session state against current schedule
   * - Normalizes any inconsistencies (flow index, postpone state, etc.)
   * - Handles stale phases (>5 min old) by resetting to idle
   * - Preserves postponed breaks correctly
   */
  private recoverStateFromTimestamps(): void {
    const now = Date.now();
    
    // Phase 1.5: Log recovery start
    logSessionEvent({
      event: 'restartRecovery',
      phase: this.state.currentPhase,
      index: this.state.currentFlowStepIndex,
      pendingBreak: this.state.postponedPhase,
      postponeUntil: this.state.postponedUntil,
      cumulativeWorkMs: this.state.cumulativeWorkTimeMs,
      scheduleId: this.state.activeScheduleId,
    });
    
    // Skip if idle
    if (this.state.currentPhase === 'idle') return;
    
    // If paused, nothing to recover
    if (this.state.isPaused) return;

    // If waiting for user to start next activity, nothing to recover
    // phaseEndsAt is stale (from the completed phase) - don't let it trigger a reset
    if (this.state.isWaitingForNextActivity) return;
    
    // Validate and normalize state first
    const schedules = configService.getSchedules();
    const activeSchedule = this.state.activeScheduleId 
      ? schedules.find(s => s.id === this.state.activeScheduleId) 
      : null;
    
    // Validate state
    const validation = validateSessionState(this.state, activeSchedule ?? null);
    if (!validation.valid || validation.warnings.length > 0) {
      logValidationResult(validation, 'Recovery - before normalization');
      
      // Normalize state to fix inconsistencies
      const normalized = normalizeSessionState(this.state, activeSchedule ?? null);
      if (normalized.changed) {
        this.state = normalized.state;
        logger.info('TimerEngine', 'Recovery: normalized state', { changes: normalized.changes });
      }
    }
    
    // Verify flow index is valid for flow-based schedules
    if (activeSchedule && isFlowBasedSchedule(activeSchedule)) {
      const flowSteps = activeSchedule.flowSteps!;
      if (!isValidFlowIndex(this.state.currentFlowStepIndex, flowSteps)) {
        logger.warn('TimerEngine', 'Recovery: invalid flow index, resyncing');
        const correctIndex = findPhaseIndex(flowSteps, this.state.currentPhase);
        this.state.currentFlowStepIndex = correctIndex !== -1 ? correctIndex : findFirstWorkPhaseIndex(flowSteps);
      }
      
      // PHASE 1.5: Initialize runtime flow snapshot on recovery
      // Use the session's flowConfigHash to determine if we need fresh snapshot
      if (!this.runtimeFlowSnapshot) {
        this.currentSchedule = activeSchedule;
        this.freezeFlowSnapshot();
        logger.info('TimerEngine', 'Recovery: initialized runtime flow snapshot');
      }
    }
    
    // If postponed, check if postpone has ended
    if (this.state.isPostponed && this.state.postponedUntil) {
      if (now >= this.state.postponedUntil) {
        logTransition(TransitionType.POSTPONE_ENDED, {
          postponedPhase: this.state.postponedPhase,
        });
        
        this.state.isPostponed = false;
        this.state.postponedUntil = null;
        if (this.state.postponedPhase) {
          this.startPhase(this.state.postponedPhase);
        }
        this.state.postponedPhase = null;
        this.state.postponedBreakType = null;
        return;
      }
    }
    
    // Recalculate phase remaining from phaseEndsAt
    if (this.state.phaseEndsAt > 0) {
      const remaining = this.state.phaseEndsAt - now;
      const timeSincePhaseEnded = -remaining;
      
      if (remaining <= 0) {
        // Phase ended - check how long ago
        // If it ended more than 5 minutes ago, reset session instead of advancing
        // This prevents weird state after app restart with stale state
        const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
        
        if (timeSincePhaseEnded > STALE_THRESHOLD_MS) {
          const prevPhase = this.state.currentPhase;
          logger.info('TimerEngine', 'Phase ended long ago - resetting to idle', {
            phase: prevPhase,
            phaseEndsAt: this.state.phaseEndsAt,
            timeSinceEndedMs: timeSincePhaseEnded,
          });
          // Reset to fresh state - will be handled by checkScheduleChange in first tick
          this.state.currentPhase = 'idle';
          this.state.phaseEndsAt = 0;
          this.state.phaseRemainingMs = 0;
          this.state.currentFlowStepIndex = undefined;
          this.saveState();
          // Emit phaseChange so main.ts closes the overlay
          // Without this, a stale overlay stays visible with no backing timer
          this.emit('phaseChange', { prevPhase, newPhase: 'idle' });
          this.emitTick();
        } else {
          // Phase ended recently - advance normally
          logger.info('TimerEngine', 'Phase ended during sleep/wake - advancing', {
            phase: this.state.currentPhase,
            phaseEndsAt: this.state.phaseEndsAt,
            now,
          });
          this.advancePhase();
        }
      } else {
        this.state.phaseRemainingMs = remaining;
      }
    }
  }

  /**
   * Reset daily counters (postpones and break counts) if it's a new day
   */
  private validateAndResetDailyCounters(): void {
    const today = getTodayDateString();
    let changed = false;

    // Ensure skip counters exist (migration safety)
    if (!this.state.breakSkipCountsToday) {
      this.state.breakSkipCountsToday = { ...INITIAL_BREAK_SKIP_COUNTS };
      changed = true;
    }
    
    // Reset postpone counts
    if (this.state.postponeResetDate !== today) {
      this.state.postponeCountsToday = { ...INITIAL_POSTPONE_COUNTS };
      this.state.postponeResetDate = today;
      changed = true;
    }
    
    // Reset break counts
    if ((this.state.breakCountResetDate ?? '') !== today) {
      this.state.shortBreakCountToday = 0;
      this.state.longBreakCountToday = 0;
      this.state.breakSkipCountsToday = { ...INITIAL_BREAK_SKIP_COUNTS };
      this.state.breakCountResetDate = today;
      changed = true;
    }
    
    if (changed) {
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
   * Get the effective delta time, applying simulate mode speed if enabled
   */
  private getEffectiveDelta(realDeltaMs: number): number {
    const settings = configService.getGeneralSettings();
    if (settings.simulateMode) {
      return realDeltaMs * SIMULATE_MODE_SPEED;
    }
    return realDeltaMs;
  }

  /**
   * Main timer tick - called every second
   * Wrapped in try-catch to prevent interval from stopping on exception
   */
  private tick(): void {
    try {
      this.tickInternal();
    } catch (error) {
      // CRITICAL: Log but don't crash - keep the timer running
      logger.error('TimerEngine', 'Exception in tick - timer continues', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }
  
  /**
   * Internal tick implementation
   */
  private tickInternal(): void {
    const now = Date.now();
    const realDeltaMs = now - this.lastTickTime;
    this.lastTickTime = now;

    // Detect time jump (sleep/wake or system time change)
    if (realDeltaMs > TIME_JUMP_THRESHOLD_MS) {
      logger.warn('TimerEngine', `Time jump detected: ${realDeltaMs}ms - recovering state`);
      this.recoverStateFromTimestamps();
      // CRITICAL: Return early after recovery. The stale deltaMs from the
      // time jump must NOT be applied to the already-recovered state.
      // Without this, the recovered phaseRemainingMs gets the huge delta
      // subtracted, causing double-advance or corrupt timer state (stuck at 0:00).
      this.lastTickTime = Date.now();
      this.emitTick();
      this.saveState();
      return;
    }

    // Apply simulate mode speed multiplier
    const deltaMs = this.getEffectiveDelta(realDeltaMs);

    this.validateAndResetDailyCounters();
    
    // Check for schedule changes
    this.checkScheduleChange();

    if (!this.currentSchedule) {
      this.setIdleState();
      this.emitTick();
      return;
    }

    // CRITICAL: Handle paused state FIRST - before any other logic
    // This prevents postponed breaks from triggering during Rest Blocks
    // which caused flow state desync and renderer crashes
    if (this.state.isPaused) {
      if (this.state.pauseResumeAt && now >= this.state.pauseResumeAt) {
        this.resume();
      } else {
        // Check if it's time to show a pause reminder (every 5 minutes)
        if (this.state.pausedAt && now - this.pauseReminderLastShownAt >= TimerEngine.PAUSE_REMINDER_INTERVAL_MS) {
          this.pauseReminderLastShownAt = now;
          const pausedForMs = now - this.state.pausedAt;
          logger.info('TimerEngine', 'Pause reminder triggered', { pausedForMs });
          this.emit('pauseReminder', { pausedForMs, pausedAt: this.state.pausedAt });
        }
        // Timer is paused - emit tick for UI updates but don't process any timers
        this.emitTick();
        return;
      }
    }

    // Handle waiting-for-next-activity state (autoStartNextActivity=false)
    // Timer holds here - emit tick for UI updates but don't advance
    if (this.state.isWaitingForNextActivity) {
      this.emitTick();
      return;
    }

    // Handle postponed break - WORK CONTINUES during postpone!
    // Check if postponed break should now trigger
    // NOTE: This MUST come after pause check to prevent breaks during Rest Blocks
    if (this.state.isPostponed && this.state.postponedUntil) {
      if (now >= this.state.postponedUntil) {
        // Postpone period ended - trigger the pending break with overlay
        const pendingBreak = this.state.postponedPhase;
        
        // Clear postpone state BEFORE starting break
        this.state.isPostponed = false;
        this.state.postponedUntil = null;
        this.state.postponedPhase = null;
        this.state.postponedBreakType = null;
        
        // Store current work phase so we can resume after break
        if (this.isWorkPhase(this.state.currentPhase)) {
          this.state.interruptedPhase = this.state.currentPhase;
          this.state.interruptedPhaseRemainingMs = this.state.phaseRemainingMs;
          this.preBreakPhase = this.state.currentPhase;
        }
        
        if (pendingBreak) {
          logger.info('TimerEngine', `Postponed break triggering: ${pendingBreak}`);
          // FIX: Restore flow index to the break step BEFORE startPhase so that
          // getPhaseDurationMs reads the correct duration from the flow step,
          // not the rule-based fallback (which defaults to 5 min).
          if (isFlowBasedSchedule(this.currentSchedule!) && this.currentSchedule!.flowSteps) {
            const breakIndex = findPhaseIndex(this.currentSchedule!.flowSteps, pendingBreak);
            if (breakIndex !== -1) {
              this.state.currentFlowStepIndex = breakIndex;
            }
          }
          // Start the break - this will trigger phaseChange event which shows overlay
          this.startPhase(pendingBreak);
          this.emitTick();
          this.saveState();
          return;
        }
      }
      // If still in postpone period, work continues normally (fall through to normal tick logic)
    }

    // Update phase remaining time
    this.state.phaseRemainingMs -= deltaMs;

    // Track cumulative work time for long break triggers
    // Includes: sit, stand, transitions, short breaks (all count toward long break threshold)
    if (this.countsToCumulativeWorkTime(this.state.currentPhase)) {
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
   * Also refreshes schedule config if the same schedule was edited
   */
  private checkScheduleChange(): void {
    const schedules = configService.getSchedules();
    const activeSchedule = resolveActiveSchedule(schedules);

    if (activeSchedule?.id !== this.currentSchedule?.id) {
      // Schedule changed completely (different ID or became null/active)
      const prevPhase = this.state.currentPhase;
      this.currentSchedule = activeSchedule;
      
      if (activeSchedule) {
        // Starting a new schedule
        this.state.activeScheduleId = activeSchedule.id;
        this.state.cumulativeWorkTimeMs = 0;
        this.state.lastShortBreakAtWorkTimeMs = 0;
        this.state.lastLongBreakAtWorkTimeMs = 0;
        
        // Initialize flow step index for flow-based schedules
        if (isFlowBasedSchedule(activeSchedule)) {
          this.state.currentFlowStepIndex = 0;
          this.state.flowConfigHash = computeFlowConfigHash(activeSchedule.flowSteps);
          // PHASE 1.5: Freeze flow snapshot for active runtime
          this.freezeFlowSnapshot();
          const firstStep = activeSchedule.flowSteps![0];
          this.startPhase(firstStep.type);
        } else {
          this.state.currentFlowStepIndex = undefined;
          this.state.flowConfigHash = undefined;
          this.runtimeFlowSnapshot = null;
          this.startPhase('sit'); // Rule-based: always start with sitting
        }
      } else {
        // CRITICAL FIX: When schedule ends (becomes null), emit phaseChange
        // so the overlay is properly closed. This prevents blank overlay freeze.
        this.setIdleState();
        this.emit('phaseChange', { prevPhase, newPhase: 'idle' });
        logger.info('TimerEngine', 'Schedule ended - emitting phaseChange to close overlay', { prevPhase });
      }
      
      this.emit('scheduleChange', this.currentSchedule);
    } else if (activeSchedule && this.currentSchedule) {
      // Same schedule ID - config might have been edited
      if (
        isFlowBasedSchedule(activeSchedule) &&
        isFlowBasedSchedule(this.currentSchedule) &&
        activeSchedule.flowSteps &&
        this.currentSchedule.flowSteps
      ) {
        // ALL config changes (duration or order) require Reset to apply.
        // We intentionally do NOT update this.currentSchedule here — keeping it frozen
        // ensures the dashboard shows consistent values (both total and countdown from state).
        // isFlowSessionStale() compares against live disk config to detect changes and show banner.
      } else if (!isFlowBasedSchedule(activeSchedule)) {
        // Rule-based: no flow snapshot is involved, safe to always apply live config
        this.currentSchedule = activeSchedule;
      }
    }
  }
  
  /**
   * Check if the current flow-based session is stale (flow config changed since session started)
   * Compares the frozen session hash against the LIVE DISK CONFIG to detect any changes.
   */
  isFlowSessionStale(): boolean {
    if (!this.currentSchedule || !isFlowBasedSchedule(this.currentSchedule)) {
      return false;
    }
    const sessionHash = this.state.flowConfigHash;
    if (sessionHash === undefined) {
      return false;
    }
    // Compare against live config from disk, not frozen this.currentSchedule
    const schedules = configService.getSchedules();
    const activeSchedule = resolveActiveSchedule(schedules);
    if (!activeSchedule || !isFlowBasedSchedule(activeSchedule) || !activeSchedule.flowSteps) {
      return false;
    }
    const diskHash = computeFlowConfigHash(activeSchedule.flowSteps);
    return sessionHash !== diskHash;
  }

  /**
   * Check if a break should be triggered based on cumulative work time
   * Priority: long break > short break
   * RULE: Only trigger breaks during sit/stand phases, never during transitions
   * NOTE: In flow-based mode, only long breaks are triggered as interrupts
   *       (short breaks are part of the configured flow)
   */
  private checkBreakTriggers(): void {
    if (!this.currentSchedule) return;
    // Only trigger breaks during actual work phases (sit/stand), not transitions
    if (!this.isWorkPhase(this.state.currentPhase)) return;
    // Don't trigger new breaks if there's already a postponed break pending
    if (this.state.isPostponed && this.state.postponedPhase) return;

    const workTimeMs = this.state.cumulativeWorkTimeMs;
    const schedule = this.currentSchedule;
    const isFlowMode = isFlowBasedSchedule(schedule);

    // Check long break first (highest priority) - works in both modes
    const longBreakEnabled = schedule.longBreak?.enabled ?? schedule.longBreakEnabled ?? false;
    if (longBreakEnabled) {
      const longBreakEvery = schedule.longBreak?.everyMinutes ?? schedule.longBreakEveryMinutes ?? 150;
      const longBreakThreshold = minutesToMs(longBreakEvery);
      const timeSinceLastLongBreak = workTimeMs - this.state.lastLongBreakAtWorkTimeMs;
      
      if (timeSinceLastLongBreak >= longBreakThreshold) {
        this.triggerBreak('long-break');
        return;
      }
    }

    // Check short break - only in rule-based mode
    // In flow-based mode, short breaks are part of the configured flow
    if (!isFlowMode) {
      const shortBreakEnabled = schedule.shortBreak?.enabled ?? schedule.shortBreakEnabled ?? false;
      if (shortBreakEnabled) {
        const shortBreakEvery = schedule.shortBreak?.everyMinutes ?? schedule.shortBreakEveryMinutes ?? 60;
        const shortBreakThreshold = minutesToMs(shortBreakEvery);
        const timeSinceLastShortBreak = workTimeMs - this.state.lastShortBreakAtWorkTimeMs;
        
        if (timeSinceLastShortBreak >= shortBreakThreshold) {
          this.triggerBreak('short-break');
          return;
        }
      }
    }
  }

  /**
   * Get current break state for conflict resolution
   */
  private getBreakState(): BreakState {
    const activeBreak = isBreakPhaseType(this.state.currentPhase) 
      ? this.state.currentPhase as BreakPhaseType 
      : null;
    const pendingBreak = this.state.isPostponed && this.state.postponedPhase
      ? (isBreakPhaseType(this.state.postponedPhase) ? this.state.postponedPhase as BreakPhaseType : null)
      : null;
    
    return {
      activeBreak,
      pendingBreak,
      pendingBreakDueAt: this.state.postponedUntil,
    };
  }

  /**
   * Trigger a break, interrupting current phase
   * Stores current phase info to resume after break completes
   * 
   * BREAK CONFLICT POLICY:
   * - Check for conflicts before triggering
   * - Long break supersedes short break
   * - Don't stack duplicate breaks
   * 
   * PHASE 1.5 FIX: Also stores interrupted flow index for proper restoration
   */
  private triggerBreak(breakType: 'short-break' | 'long-break'): void {
    // BREAK CONFLICT RESOLUTION: Check for conflicts before triggering
    const breakState = this.getBreakState();
    const resolution = resolveBreakConflict(breakState, breakType);
    
    logger.info('TimerEngine', 'Break conflict resolution', {
      breakType,
      resolution: resolution.action,
      reason: resolution.reason,
      activeBreak: breakState.activeBreak,
      pendingBreak: breakState.pendingBreak,
    });
    
    // Handle resolution
    switch (resolution.action) {
      case 'skip':
      case 'merge':
        // Don't trigger the break - conflict exists
        logger.info('TimerEngine', `Skipping ${breakType}: ${resolution.reason}`);
        return;
        
      case 'replace':
        // Replace pending break with higher priority break
        if (resolution.shouldClearPending) {
          logger.info('TimerEngine', `Replacing pending ${breakState.pendingBreak} with ${breakType}`);
          this.state.isPostponed = false;
          this.state.postponedPhase = null;
          this.state.postponedUntil = null;
          this.state.postponedBreakType = null;
        }
        break;
        
      case 'allow':
        // No conflict, proceed normally
        break;
    }
    
    // Store current phase to resume after break
    this.preBreakPhase = this.state.currentPhase;
    this.state.interruptedPhase = this.state.currentPhase;
    this.state.interruptedPhaseRemainingMs = this.state.phaseRemainingMs;
    
    // PHASE 1.5: Track interrupted flow index for flow-based schedules
    // This ensures we can restore the correct flow position after break/postpone
    if (isFlowBasedSchedule(this.currentSchedule)) {
      this.state.interruptedFlowIndex = this.state.currentFlowStepIndex;
    }
    
    // Phase 1.5: Log break start
    logSessionEvent({
      event: 'breakStart',
      phase: breakType,
      fromPhase: this.state.currentPhase,
      cumulativeWorkMs: this.state.cumulativeWorkTimeMs,
      index: this.state.currentFlowStepIndex,
      interruptedIndex: this.state.interruptedFlowIndex,
      scheduleId: this.currentSchedule?.id,
    });
    
    // Increment break count
    if (breakType === 'short-break') {
      this.state.shortBreakCountToday = (this.state.shortBreakCountToday ?? 0) + 1;
    } else {
      this.state.longBreakCountToday = (this.state.longBreakCountToday ?? 0) + 1;
    }
    this.stateChanged = true;
    
    this.emit('breakDue', breakType);
    this.startPhase(breakType);
  }

  /**
   * Advance to the next phase when current phase completes
   */
  private advancePhase(): void {
    const prevPhase = this.state.currentPhase;
    const prevIndex = this.state.currentFlowStepIndex;
    
    // Handle flow-based mode
    if (isFlowBasedSchedule(this.currentSchedule)) {
      this.advanceFlowBasedPhase(prevPhase);
    } else {
      // Rule-based mode (existing behavior)
      this.advanceRuleBasedPhase(prevPhase);
    }
    
    // Phase 1.5: Log phase transition
    logSessionEvent({
      event: 'phaseTransition',
      fromPhase: prevPhase,
      toPhase: this.state.currentPhase,
      indexBefore: prevIndex,
      indexAfter: this.state.currentFlowStepIndex,
      next: this.getNextPhase(),
      cumulativeWorkMs: this.state.cumulativeWorkTimeMs,
      scheduleId: this.currentSchedule?.id,
    });
  }
  
  /**
   * Advance phase in flow-based mode
   * 
   * Uses transition model for computing next phase to ensure consistency.
   * INVARIANT: After this method, currentPhase MUST match flowSteps[currentFlowStepIndex].type
   * 
   * PHASE 1.5: Uses getRuntimeFlowSteps() to use frozen snapshot, not live config
   */
  private advanceFlowBasedPhase(prevPhase: PhaseType): void {
    // PHASE 1.5: Use runtime flow snapshot instead of live config
    const flowSteps = this.getRuntimeFlowSteps();
    if (!flowSteps || flowSteps.length === 0) {
      this.advanceRuleBasedPhase(prevPhase);
      return;
    }
    
    // Handle long break completion (long break is still rule-based interrupt)
    if (prevPhase === 'long-break') {
      this.state.lastLongBreakAtWorkTimeMs = this.state.cumulativeWorkTimeMs;
      
      // Phase 1.5: Log break end
      logSessionEvent({
        event: 'breakEnd',
        phase: prevPhase,
        cumulativeWorkMs: this.state.cumulativeWorkTimeMs,
        scheduleId: this.currentSchedule?.id,
      });
      
      // Use transition model: after long break, restart from first step
      const result = computeNextFlowPhase(0, flowSteps, true /* isAfterLongBreak */);
      this.state.currentFlowStepIndex = result.nextIndex;
      
      this.startPhase(result.nextPhase);
      return;
    }
    
    // Track short break completion for cumulative time tracking
    if (prevPhase === 'short-break') {
      this.state.lastShortBreakAtWorkTimeMs = this.state.cumulativeWorkTimeMs;
      
      // Phase 1.5: Log break end
      logSessionEvent({
        event: 'breakEnd',
        phase: prevPhase,
        cumulativeWorkMs: this.state.cumulativeWorkTimeMs,
        scheduleId: this.currentSchedule?.id,
      });
    }
    
    // Get current index, validating it's within bounds
    let currentIndex = this.state.currentFlowStepIndex ?? 0;
    
    // Validate and resync if needed
    if (!isValidFlowIndex(currentIndex, flowSteps)) {
      logger.warn('TimerEngine', 'advanceFlowBasedPhase: invalid index, resyncing', {
        currentIndex,
        flowLength: flowSteps.length,
      });
      // Find correct index for current phase
      const correctIndex = findPhaseIndex(flowSteps, prevPhase);
      currentIndex = correctIndex !== -1 ? correctIndex : 0;
      this.state.currentFlowStepIndex = currentIndex;
    }
    
    // Check for phase-index desync (skip for short-break which is in flow)
    const expectedPhaseAtIndex = flowSteps[currentIndex]?.type;
    if (expectedPhaseAtIndex !== prevPhase && prevPhase !== 'short-break') {
      logger.warn('TimerEngine', 'Flow index desync detected', {
        prevPhase,
        currentIndex,
        expectedPhaseAtIndex,
      });
      // Try to find correct index
      const correctIndex = findPhaseIndex(flowSteps, prevPhase);
      if (correctIndex !== -1) {
        currentIndex = correctIndex;
        this.state.currentFlowStepIndex = currentIndex;
        logger.info('TimerEngine', 'Resynced to correct index', { correctIndex });
      }
    }
    
    // Use transition model to compute next phase
    let result = computeNextFlowPhase(currentIndex, flowSteps, false);
    
    // BREAK CONFLICT RESOLUTION: Skip break steps if a pending break exists
    // This prevents stacking breaks when flow reaches a break step while
    // a postponed break is pending
    if (isBreakPhaseType(result.nextPhase)) {
      const pendingBreak = this.state.isPostponed && this.state.postponedPhase
        ? (isBreakPhaseType(this.state.postponedPhase) ? this.state.postponedPhase as BreakPhaseType : null)
        : null;
      
      if (pendingBreak) {
        const skipCheck = shouldSkipFlowBreakStep(pendingBreak, result.nextPhase as BreakPhaseType);
        
        if (skipCheck.skip) {
          logger.info('TimerEngine', 'Skipping flow break step due to pending break', {
            flowBreakStep: result.nextPhase,
            pendingBreak,
            reason: skipCheck.reason,
          });
          
          // Skip to the next non-break step
          let skipIndex = result.nextIndex;
          let attempts = 0;
          const maxAttempts = flowSteps.length;
          
          while (attempts < maxAttempts) {
            const nextResult = computeNextFlowPhase(skipIndex, flowSteps, false);
            skipIndex = nextResult.nextIndex;
            
            if (!isBreakPhaseType(nextResult.nextPhase)) {
              // Found a non-break step
              result = nextResult;
              logger.info('TimerEngine', 'Found next work step after skipping break', {
                newIndex: result.nextIndex,
                newPhase: result.nextPhase,
              });
              break;
            }
            attempts++;
          }
          
          if (attempts >= maxAttempts) {
            // All steps are breaks (shouldn't happen), just proceed
            logger.warn('TimerEngine', 'Could not find non-break step, proceeding with break');
          }
        }
      }
    }
    
    // CRITICAL FIX: When advancing TO a break phase, save the current work phase info
    // so that postpone can properly restore to the correct flow position
    if (isBreakPhaseType(result.nextPhase) && !isBreakPhaseType(prevPhase)) {
      // Save the work phase we're leaving (for postpone restoration)
      this.state.interruptedFlowIndex = currentIndex;
      this.state.interruptedPhase = prevPhase;
      this.state.interruptedPhaseRemainingMs = 0; // Work phase completed, no remaining time
      this.preBreakPhase = prevPhase;
      
      logger.info('TimerEngine', 'Saving interrupted work phase for break', {
        interruptedFlowIndex: currentIndex,
        interruptedPhase: prevPhase,
        nextBreakPhase: result.nextPhase,
      });
    }
    
    this.state.currentFlowStepIndex = result.nextIndex;
    
    logger.info('TimerEngine', 'advanceFlowBasedPhase - advancing', {
      prevPhase,
      fromIndex: currentIndex,
      toIndex: result.nextIndex,
      newPhase: result.nextPhase,
    });
    
    this.maybeStartPhase(result.nextPhase);
  }
  
  /**
   * Advance phase in rule-based mode
   * Uses transition model for computing next phase
   */
  private advanceRuleBasedPhase(prevPhase: PhaseType): void {
    // Track break completion for cumulative time tracking
    if (prevPhase === 'short-break') {
      this.state.lastShortBreakAtWorkTimeMs = this.state.cumulativeWorkTimeMs;
    } else if (prevPhase === 'long-break') {
      this.state.lastLongBreakAtWorkTimeMs = this.state.cumulativeWorkTimeMs;
    }
    
    // Use transition model to compute next phase
    const nextPhase = computeNextRuleBasedPhase(prevPhase, this.preBreakPhase);
    
    // Clear pre-break phase after breaks
    if (isBreakPhase(prevPhase)) {
      this.preBreakPhase = null;
    }

    this.maybeStartPhase(nextPhase);
  }

  /**
   * Start a phase immediately, or enter waiting state if autoStartNextActivity=false.
   * Break phases always start immediately (user-initiated breaks should not be held).
   * Only work/transition phases are held for manual confirmation.
   */
  private maybeStartPhase(phase: PhaseType): void {
    const autoStart = this.currentSchedule?.autoStartNextActivity ?? true;
    // Always auto-start break phases — only hold work/transition phases
    if (!autoStart && !isBreakPhaseType(phase) && phase !== 'idle') {
      const prevPhase = this.state.currentPhase;
      logger.info('TimerEngine', 'Waiting for user to start next activity', { phase, prevPhase });
      this.state.isWaitingForNextActivity = true;
      this.state.waitingNextPhase = phase;
      // CRITICAL: Update currentPhase to the WAITING phase so that:
      // 1. ensureOverlayIfRequired sees the correct phase (work phase → no overlay)
      // 2. emitTick reports the correct phase to the UI
      // 3. Stale completed-phase at 0:00 doesn't cause overlay to reopen
      this.state.currentPhase = phase;
      this.state.phaseRemainingMs = 0;
      this.state.phaseEndsAt = 0;
      this.state.phaseTotalMs = this.getPhaseDurationMs(phase);
      this.emit('phaseChange', { prevPhase, newPhase: phase, waiting: true });
      this.saveStateImmediately();
      return;
    }
    this.startPhase(phase);
  }

  /**
   * Called by user when autoStartNextActivity=false and they want to start the queued phase.
   * Returns true if a queued phase was started, false if nothing was waiting.
   */
  startNextActivity(): boolean {
    if (!this.state.isWaitingForNextActivity || !this.state.waitingNextPhase) {
      logger.debug('TimerEngine', 'startNextActivity: nothing waiting');
      return false;
    }
    const phase = this.state.waitingNextPhase;
    this.state.isWaitingForNextActivity = false;
    this.state.waitingNextPhase = null;
    logger.info('TimerEngine', 'startNextActivity: starting queued phase', { phase });
    this.startPhase(phase);
    this.emitTick();
    this.saveState();
    return true;
  }

  /**
   * Start a specific phase
   * 
   * BREAK CONFLICT POLICY:
   * When entering a break phase, check if pending break should be cleared
   * to prevent conflicting break states (active + pending of same type)
   */
  private startPhase(phase: PhaseType): void {
    const prevPhase = this.state.currentPhase;
    const now = Date.now();
    const duration = this.getPhaseDurationMs(phase);
    
    // BREAK CONFLICT RESOLUTION: Clear pending break when entering a break phase
    // This prevents the "active break + same-type pending break" conflict
    if (isBreakPhaseType(phase) && this.state.isPostponed && this.state.postponedPhase) {
      const pendingBreak = isBreakPhaseType(this.state.postponedPhase) 
        ? this.state.postponedPhase as BreakPhaseType 
        : null;
      
      if (pendingBreak) {
        const clearCheck = shouldClearPendingOnBreakEntry(pendingBreak, phase as BreakPhaseType);
        
        if (clearCheck.clear) {
          logger.info('TimerEngine', 'Clearing pending break on break entry', {
            enteringPhase: phase,
            pendingBreak,
            reason: clearCheck.reason,
          });
          this.state.isPostponed = false;
          this.state.postponedPhase = null;
          this.state.postponedUntil = null;
          this.state.postponedBreakType = null;
        } else {
          logger.info('TimerEngine', 'Keeping pending break on break entry', {
            enteringPhase: phase,
            pendingBreak,
            reason: clearCheck.reason,
          });
        }
      }
    }
    
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
   * Uses new nested config with fallback to legacy fields
   */
  private getPhaseDurationMs(phase: PhaseType): number {
    if (!this.currentSchedule) return 0;
    const schedule = this.currentSchedule;

    // Flow-based mode: get duration from current flow step (except for long-break)
    if (isFlowBasedSchedule(schedule) && phase !== 'long-break') {
      const flowSteps = schedule.flowSteps!;
      const currentIndex = this.state.currentFlowStepIndex ?? 0;
      const currentStep = flowSteps[currentIndex];
      if (currentStep && currentStep.type === phase) {
        return getFlowStepDurationMs(currentStep);
      }
    }

    // Rule-based mode or long-break (always rule-based)
    switch (phase) {
      case 'sit':
        return minutesToMs(schedule.sitMinutes);
      case 'stand':
        return minutesToMs(schedule.standMinutes);
      case 'sit-to-stand-transition':
        return secondsToMs(
          schedule.transitions?.sitToStand?.durationSeconds ?? 
          schedule.sitToStandTransitionSeconds ?? 
          60
        );
      case 'stand-to-sit-transition':
        return secondsToMs(
          schedule.transitions?.standToSit?.durationSeconds ?? 
          schedule.standToSitTransitionSeconds ?? 
          60
        );
      case 'short-break':
        return minutesToMs(
          schedule.shortBreak?.durationMinutes ?? 
          schedule.shortBreakDurationMinutes ?? 
          5
        );
      case 'long-break':
        return minutesToMs(
          schedule.longBreak?.durationMinutes ?? 
          schedule.longBreakDurationMinutes ?? 
          15
        );
      default:
        return 0;
    }
  }

  /**
   * Get duration for a specific phase (not necessarily current phase)
   * Used for tooltip display of next/then phase durations
   */
  private getPhaseDurationMsForPhase(phase: PhaseType): number {
    if (!this.currentSchedule || phase === 'idle') return 0;
    const schedule = this.currentSchedule;

    // For flow-based, we need to look ahead in flow steps
    if (isFlowBasedSchedule(schedule) && phase !== 'long-break') {
      const flowSteps = schedule.flowSteps!;
      // Find the next occurrence of this phase type in flow
      const currentIndex = this.state.currentFlowStepIndex ?? 0;
      for (let i = currentIndex; i < flowSteps.length + currentIndex; i++) {
        const step = flowSteps[i % flowSteps.length];
        if (step.type === phase) {
          return getFlowStepDurationMs(step);
        }
      }
    }

    // Rule-based mode durations
    switch (phase) {
      case 'sit':
        return minutesToMs(schedule.sitMinutes);
      case 'stand':
        return minutesToMs(schedule.standMinutes);
      case 'sit-to-stand-transition':
        return secondsToMs(
          schedule.transitions?.sitToStand?.durationSeconds ?? 
          schedule.sitToStandTransitionSeconds ?? 60
        );
      case 'stand-to-sit-transition':
        return secondsToMs(
          schedule.transitions?.standToSit?.durationSeconds ?? 
          schedule.standToSitTransitionSeconds ?? 60
        );
      case 'short-break':
        return minutesToMs(
          schedule.shortBreak?.durationMinutes ?? 
          schedule.shortBreakDurationMinutes ?? 5
        );
      case 'long-break':
        return minutesToMs(
          schedule.longBreak?.durationMinutes ?? 
          schedule.longBreakDurationMinutes ?? 15
        );
      default:
        return 0;
    }
  }

  /**
   * Get the phase that comes after nextPhase (for tooltip "then" display)
   * 
   * INVARIANT 7: then is ALWAYS derived from session state, never stored
   */
  private getThenPhase(nextPhase: PhaseType): PhaseType {
    if (!this.currentSchedule || nextPhase === 'idle') return 'idle';
    const schedule = this.currentSchedule;

    // Flow-based mode: use transition model
    if (isFlowBasedSchedule(schedule)) {
      const flowSteps = schedule.flowSteps!;
      const currentIndex = this.state.currentFlowStepIndex ?? 0;
      const result = computeThenFlowPhase(currentIndex, flowSteps);
      return result.nextPhase;
    }

    // Rule-based mode: use transition model
    return computeThenRuleBasedPhase(nextPhase);
  }

  /**
   * Check if phase counts as active work time (sit/stand only)
   */
  private isWorkPhase(phase: PhaseType): boolean {
    return phase === 'sit' || phase === 'stand';
  }

  /**
   * Check if phase should count toward cumulative work time for long break triggers
   * Sit/Stand always count. Transitions and short breaks are configurable.
   * Long breaks never count (they reset the counter)
   */
  private countsToCumulativeWorkTime(phase: PhaseType): boolean {
    if (phase === 'long-break' || phase === 'idle') return false;
    if (phase === 'sit' || phase === 'stand') return true;
    
    const schedule = this.currentSchedule;
    if (!schedule) return false;
    
    // Check if transitions count
    if (phase === 'sit-to-stand-transition' || phase === 'stand-to-sit-transition') {
      return schedule.transitionsCountAsCumulativeWork ?? true;
    }
    
    // Check if short breaks count
    if (phase === 'short-break') {
      return schedule.shortBreaksCountAsCumulativeWork ?? true;
    }
    
    // Custom phases: check the FlowStep's countsAsWork flag
    if (phase === 'custom' && isFlowBasedSchedule(schedule) && schedule.flowSteps) {
      const currentIndex = this.state.currentFlowStepIndex ?? 0;
      const step = schedule.flowSteps[currentIndex];
      if (step && step.type === 'custom') {
        return step.countsAsWork ?? false;
      }
    }
    
    return false;
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
   * 
   * INVARIANT 7: next is ALWAYS derived from session state, never stored
   * PHASE 1.5: Uses runtime flow snapshot, not live config
   */
  getNextPhase(): PhaseType {
    if (!this.currentSchedule) return 'idle';

    // Flow-based mode: use transition model with runtime snapshot
    if (isFlowBasedSchedule(this.currentSchedule)) {
      // PHASE 1.5: Use runtime flow snapshot instead of live config
      const flowSteps = this.getRuntimeFlowSteps();
      if (!flowSteps || flowSteps.length === 0) {
        return computeNextRuleBasedPhase(this.state.currentPhase, this.preBreakPhase);
      }
      
      // If currently in long break (rule-based interrupt), next is first step
      if (this.state.currentPhase === 'long-break') {
        return flowSteps[0].type;
      }
      
      const currentIndex = this.state.currentFlowStepIndex ?? 0;
      const result = computeNextFlowPhase(currentIndex, flowSteps, false);
      return result.nextPhase;
    }

    // Rule-based mode: use transition model
    return computeNextRuleBasedPhase(this.state.currentPhase, this.preBreakPhase);
  }
  
  /**
   * Pause the timer
   */
  pause(): void {
    if (this.state.isPaused) return;
    this.state.isPaused = true;
    this.state.pausedAt = Date.now();
    this.state.pauseResumeAt = null;
    this.pauseReminderLastShownAt = Date.now(); // First reminder in 5 min
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
    this.pauseReminderLastShownAt = Date.now(); // First reminder in 5 min
    this.saveState();
  }

  /**
   * Immediately trigger the pending postponed break without waiting for the
   * postpone timer to expire.
   * 
   * This allows the user to take their pending break early (e.g. when a meeting
   * ends sooner than expected).
   * 
   * Returns true if a pending break was triggered, false if nothing to trigger.
   */
  triggerPendingBreakNow(): boolean {
    if (!this.state.isPostponed || !this.state.postponedPhase) {
      logger.debug('TimerEngine', 'triggerPendingBreakNow: no pending break to trigger');
      return false;
    }

    const pendingBreak = this.state.postponedPhase;

    logger.info('TimerEngine', 'triggerPendingBreakNow: triggering pending break immediately', {
      pendingBreak,
      originalPostponedUntil: this.state.postponedUntil,
    });

    // Clear postpone state BEFORE starting the break (same pattern as normal expiry)
    this.state.isPostponed = false;
    this.state.postponedUntil = null;
    this.state.postponedPhase = null;
    this.state.postponedBreakType = null;

    // Store current work phase so we can resume after break (if not already set)
    if (this.isWorkPhase(this.state.currentPhase)) {
      this.state.interruptedPhase = this.state.currentPhase;
      this.state.interruptedPhaseRemainingMs = this.state.phaseRemainingMs;
      this.preBreakPhase = this.state.currentPhase;
    }

    // Start the break immediately - this emits phaseChange which shows the overlay
    this.startPhase(pendingBreak);
    this.emitTick();
    this.saveState();

    logSessionEvent({
      event: 'breakStart',
      phase: pendingBreak,
      fromPhase: this.state.currentPhase,
      cumulativeWorkMs: this.state.cumulativeWorkTimeMs,
      scheduleId: this.currentSchedule?.id,
    });

    return true;
  }

  /**
   * Resume from pause
   */
  resume(): void {
    if (!this.state.isPaused) return;
    const now = Date.now();
    const pausedDurationMs = this.state.pausedAt ? now - this.state.pausedAt : 0;

    this.state.isPaused = false;
    this.state.pausedAt = null;
    this.state.pauseResumeAt = null;

    // Extend postponedUntil by the paused duration so paused time doesn't
    // count against the pending break countdown
    if (this.state.isPostponed && this.state.postponedUntil && pausedDurationMs > 0) {
      this.state.postponedUntil += pausedDurationMs;
      logger.debug('TimerEngine', 'Resume: extended postponedUntil by paused duration', {
        pausedDurationMs,
        newPostponedUntil: this.state.postponedUntil,
      });
    }

    this.saveState();
  }

  /**
   * Postpone current phase (break)
   * 
   * CRITICAL BEHAVIOR:
   * When a break is postponed, work CONTINUES - the break does NOT become active.
   * The break is stored as "pending" and will re-trigger after the postpone duration.
   * 
   * State changes:
   * - currentPhase -> restored to pre-break work phase
   * - postponedPhase -> the break that was postponed (pending)
   * - isPostponed -> true (indicates a pending break exists)
   * - postponedUntil -> when the pending break should trigger
   */
  postpone(minutes: number): boolean {
    if (!this.currentSchedule) return false;
    
    // ARCHITECTURE HARDENING: Pre-transition validation
    const precondCheck = this.canPerformTransition('postpone');
    if (!precondCheck.allowed) {
      logger.debug('TimerEngine', 'Postpone blocked by precondition', { reason: precondCheck.reason });
      return false;
    }
    
    const breakType = phaseToBreakType(this.state.currentPhase);
    if (!breakType) return false; // Can only postpone breaks/transitions
    
    // Check if postpone is allowed for this break type
    const allowPostpone = this.isPostponeAllowedForBreakType(breakType);
    if (!allowPostpone) return false;
    
    // Check per-break-type limit
    const maxPostpones = getMaxPostponesForBreakType(this.currentSchedule, breakType);
    const currentCount = this.state.postponeCountsToday[breakType];
    if (currentCount >= maxPostpones) return false;

    // Store the pending break
    const postponedBreakPhase = this.state.currentPhase;
    this.state.postponedPhase = postponedBreakPhase;
    this.state.postponedBreakType = breakType;
    this.state.isPostponed = true;
    this.state.postponedUntil = Date.now() + minutesToMs(minutes);
    this.state.postponeCountsToday[breakType]++;
    
    // CRITICAL FIX: Restore work phase - do NOT keep break as current phase
    // Use preBreakPhase (set when break was triggered) or interruptedPhase
    let workPhaseToRestore = this.preBreakPhase || this.state.interruptedPhase || 'sit';
    
    // If the "work phase" is actually a transition, find the next work phase after it
    // This happens when break follows a transition in the flow
    if (workPhaseToRestore === 'sit-to-stand-transition') {
      workPhaseToRestore = 'stand';
    } else if (workPhaseToRestore === 'stand-to-sit-transition') {
      workPhaseToRestore = 'sit';
    }
    
    let workPhaseRemainingMs = this.state.interruptedPhaseRemainingMs || this.getPhaseDurationMs(workPhaseToRestore);
    
    // CRITICAL FIX: Find the correct flow index for the work phase we're restoring to
    // Don't rely on interruptedFlowIndex which might point to a transition
    let flowIndexToRestore: number | undefined;
    if (isFlowBasedSchedule(this.currentSchedule) && this.currentSchedule.flowSteps) {
      // Flow-step break (interruptedPhaseRemainingMs === 0): the previous work phase
      // completed naturally before the break. Advance the flow FORWARD past the break
      // instead of going backward to the already-completed work phase.
      if (this.state.interruptedPhaseRemainingMs === 0) {
        const flowSteps = this.currentSchedule.flowSteps;
        const breakStepIndex = this.state.currentFlowStepIndex ?? 0;
        let result = computeNextFlowPhase(breakStepIndex, flowSteps, false);
        
        // Skip consecutive break steps
        let attempts = 0;
        while (isBreakPhaseType(result.nextPhase) && attempts < flowSteps.length) {
          result = computeNextFlowPhase(result.nextIndex, flowSteps, false);
          attempts++;
        }
        
        workPhaseToRestore = result.nextPhase;
        flowIndexToRestore = result.nextIndex;
        workPhaseRemainingMs = getFlowStepDurationMs(flowSteps[result.nextIndex]);
        
        logger.info('TimerEngine', 'Postpone: advancing flow past break step', {
          breakStepIndex,
          nextPhase: workPhaseToRestore,
          nextIndex: flowIndexToRestore,
          duration: workPhaseRemainingMs,
        });
      } else {
        // Triggered break (interrupted a work phase mid-execution) — restore it
        flowIndexToRestore = findPhaseIndex(this.currentSchedule.flowSteps, workPhaseToRestore);
        if (flowIndexToRestore === -1) {
          flowIndexToRestore = this.state.interruptedFlowIndex; // Fallback
        }
      }
    }
    
    // Save what work phase we're restoring (for after postponed break completes)
    this.state.prePostponeWorkPhase = workPhaseToRestore;
    this.state.prePostponeWorkPhaseRemainingMs = workPhaseRemainingMs;
    this.state.prePostponeFlowIndex = flowIndexToRestore;
    
    // CRITICAL FIX: Always restore flow index BEFORE phase setup
    // so getPhaseDurationMs uses the correct flow step for phaseTotalMs
    if (isFlowBasedSchedule(this.currentSchedule) && flowIndexToRestore !== undefined && flowIndexToRestore !== -1) {
      this.state.currentFlowStepIndex = flowIndexToRestore;
    }
    
    // Restore work phase as current phase
    this.state.currentPhase = workPhaseToRestore;
    this.state.phaseRemainingMs = workPhaseRemainingMs;
    
    // CRITICAL FIX: Calculate phaseTotalMs correctly for the work phase being restored
    // For flow-based schedules, we need to get the duration from the flow step itself,
    // not from getPhaseDurationMs() which uses the current flow index
    if (isFlowBasedSchedule(this.currentSchedule) && flowIndexToRestore !== undefined && flowIndexToRestore !== -1) {
      const flowSteps = this.currentSchedule.flowSteps!;
      const restoredStep = flowSteps[flowIndexToRestore];
      this.state.phaseTotalMs = restoredStep ? getFlowStepDurationMs(restoredStep) : this.getPhaseDurationMs(workPhaseToRestore);
    } else {
      // Rule-based schedule or fallback
      this.state.phaseTotalMs = this.getPhaseDurationMs(workPhaseToRestore);
    }
    
    this.state.phaseStartedAt = Date.now();
    this.state.phaseEndsAt = Date.now() + workPhaseRemainingMs;
    
    // Phase 1.5: Structured postpone logging
    logSessionEvent({
      event: 'postponeBreak',
      phase: workPhaseToRestore,
      pendingBreak: postponedBreakPhase,
      postponeUntil: this.state.postponedUntil,
      cumulativeWorkMs: this.state.cumulativeWorkTimeMs,
      scheduleId: this.currentSchedule?.id,
      restoredFlowIndex: flowIndexToRestore,
    });
    
    // Phase 5: Trace logging
    trace.postpone(postponedBreakPhase, minutes);
    
    // ARCHITECTURE HARDENING: Post-transition invariant validation
    this.validateStateInvariants('After postpone');
    
    // Validate postpone state safety
    const nextPhase = this.getNextPhase();
    const validation = validateRuntimeState(this.state, this.currentSchedule, nextPhase);
    if (!validation.valid) {
      logSessionEvent({
        event: 'validationError',
        reason: 'Invalid state after postpone',
        phase: this.state.currentPhase,
        pendingBreak: this.state.postponedPhase,
      });
    }
    
    this.saveState();

    // Emit event so main process can close overlay
    this.emit('postponed', { minutes, phase: postponedBreakPhase, breakType });

    return true;
  }
  
  /**
   * Check if postpone is allowed for a break type
   * NOTE: Postpone is only allowed for breaks, NOT for transitions
   */
  private isPostponeAllowedForBreakType(breakType: BreakType): boolean {
    if (!this.currentSchedule) return false;
    const schedule = this.currentSchedule;
    
    switch (breakType) {
      case 'sitToStandTransition':
      case 'standToSitTransition':
        // Transitions cannot be postponed - only breaks can
        return false;
      case 'shortBreak':
        return schedule.shortBreak?.allowPostpone ?? schedule.allowPostpone ?? false;
      case 'longBreak':
        return schedule.longBreak?.allowPostpone ?? schedule.allowPostpone ?? false;
      default:
        return false;
    }
  }

  /**
   * Get max allowed skips for a specific break phase
   */
  private getMaxSkipsForBreakPhase(phase: PhaseType): number {
    if (!this.currentSchedule) return 0;

    if (phase === 'short-break') {
      return this.currentSchedule.shortBreak.maxSkipsPerDay
        ?? this.currentSchedule.maxSkipsPerDay
        ?? 2;
    }

    if (phase === 'long-break') {
      return this.currentSchedule.longBreak.maxSkipsPerDay
        ?? this.currentSchedule.maxSkipsPerDay
        ?? 1;
    }

    return 0;
  }

  /**
   * Get current skip count for active break phase
   */
  private getCurrentBreakSkipCount(): number {
    if (!this.state.breakSkipCountsToday) return 0;

    if (this.state.currentPhase === 'short-break') {
      return this.state.breakSkipCountsToday.shortBreak;
    }

    if (this.state.currentPhase === 'long-break') {
      return this.state.breakSkipCountsToday.longBreak;
    }

    return 0;
  }

  /**
   * Check whether current active break can be skipped based on configured limit
   */
  private canSkipCurrentBreak(): boolean {
    if (this.state.currentPhase !== 'short-break' && this.state.currentPhase !== 'long-break') {
      return true;
    }

    const maxSkips = this.getMaxSkipsForBreakPhase(this.state.currentPhase);
    const currentCount = this.getCurrentBreakSkipCount();
    return currentCount < maxSkips;
  }

  /**
   * Skip the current phase (if allowed)
   * 
   * SKIP SEMANTICS:
   * - Rule-based: advances to next phase in sit→trans→stand→trans cycle
   * - Flow-based: advances currentFlowStepIndex and updates currentPhase to match
   * - Breaks: advances out of break, resumes work or continues flow
   * 
   * SKIP SAFETY (Phase 1.5):
   * 1. Advance flow index by exactly one step
   * 2. Normalize index using normalizeFlowIndex
   * 3. Update currentPhase
   * 4. Recompute next and then
   * 5. Emit state update
   * 
   * INVARIANT: After skip, currentPhase MUST match flowSteps[currentFlowStepIndex] (in flow mode)
  */
  skipPhase(): void {
    if (!this.currentSchedule) return;

    // If waiting for user to start next activity, skip the queued phase
    // and advance to the one after it (treat it as if the queued phase completed)
    if (this.state.isWaitingForNextActivity && this.state.waitingNextPhase) {
      if (this.currentSchedule.noSkipEnabled) return;
      logger.info('TimerEngine', 'skipPhase: skipping queued waiting phase', {
        waitingNextPhase: this.state.waitingNextPhase,
      });
      const skippedPhase = this.state.waitingNextPhase;
      this.state.isWaitingForNextActivity = false;
      this.state.waitingNextPhase = null;
      // Temporarily set currentPhase to the skipped phase so advancePhase
      // can correctly compute what comes after it
      this.state.currentPhase = skippedPhase;
      this.advancePhase();
      this.emitTick();
      this.saveState();
      return;
    }

    // If a postponed break is pending, skip that pending break instead of
    // skipping the current phase. This enables "Skip waiting break" from
    // dashboard/overlay while user continues work or transitions.
    if (this.state.isPostponed && this.state.postponedPhase) {
      const pendingBreak = this.state.postponedPhase;

      this.state.isPostponed = false;
      this.state.postponedPhase = null;
      this.state.postponedUntil = null;
      this.state.postponedBreakType = null;
      this.state.prePostponeWorkPhase = null;
      this.state.prePostponeWorkPhaseRemainingMs = 0;
      this.state.prePostponeFlowIndex = undefined;

      logSessionEvent({
        event: 'skipPhase',
        phase: this.state.currentPhase,
        fromPhase: this.state.currentPhase,
        pendingBreak,
        next: this.getNextPhase(),
        scheduleId: this.currentSchedule?.id,
        reason: 'Skipped pending postponed break',
      });

      this.saveState();
      this.emitTick();
      return;
    }

    if (this.currentSchedule.noSkipEnabled) return;
    
    // ARCHITECTURE HARDENING: Pre-transition validation
    const precondCheck = this.canPerformTransition('skip');
    if (!precondCheck.allowed) {
      logger.debug('TimerEngine', 'Skip blocked by precondition', { reason: precondCheck.reason });
      return;
    }
    
    const indexBefore = this.state.currentFlowStepIndex;
    const phaseBefore = this.state.currentPhase;

    // Enforce strict-mode skip policy for transitions at engine level.
    // Active break skip remains allowed (subject to per-break daily limits).
    const isTransitionPhase = phaseBefore === 'sit-to-stand-transition' || phaseBefore === 'stand-to-sit-transition';
    if (isTransitionPhase && this.getStrictModeForCurrentPhase()) {
      logger.info('TimerEngine', 'Skip blocked: strict mode transition', {
        phase: phaseBefore,
        scheduleId: this.currentSchedule?.id,
      });
      return;
    }

    // Active break skip limit (short/long break only)
    if (phaseBefore === 'short-break' || phaseBefore === 'long-break') {
      if (!this.canSkipCurrentBreak()) {
        logger.info('TimerEngine', 'Skip blocked: reached break skip limit', {
          phase: phaseBefore,
          currentCount: this.getCurrentBreakSkipCount(),
          maxAllowed: this.getMaxSkipsForBreakPhase(phaseBefore),
          scheduleId: this.currentSchedule?.id,
        });
        return;
      }

      // Count this active break skip
      if (!this.state.breakSkipCountsToday) {
        this.state.breakSkipCountsToday = { ...INITIAL_BREAK_SKIP_COUNTS };
      }
      if (phaseBefore === 'short-break') {
        this.state.breakSkipCountsToday.shortBreak++;
      } else {
        this.state.breakSkipCountsToday.longBreak++;
      }
    }
    
    // For flow-based mode, ensure index is synced before advancing
    if (isFlowBasedSchedule(this.currentSchedule)) {
      // PHASE 1.5: Use runtime flow snapshot instead of live config
      const flowSteps = this.getRuntimeFlowSteps();
      if (flowSteps && flowSteps.length > 0) {
        // Normalize index before skip
        const normalizedIndex = normalizeFlowIndex(indexBefore, flowSteps.length);
        if (normalizedIndex !== indexBefore) {
          this.state.currentFlowStepIndex = normalizedIndex;
        }
      }
    }
    
    // Advance phase
    this.advancePhase();
    
    // Get new state after advance
    const indexAfter = this.state.currentFlowStepIndex;
    const nextPhase = this.getNextPhase();
    
    // Log skip event with structured format
    logSessionEvent({
      event: 'skipPhase',
      phase: this.state.currentPhase,
      fromPhase: phaseBefore,
      indexBefore,
      indexAfter,
      next: nextPhase,
      scheduleId: this.currentSchedule?.id,
    });
    
    // Phase 5: Trace logging
    trace.skip(phaseBefore, this.state.currentPhase);
    
    // Validate and recover if needed (flow mode)
    if (isFlowBasedSchedule(this.currentSchedule)) {
      const validation = validateRuntimeState(this.state, this.currentSchedule, nextPhase);
      if (!validation.valid) {
        const recovery = attemptSafeRecovery(this.state, this.currentSchedule);
        if (recovery.recovered && recovery.newIndex !== undefined) {
          this.state.currentFlowStepIndex = recovery.newIndex;
        }
      }
    }
    
    // Emit tick immediately after skip to update UI
    this.emitTick();
  }

  /**
   * Complete current phase (user acknowledges they're done)
   */
  completePhase(): void {
    this.advancePhase();
  }

  /**
   * Restart the current activity's timer back to its full configured duration.
   * Does NOT reset session state (cumulative work time, break counters, flow index, etc.)
   * 
   * RESTART SEMANTICS:
   * - Only restarts the timer for the current phase
   * - Does not apply to transitions (sit-to-stand, stand-to-sit)
   * - Does not apply to idle or waiting-for-next-activity states
   * - Does not apply to strict-mode breaks (would allow extending enforced breaks)
   * - Unpauses the timer if currently paused
   * - Preserves: cumulative work time, break markers, flow index, postpone state
   * 
   * Returns true if the activity was restarted, false if blocked.
   */
  restartCurrentActivity(): boolean {
    if (!this.currentSchedule) {
      logger.warn('TimerEngine', 'Cannot restart activity - no active schedule');
      return false;
    }

    const phase = this.state.currentPhase;

    // Block: transitions
    if (phase === 'sit-to-stand-transition' || phase === 'stand-to-sit-transition') {
      logger.info('TimerEngine', 'Restart blocked: transitions are not restartable');
      return false;
    }

    // Block: idle
    if (phase === 'idle') {
      logger.info('TimerEngine', 'Restart blocked: idle phase');
      return false;
    }

    // Block: waiting for next activity
    if (this.state.isWaitingForNextActivity) {
      logger.info('TimerEngine', 'Restart blocked: waiting for next activity');
      return false;
    }

    // Block: strict-mode breaks (don't allow extending enforced breaks)
    if ((phase === 'short-break' || phase === 'long-break') && this.getStrictModeForCurrentPhase()) {
      logger.info('TimerEngine', 'Restart blocked: strict-mode break', { phase });
      return false;
    }

    const now = Date.now();
    const duration = this.state.phaseTotalMs;

    logger.info('TimerEngine', 'Restarting current activity', {
      phase,
      previousRemainingMs: this.state.phaseRemainingMs,
      restoredDurationMs: duration,
    });

    // Reset phase timer
    this.state.phaseStartedAt = now;
    this.state.phaseEndsAt = now + duration;
    this.state.phaseRemainingMs = duration;

    // Reset short break marker so break progress re-aligns with the restarted phase.
    // Long break marker is intentionally NOT reset — prevents gaming via repeated restarts.
    this.state.lastShortBreakAtWorkTimeMs = this.state.cumulativeWorkTimeMs;

    // Unpause if paused
    if (this.state.isPaused) {
      this.state.isPaused = false;
      this.state.pausedAt = null;
      this.state.pauseResumeAt = null;
      this.lastTickTime = now;
    }

    // Log event
    logSessionEvent({
      event: 'restartActivity',
      phase,
      cumulativeWorkMs: this.state.cumulativeWorkTimeMs,
      scheduleId: this.currentSchedule?.id,
    });

    this.saveState();
    this.emitTick();

    return true;
  }

  /**
   * Reset the active session completely
   * Restarts from the beginning without changing schedule configuration
   * 
   * RESET SEMANTICS (Invariant 6):
   * - After reset: currentPhase is first work phase (sit or stand)
   * - After reset: all postpone/pause/interrupted state is cleared
   * - After reset: cumulative work time is 0
   * - Reset does NOT mutate saved schedule config
   * 
   * Does NOT reset:
   * - Postpone counts today (use resetTodayCounters for that)
   * - Schedule configuration
   */
  resetSession(): void {
    if (!this.currentSchedule) {
      logger.warn('TimerEngine', 'Cannot reset session - no active schedule');
      return;
    }
    
    // ARCHITECTURE HARDENING: Pre-transition validation
    const precondCheck = this.canPerformTransition('reset');
    if (!precondCheck.allowed) {
      logger.warn('TimerEngine', 'Reset blocked by precondition', { reason: precondCheck.reason });
      return;
    }
    
    logTransition(TransitionType.RESET_REQUESTED, {
      scheduleName: this.currentSchedule.name,
      currentPhase: this.state.currentPhase,
      scheduleMode: this.currentSchedule.mode,
    });
    
    // Phase 5: Trace logging
    trace.reset(`session reset: ${this.currentSchedule.name}`);
    
    // Reload schedule from config to restore original flow order
    // (shuffle/reverse may have modified the in-memory flowSteps)
    const schedules = configService.getSchedules();
    const originalSchedule = schedules.find(s => s.id === this.currentSchedule!.id);
    if (originalSchedule) {
      this.currentSchedule = originalSchedule;
    }
    
    const now = Date.now();
    
    // Use transition model to compute clean reset state
    const resetState = computeResetState(this.currentSchedule);
    
    // Apply reset state
    this.state.currentPhase = resetState.currentPhase;
    this.state.currentFlowStepIndex = resetState.currentFlowStepIndex;
    this.state.phaseStartedAt = now;
    this.state.phaseEndsAt = now + resetState.phaseDurationMs;
    this.state.phaseRemainingMs = resetState.phaseDurationMs;
    this.state.phaseTotalMs = resetState.phaseDurationMs;
    
    // Update flow config hash for flow-based schedules
    if (isFlowBasedSchedule(this.currentSchedule)) {
      this.state.flowConfigHash = computeFlowConfigHash(this.currentSchedule.flowSteps);
      // PHASE 1.5: Re-freeze flow snapshot from fresh config
      this.freezeFlowSnapshot();
    } else {
      this.state.flowConfigHash = undefined;
      this.runtimeFlowSnapshot = null;
    }
    
    // Reset cumulative work time
    this.state.cumulativeWorkTimeMs = 0;
    
    // Reset break tracking - all breaks start fresh
    this.state.lastShortBreakAtWorkTimeMs = 0;
    this.state.lastLongBreakAtWorkTimeMs = 0;
    
    // Clear interrupted phase and flow index
    this.state.interruptedPhase = null;
    this.state.interruptedPhaseRemainingMs = 0;
    this.state.interruptedFlowIndex = undefined;
    
    // Clear postponed state (Invariant 3)
    this.state.isPostponed = false;
    this.state.postponedUntil = null;
    this.state.postponedPhase = null;
    this.state.postponedBreakType = null;
    this.state.prePostponeWorkPhase = null;
    this.state.prePostponeWorkPhaseRemainingMs = 0;
    this.state.prePostponeFlowIndex = undefined;
    
    // Clear waiting-for-next-activity state
    this.state.isWaitingForNextActivity = false;
    this.state.waitingNextPhase = null;

    // Clear paused state (Invariant 4)
    this.state.isPaused = false;
    this.state.pausedAt = null;
    this.state.pauseResumeAt = null;
    
    // Clear pre-break tracking
    this.preBreakPhase = null;
    
    // Update tick time
    this.lastTickTime = now;
    
    // ARCHITECTURE HARDENING: Post-transition invariant validation
    this.validateStateInvariants('After reset');
    
    // Validate reset state
    const validation = validateSessionState(this.state, this.currentSchedule);
    if (!validation.valid) {
      logValidationResult(validation, 'Reset Session - validation failed');
    }
    
    // Save state and emit tick
    this.saveState();
    this.emitTick();
    
    // Emit session reset event for sound and other handlers
    this.emit('sessionReset');
    
    // Phase 1.5: Structured reset logging
    logSessionEvent({
      event: 'resetSession',
      phase: resetState.currentPhase,
      index: resetState.currentFlowStepIndex,
      cumulativeWorkMs: 0,
      pendingBreak: null,
      postponeUntil: null,
      scheduleId: this.currentSchedule?.id,
    });
  }

  /**
   * Reset today's counters without affecting current phase
   * 
   * Resets:
   * - Cumulative work time today
   * - Postpone counts today
   * 
   * Does NOT reset:
   * - Current phase or phase progress
   * - Work time toward breaks (those are relative to cumulative work time)
   */
  resetTodayCounters(): void {
    logger.info('TimerEngine', 'Resetting today\'s counters');
    
    const today = getTodayDateString();
    
    // Reset cumulative work time
    this.state.cumulativeWorkTimeMs = 0;
    
    // Reset break tracking markers to 0 (since cumulative work time is now 0)
    this.state.lastShortBreakAtWorkTimeMs = 0;
    this.state.lastLongBreakAtWorkTimeMs = 0;
    
    // Reset postpone counts
    this.state.postponeCountsToday = { ...INITIAL_POSTPONE_COUNTS };
    this.state.postponeResetDate = today;
    
    // Reset break counts
    this.state.shortBreakCountToday = 0;
    this.state.longBreakCountToday = 0;
    this.state.breakSkipCountsToday = { ...INITIAL_BREAK_SKIP_COUNTS };
    this.state.breakCountResetDate = today;
    
    // Save state and emit tick
    this.saveState();
    this.emitTick();
    
    logger.info('TimerEngine', 'Today\'s counters reset complete');
  }

  /**
   * Shuffle flow steps - toggle between Sit-first and Stand-first order.
   * Break always stays at the end.
   * 
   * Normal order: Sit → sit-to-stand trans → Stand → stand-to-sit trans → Break
   * Shuffled:     Stand → stand-to-sit trans → Sit → sit-to-stand trans → Break
   * 
   * If flow is messed up (e.g., break first), restores to normal Sit-first order.
   * 
   * Saves to config file - user must click "Reset Now" to apply
   */
  shuffleFlow(): { success: boolean; message: string } {
    if (!this.currentSchedule || !isFlowBasedSchedule(this.currentSchedule)) {
      logger.warn('TimerEngine', 'Cannot shuffle - no flow-based schedule active');
      return { success: false, message: 'No flow-based schedule active' };
    }

    const flowSteps = this.currentSchedule.flowSteps!;
    if (flowSteps.length < 4) {
      logger.warn('TimerEngine', 'Cannot shuffle - need at least 4 flow steps');
      return { success: false, message: 'Need at least 4 flow steps to shuffle' };
    }

    // Find work phases and breaks
    const sitStep = flowSteps.find(s => s.type === 'sit');
    const standStep = flowSteps.find(s => s.type === 'stand');
    const sitToStandTrans = flowSteps.find(s => s.type === 'sit-to-stand-transition');
    const standToSitTrans = flowSteps.find(s => s.type === 'stand-to-sit-transition');
    const breaks = flowSteps.filter(s => s.type === 'short-break');

    if (!sitStep || !standStep || !sitToStandTrans || !standToSitTrans) {
      logger.warn('TimerEngine', 'Cannot shuffle - missing required work phases');
      return { success: false, message: 'Missing required work phases (sit, stand, transitions)' };
    }

    const firstStep = flowSteps[0];
    let newSteps: FlowStep[];
    let message: string;

    if (firstStep.type === 'sit') {
      // Currently Sit-first → change to Stand-first
      newSteps = [standStep, standToSitTrans, sitStep, sitToStandTrans, ...breaks];
      message = 'Flow shuffled to Stand-first! Click Reset Now to apply.';
      logger.info('TimerEngine', 'Shuffling: Sit-first → Stand-first');
    } else if (firstStep.type === 'stand') {
      // Currently Stand-first → change to Sit-first
      newSteps = [sitStep, sitToStandTrans, standStep, standToSitTrans, ...breaks];
      message = 'Flow shuffled to Sit-first! Click Reset Now to apply.';
      logger.info('TimerEngine', 'Shuffling: Stand-first → Sit-first');
    } else {
      // Flow is messed up (break or transition first) → restore to normal Sit-first
      newSteps = [sitStep, sitToStandTrans, standStep, standToSitTrans, ...breaks];
      message = 'Flow restored to normal (Sit-first)! Click Reset Now to apply.';
      logger.info('TimerEngine', 'Shuffling: Restoring to normal Sit-first order');
    }

    // Save to config file - this will trigger flow stale detection
    const updatedSchedule = { ...this.currentSchedule, flowSteps: newSteps };
    configService.saveSchedule(updatedSchedule);
    
    // Update in-memory schedule reference so tick shows updated state
    this.currentSchedule = updatedSchedule;
    
    // Emit schedule change event so UI updates
    this.emit('scheduleChange', updatedSchedule);
    
    // Emit tick so UI updates and shows "Flow Updated" banner
    this.emitTick();
    
    logger.info('TimerEngine', 'Flow shuffled in config', {
      newOrder: newSteps.map(s => s.type).join(' → ')
    });
    return { success: true, message };
  }

  /**
   * Reverse flow steps - true reversal, last step becomes first.
   * 
   * Example: sit → trans → stand → trans → break
   * After reverse: break → trans → stand → trans → sit
   * 
   * Saves to config file - user must click "Reset Now" to apply
   */
  reverseFlow(): { success: boolean; message: string } {
    if (!this.currentSchedule || !isFlowBasedSchedule(this.currentSchedule)) {
      logger.warn('TimerEngine', 'Cannot reverse - no flow-based schedule active');
      return { success: false, message: 'No flow-based schedule active' };
    }

    const flowSteps = this.currentSchedule.flowSteps!;
    if (flowSteps.length < 2) {
      logger.warn('TimerEngine', 'Cannot reverse - need at least 2 flow steps');
      return { success: false, message: 'Need at least 2 flow steps to reverse' };
    }

    logger.info('TimerEngine', 'Reversing flow steps - saving to config');

    // True reversal - last becomes first, even if it's a break
    const newSteps = [...flowSteps].reverse();

    // Save to config file - this will trigger flow stale detection
    const updatedSchedule = { ...this.currentSchedule, flowSteps: newSteps };
    configService.saveSchedule(updatedSchedule);
    
    // Update in-memory schedule reference so tick shows updated state
    this.currentSchedule = updatedSchedule;
    
    // Emit schedule change event so UI updates
    this.emit('scheduleChange', updatedSchedule);
    
    // Emit tick so UI updates and shows "Flow Updated" banner
    this.emitTick();
    
    logger.info('TimerEngine', 'Flow reversed in config - user should click Reset Now to apply', {
      newOrder: newSteps.map(s => s.type).join(' → ')
    });
    return { success: true, message: 'Flow reversed! Click Reset Now to apply.' };
  }
  
  /**
   * Called when a schedule is updated externally (e.g., via settings UI).
   * Updates the in-memory schedule reference if it's the active schedule,
   * which allows isFlowSessionStale() to detect changes.
   */
  onScheduleUpdated(schedule: Schedule): void {
    if (!this.currentSchedule) return;
    
    // Only update if this is the active schedule
    if (this.currentSchedule.id !== schedule.id) return;
    
    logger.info('TimerEngine', 'Active schedule updated externally', {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
    });
    
    // Update the in-memory reference
    this.currentSchedule = schedule;
    
    // Emit events so UI updates
    this.emit('scheduleChange', schedule);
    this.emitTick();
  }

  /**
   * Calculate break progress information
   */
  private calculateBreakProgress(): BreakProgress {
    const schedule = this.currentSchedule;
    const workTimeMs = this.state.cumulativeWorkTimeMs;
    
    // In flow-based mode, calculate short break timing from flow cycle
    let shortBreakEveryMinutes = schedule?.shortBreak?.everyMinutes ?? schedule?.shortBreakEveryMinutes ?? 60;
    let shortBreakDurationMinutes = schedule?.shortBreak?.durationMinutes ?? schedule?.shortBreakDurationMinutes ?? 5;
    let shortBreakEnabled = schedule?.shortBreak?.enabled ?? schedule?.shortBreakEnabled ?? false;
    
    if (schedule && isFlowBasedSchedule(schedule)) {
      const flowSteps = schedule.flowSteps!;
      // In flow mode, short breaks are part of the flow
      // Calculate total cycle time (all steps including short break)
      let totalCycleSeconds = 0;
      let hasShortBreak = false;
      
      for (const step of flowSteps) {
        totalCycleSeconds += step.durationSeconds;
        if (step.type === 'short-break') {
          hasShortBreak = true;
          shortBreakDurationMinutes = Math.round(step.durationSeconds / 60);
        }
      }
      
      // Short break "every" is the total cycle time minus the break duration
      // (time between short breaks)
      if (hasShortBreak) {
        shortBreakEnabled = true;
        const cycleMinutes = Math.round(totalCycleSeconds / 60);
        shortBreakEveryMinutes = cycleMinutes - shortBreakDurationMinutes;
      } else {
        shortBreakEnabled = false;
      }
    }
    const shortBreakThresholdMs = minutesToMs(shortBreakEveryMinutes);
    
    // Long break settings
    const longBreakEnabled = schedule?.longBreak?.enabled ?? schedule?.longBreakEnabled ?? false;
    const longBreakEveryMinutes = schedule?.longBreak?.everyMinutes ?? schedule?.longBreakEveryMinutes ?? 150;
    const longBreakDurationMinutes = schedule?.longBreak?.durationMinutes ?? schedule?.longBreakDurationMinutes ?? 15;
    const longBreakThresholdMs = minutesToMs(longBreakEveryMinutes);
    
    // Calculate time since last breaks
    const workTimeSinceShortBreakMs = workTimeMs - this.state.lastShortBreakAtWorkTimeMs;
    const workTimeSinceLongBreakMs = workTimeMs - this.state.lastLongBreakAtWorkTimeMs;
    
    // Calculate time until next breaks
    const msUntilNextShortBreak = shortBreakEnabled 
      ? Math.max(0, shortBreakThresholdMs - workTimeSinceShortBreakMs)
      : Infinity;
    const msUntilNextLongBreak = longBreakEnabled
      ? Math.max(0, longBreakThresholdMs - workTimeSinceLongBreakMs)
      : Infinity;
    
    // Calculate progress (0-1)
    const shortBreakProgress = shortBreakEnabled && shortBreakThresholdMs > 0
      ? Math.min(1, workTimeSinceShortBreakMs / shortBreakThresholdMs)
      : 0;
    const longBreakProgress = longBreakEnabled && longBreakThresholdMs > 0
      ? Math.min(1, workTimeSinceLongBreakMs / longBreakThresholdMs)
      : 0;
    
    // Determine which break comes next
    let nextBreakType: 'short-break' | 'long-break' | null = null;
    let nextBreakInMs = Infinity;
    
    if (shortBreakEnabled && longBreakEnabled) {
      if (msUntilNextShortBreak <= msUntilNextLongBreak) {
        nextBreakType = 'short-break';
        nextBreakInMs = msUntilNextShortBreak;
      } else {
        nextBreakType = 'long-break';
        nextBreakInMs = msUntilNextLongBreak;
      }
    } else if (shortBreakEnabled) {
      nextBreakType = 'short-break';
      nextBreakInMs = msUntilNextShortBreak;
    } else if (longBreakEnabled) {
      nextBreakType = 'long-break';
      nextBreakInMs = msUntilNextLongBreak;
    }
    
    // Convert Infinity to 0 for disabled breaks
    return {
      shortBreakEnabled,
      shortBreakEveryMinutes,
      shortBreakDurationMinutes,
      workTimeSinceShortBreakMs,
      msUntilNextShortBreak: msUntilNextShortBreak === Infinity ? 0 : msUntilNextShortBreak,
      shortBreakProgress,
      
      longBreakEnabled,
      longBreakEveryMinutes,
      longBreakDurationMinutes,
      workTimeSinceLongBreakMs,
      msUntilNextLongBreak: msUntilNextLongBreak === Infinity ? 0 : msUntilNextLongBreak,
      longBreakProgress,
      
      nextBreakType,
      nextBreakInMs: nextBreakInMs === Infinity ? 0 : nextBreakInMs,
      
      shortBreakCountToday: this.state.shortBreakCountToday ?? 0,
      longBreakCountToday: this.state.longBreakCountToday ?? 0,
    };
  }

  /**
   * Emit tick event with current state
   */
  private emitTick(): void {
    const officeFocusLockService = getOfficeFocusLockService();
    const schedule = this.currentSchedule;
    const breakType = phaseToBreakType(this.state.currentPhase);
    
    // Calculate total postpone count across all break types
    const totalPostponeCount = Object.values(this.state.postponeCountsToday).reduce((a, b) => a + b, 0);
    
    // Get max postpones for current break type (or legacy global value)
    const maxPostpones = breakType 
      ? getMaxPostponesForBreakType(schedule, breakType)
      : (schedule?.maxPostponesPerDay ?? 0);
    
    // Get postpone options for current break type
    const postponeOptions = this.getPostponeOptionsForCurrentPhase();
    
    // Get strict mode for current phase
    const isStrictMode = this.getStrictModeForCurrentPhase();
    
    // Get no skip setting from schedule
    const noSkipEnabled = schedule?.noSkipEnabled ?? false;

    // Active break skip limit info (only applies to short/long break phases)
    const isActiveBreakPhase = this.state.currentPhase === 'short-break' || this.state.currentPhase === 'long-break';
    const breakSkipCountToday = isActiveBreakPhase ? this.getCurrentBreakSkipCount() : 0;
    const maxBreakSkipsPerDay = isActiveBreakPhase ? this.getMaxSkipsForBreakPhase(this.state.currentPhase) : 0;
    const canSkipCurrentBreak = isActiveBreakPhase ? this.canSkipCurrentBreak() : true;
    
    // Calculate break progress
    const breakProgress = this.calculateBreakProgress();
    
    // Get configured durations
    const configuredDurations = this.getConfiguredDurations();
    
    // Get next and then phases with durations
    const nextPhase = this.getNextPhase();
    const nextPhaseDurationMs = this.getPhaseDurationMsForPhase(nextPhase);
    const thenPhase = this.getThenPhase(nextPhase);
    const thenPhaseDurationMs = this.getPhaseDurationMsForPhase(thenPhase);
    
    // CRITICAL: Verify flow state consistency in flow-based mode
    if (schedule && isFlowBasedSchedule(schedule)) {
      const flowSteps = schedule.flowSteps!;
      const currentIndex = this.state.currentFlowStepIndex ?? 0;
      const expectedCurrentPhase = flowSteps[currentIndex]?.type;
      const currentPhase = this.state.currentPhase;
      
      // Check for desync: currentPhase should match the flow step at currentIndex
      // Exception: during breaks (long-break is not in flow, short-break might be)
      // Exception: when waiting for next activity (currentPhase is the completed phase, intentionally stale)
      const isInBreak = currentPhase === 'long-break';
      if (!isInBreak && !this.state.isWaitingForNextActivity && expectedCurrentPhase !== currentPhase) {
        logger.warn('TimerEngine', 'FLOW STATE DESYNC DETECTED in emitTick', {
          currentPhase,
          currentFlowStepIndex: currentIndex,
          expectedCurrentPhase,
          nextPhase,
          flowSteps: flowSteps.map((s, i) => `${i}:${s.type}`).join(', '),
        });
        
        // Attempt to resync: find the correct index for currentPhase
        const correctIndex = flowSteps.findIndex(s => s.type === currentPhase);
        if (correctIndex !== -1 && correctIndex !== currentIndex) {
          logger.info('TimerEngine', 'Resyncing flow index', {
            oldIndex: currentIndex,
            newIndex: correctIndex,
            phase: currentPhase,
          });
          this.state.currentFlowStepIndex = correctIndex;
        }
      }
      
      // Also check: if current and next are same but flow doesn't have consecutive duplicates
      if (currentPhase === nextPhase && currentPhase !== 'idle') {
        const nextIndex = (currentIndex + 1) % flowSteps.length;
        if (flowSteps[currentIndex]?.type !== flowSteps[nextIndex]?.type) {
          logger.error('TimerEngine', 'CRITICAL: current == next but flow has no consecutive duplicates', {
            currentPhase,
            nextPhase,
            currentIndex,
            nextIndex,
            flowStepAtCurrent: flowSteps[currentIndex]?.type,
            flowStepAtNext: flowSteps[nextIndex]?.type,
          });
        }
      }
    }
    
    // Phase 1.5: Runtime validation before emit
    const runtimeValidation = validateRuntimeState(this.state, schedule, nextPhase);
    if (!runtimeValidation.valid) {
      // Attempt safe recovery
      const recovery = attemptSafeRecovery(this.state, schedule);
      if (recovery.recovered && recovery.newIndex !== undefined) {
        this.state.currentFlowStepIndex = recovery.newIndex;
        // Recalculate next phase after recovery
        const recoveredNextPhase = this.getNextPhase();
        logSessionEvent({
          event: 'flowDesync',
          reason: recovery.reason,
          index: recovery.newIndex,
          phase: this.state.currentPhase,
          next: recoveredNextPhase,
        });
      }
    }
    
    // Create debug snapshot for dashboard (dev mode)
    const debugSnapshot = createDebugSnapshot(this.state, schedule, nextPhase, thenPhase);
    
    // Get custom display labels for phases
    const currentIndex = this.state.currentFlowStepIndex;
    const nextIndex = schedule && isFlowBasedSchedule(schedule) && schedule.flowSteps
      ? ((currentIndex ?? 0) + 1) % schedule.flowSteps.length
      : undefined;
    const thenIndex = schedule && isFlowBasedSchedule(schedule) && schedule.flowSteps && nextIndex !== undefined
      ? (nextIndex + 1) % schedule.flowSteps.length
      : undefined;
    
    const tick: TimerTick = {
      scheduleId: schedule?.id || null,
      scheduleName: schedule?.name || null,
      scheduleMode: schedule?.mode || null,
      currentPhase: this.state.currentPhase,
      currentPhaseLabel: getPhaseDisplayLabel(this.state.currentPhase, schedule, currentIndex),
      nextPhaseLabel: getPhaseDisplayLabel(nextPhase, schedule, nextIndex),
      thenPhaseLabel: getPhaseDisplayLabel(thenPhase, schedule, thenIndex),
      phaseRemainingMs: this.state.phaseRemainingMs,
      phaseTotalMs: this.state.phaseTotalMs,
      nextPhase,
      nextPhaseDurationMs,
      thenPhase,
      thenPhaseDurationMs,
      cumulativeWorkTimeMs: this.state.cumulativeWorkTimeMs,
      isPaused: this.state.isPaused,
      isWaitingForNextActivity: this.state.isWaitingForNextActivity ?? false,
      waitingNextPhase: this.state.waitingNextPhase ?? null,
      isPostponed: this.state.isPostponed,
      pendingBreakPhase: this.state.postponedPhase,
      pendingBreakInMs: this.state.postponedUntil
        ? Math.max(0, this.state.postponedUntil - (this.state.isPaused && this.state.pausedAt ? this.state.pausedAt : Date.now()))
        : 0,
      isFlowStale: this.isFlowSessionStale(),
      postponeCountToday: totalPostponeCount,
      maxPostponesPerDay: maxPostpones,
      canPostpone: this.canPostpone(),
      postponeOptions,
      isStrictMode,
      noSkipEnabled,
      breakSkipCountToday,
      maxBreakSkipsPerDay,
      canSkipCurrentBreak,
      officeFocusLock: officeFocusLockService.getState(),
      restBlock: getRestBlockService().getState(),
      breakProgress,
      configuredDurations,
      // Custom flow step metadata (for overlay display of custom steps)
      ...(schedule && isFlowBasedSchedule(schedule) && currentIndex !== undefined
        && schedule.flowSteps![currentIndex]
        ? {
            currentStepShowOverlay: schedule.flowSteps![currentIndex].showOverlay,
            currentStepAllowPause: schedule.flowSteps![currentIndex].allowPause,
            currentStepColor: schedule.flowSteps![currentIndex].color,
            currentStepMessage: schedule.flowSteps![currentIndex].message,
            currentStepStrictMode: schedule.flowSteps![currentIndex].strictMode,
          }
        : {}),
      // Built-in transition allowPause from TransitionConfig (applies in both modes)
      ...(this.state.currentPhase === 'sit-to-stand-transition' && schedule?.transitions?.sitToStand
        ? { currentStepAllowPause: schedule.transitions.sitToStand.allowPause ?? true }
        : {}),
      ...(this.state.currentPhase === 'stand-to-sit-transition' && schedule?.transitions?.standToSit
        ? { currentStepAllowPause: schedule.transitions.standToSit.allowPause ?? true }
        : {}),
      // Phase 1.5: Include debug snapshot for dev mode dashboard
      debugSnapshot: {
        currentFlowStepIndex: debugSnapshot.currentFlowStepIndex,
        validationStatus: debugSnapshot.validationStatus,
        flowStepsCount: debugSnapshot.flowStepsCount,
      },
    };

    this.lastEmittedTick = tick;

    this.emit('tick', tick);
  }
  
  /**
   * Get configured durations from active schedule
   * In flow-based mode, reads durations from the flow steps
   */
  private getConfiguredDurations(): ConfiguredDurations {
    const schedule = this.currentSchedule;
    
    // Flow-based mode: extract durations from flow steps
    if (schedule && isFlowBasedSchedule(schedule)) {
      const flowSteps = schedule.flowSteps!;
      
      // Find durations from flow steps (use first occurrence of each type)
      let sitMinutes = 12;
      let standMinutes = 12;
      let sitToStandTransitionSeconds = 60;
      let standToSitTransitionSeconds = 60;
      let shortBreakDurationMinutes = 5;
      
      for (const step of flowSteps) {
        switch (step.type) {
          case 'sit':
            sitMinutes = Math.round(step.durationSeconds / 60);
            break;
          case 'stand':
            standMinutes = Math.round(step.durationSeconds / 60);
            break;
          case 'sit-to-stand-transition':
            sitToStandTransitionSeconds = step.durationSeconds;
            break;
          case 'stand-to-sit-transition':
            standToSitTransitionSeconds = step.durationSeconds;
            break;
          case 'short-break':
            shortBreakDurationMinutes = Math.round(step.durationSeconds / 60);
            break;
        }
      }
      
      return {
        sitMinutes,
        standMinutes,
        sitToStandTransitionSeconds,
        standToSitTransitionSeconds,
        shortBreakDurationMinutes,
        longBreakDurationMinutes: schedule.longBreak?.durationMinutes 
          ?? schedule.longBreakDurationMinutes ?? 15,
      };
    }
    
    // Rule-based mode: use legacy fields
    return {
      sitMinutes: schedule?.sitMinutes ?? 12,
      standMinutes: schedule?.standMinutes ?? 8,
      sitToStandTransitionSeconds: schedule?.transitions?.sitToStand?.durationSeconds 
        ?? schedule?.sitToStandTransitionSeconds ?? 60,
      standToSitTransitionSeconds: schedule?.transitions?.standToSit?.durationSeconds 
        ?? schedule?.standToSitTransitionSeconds ?? 60,
      shortBreakDurationMinutes: schedule?.shortBreak?.durationMinutes 
        ?? schedule?.shortBreakDurationMinutes ?? 5,
      longBreakDurationMinutes: schedule?.longBreak?.durationMinutes 
        ?? schedule?.longBreakDurationMinutes ?? 15,
    };
  }
  
  /**
   * Get postpone options for current phase
   */
  private getPostponeOptionsForCurrentPhase(): number[] {
    if (!this.currentSchedule) return [];
    const schedule = this.currentSchedule;
    
    // Custom phases don't support postpone (no BreakType mapping)
    if (this.state.currentPhase === 'custom') return [];
    
    const breakType = phaseToBreakType(this.state.currentPhase);
    
    if (!breakType) return schedule.postponeOptionsMinutes ?? [];
    
    switch (breakType) {
      case 'sitToStandTransition':
        return schedule.transitions?.sitToStand?.postponeOptionsMinutes ?? schedule.postponeOptionsMinutes ?? [];
      case 'standToSitTransition':
        return schedule.transitions?.standToSit?.postponeOptionsMinutes ?? schedule.postponeOptionsMinutes ?? [];
      case 'shortBreak':
        return schedule.shortBreak?.postponeOptionsMinutes ?? schedule.postponeOptionsMinutes ?? [];
      case 'longBreak':
        return schedule.longBreak?.postponeOptionsMinutes ?? schedule.postponeOptionsMinutes ?? [];
      default:
        return schedule.postponeOptionsMinutes ?? [];
    }
  }
  
  /**
   * Get strict mode for current phase
   */
  private getStrictModeForCurrentPhase(): boolean {
    if (!this.currentSchedule) return false;
    const schedule = this.currentSchedule;
    
    // Custom phases: use FlowStep's strictMode flag
    if (this.state.currentPhase === 'custom' && isFlowBasedSchedule(schedule) && schedule.flowSteps) {
      const currentIndex = this.state.currentFlowStepIndex ?? 0;
      const step = schedule.flowSteps[currentIndex];
      if (step && step.type === 'custom') {
        return step.strictMode ?? false;
      }
    }
    
    const breakType = phaseToBreakType(this.state.currentPhase);
    
    // Work phases use global setting
    if (!breakType) return schedule.strictModeEnabled ?? false;
    
    switch (breakType) {
      case 'sitToStandTransition':
        return schedule.transitions?.sitToStand?.strictModeEnabled ?? schedule.strictModeEnabled ?? false;
      case 'standToSitTransition':
        return schedule.transitions?.standToSit?.strictModeEnabled ?? schedule.strictModeEnabled ?? false;
      case 'shortBreak':
        return schedule.shortBreak?.strictModeEnabled ?? schedule.strictModeEnabled ?? false;
      case 'longBreak':
        return schedule.longBreak?.strictModeEnabled ?? schedule.strictModeEnabled ?? false;
      default:
        return schedule.strictModeEnabled ?? false;
    }
  }

  /**
   * Check if postpone is currently allowed
   * Uses per-break-type limits
   */
  canPostpone(): boolean {
    if (!this.currentSchedule) return false;
    if (this.state.isPostponed) return false;
    
    const breakType = phaseToBreakType(this.state.currentPhase);
    if (!breakType) return false; // Can only postpone breaks/transitions
    
    // Check if postpone allowed for this break type
    if (!this.isPostponeAllowedForBreakType(breakType)) return false;
    
    // Check per-break-type limit
    const maxPostpones = getMaxPostponesForBreakType(this.currentSchedule, breakType);
    const currentCount = this.state.postponeCountsToday[breakType];
    
    return currentCount < maxPostpones;
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
   * Get last emitted timer snapshot for renderer resync/recovery.
   * Main process remains source of truth; renderer can request this after reload.
   */
  getLastEmittedTick(): TimerTick | null {
    if (!this.lastEmittedTick) return null;

    return {
      ...this.lastEmittedTick,
      officeFocusLock: getOfficeFocusLockService().getState(),
      restBlock: getRestBlockService().getState(),
    };
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
   * Uses the immediate save method for critical state changes
   */
  private saveStateImmediately(): void {
    if (this.stateChanged || true) { // Always save for reliability
      configService.saveSessionStateImmediate(this.state);
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
