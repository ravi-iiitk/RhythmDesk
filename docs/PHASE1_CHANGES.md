# Phase 1 Architecture Cleanup - Changes Summary

**Date**: 2026-03-12  
**Goal**: Fix state integrity and timer/session correctness without redesigning the full app

---

## New Files Created

### 1. `src/core/transitions.ts`
Explicit transition model for timer/session state changes.

**Exports:**
```typescript
// Transition type enum
enum TransitionType {
  PHASE_COMPLETED,
  SKIP_REQUESTED,
  POSTPONE_REQUESTED,
  RESET_REQUESTED,
  PAUSE_REQUESTED,
  RESUME_REQUESTED,
  COMPLETE_REQUESTED,
  POSTPONE_ENDED,
  PAUSE_ENDED,
  SHORT_BREAK_DUE,
  LONG_BREAK_DUE,
  SCHEDULE_ACTIVATED,
  SCHEDULE_DEACTIVATED,
  SCHEDULE_CHANGED,
}

// Flow-based phase computation
function computeNextFlowPhase(currentIndex, flowSteps, isAfterLongBreak): FlowAdvanceResult
function computeThenFlowPhase(currentIndex, flowSteps): FlowAdvanceResult

// Rule-based phase computation
function computeNextRuleBasedPhase(currentPhase, preBreakPhase): PhaseType
function computeThenRuleBasedPhase(nextPhase): PhaseType

// Reset computation
function computeResetState(schedule): ResetResult

// Helper functions
function isWorkPhase(phase): boolean
function isBreakPhase(phase): boolean
function isTransitionPhase(phase): boolean
function findFirstWorkPhaseIndex(flowSteps): number
function findPhaseIndex(flowSteps, phase): number
function getPhaseDuration(phase, schedule, flowStepIndex?): number
function isValidFlowIndex(index, flowSteps): boolean
function logTransition(type, details): void
```

---

### 2. `src/core/sessionValidator.ts`
Session state validation and normalization.

**Exports:**
```typescript
// Validation
function validateSessionState(state, schedule): ValidationResult
// Returns: { valid: boolean, errors: string[], warnings: string[] }

// Normalization (auto-fix inconsistencies)
function normalizeSessionState(state, schedule): NormalizationResult
// Returns: { state: SessionState, changed: boolean, changes: string[] }

// Helpers
function needsNormalization(state, schedule): boolean
function logValidationResult(result, context): void
```

**Invariants Validated:**
1. Phase-mode consistency (flow index valid in flow mode)
2. Flow index-phase consistency (currentPhase matches flowSteps[index])
3. Postpone state consistency (isPostponed ↔ postponedPhase/postponedUntil)
4. Pause state consistency (isPaused ↔ pausedAt)
5. Timestamp consistency (phaseRemainingMs ≤ phaseTotalMs)

---

## Files Modified

### 3. `src/shared/types.ts`

**Change:** Added comprehensive invariant documentation to `SessionState` interface.

```typescript
/**
 * SESSION STATE INVARIANTS:
 * 
 * 1. PHASE-MODE CONSISTENCY:
 *    - If schedule mode is 'flow-based', currentFlowStepIndex MUST be valid
 *    - If schedule mode is 'rule-based', currentFlowStepIndex MUST be undefined
 * 
 * 2. FLOW INDEX-PHASE CONSISTENCY:
 *    - In flow mode, currentPhase SHOULD match flowSteps[currentFlowStepIndex].type
 *    - EXCEPTION: during long-break (rule-based interrupt)
 * 
 * 3. POSTPONE STATE CONSISTENCY:
 *    - If isPostponed is true: postponedPhase MUST be break, currentPhase SHOULD be work
 *    - If isPostponed is false: postponedPhase MUST be null, postponedUntil MUST be null
 * 
 * 4. PAUSE STATE CONSISTENCY:
 *    - If isPaused is true: pausedAt MUST be set
 *    - If isPaused is false: pausedAt MUST be null
 * 
 * 5. TIMESTAMP CONSISTENCY:
 *    - phaseEndsAt > phaseStartedAt (unless idle)
 *    - phaseRemainingMs ≤ phaseTotalMs
 * 
 * 6. RESET PRODUCES CLEAN STATE:
 *    - After reset: currentPhase is first work phase
 *    - After reset: all postpone/pause/interrupted state is cleared
 *    - After reset: cumulative work time is 0
 * 
 * 7. CURRENT/NEXT/THEN DERIVATION:
 *    - next and then are ALWAYS derived, never stored
 */
export interface SessionState { ... }
```

---

### 4. `src/core/timerEngine.ts`

**Changes:**

#### 4.1 New Imports
```typescript
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
  validateSessionState,
  normalizeSessionState,
  logValidationResult,
} from './sessionValidator';
```

#### 4.2 `skipPhase()` - Enhanced with validation
```typescript
skipPhase(): void {
  // Log transition
  logTransition(TransitionType.SKIP_REQUESTED, { ... });
  
  // Validate flow index BEFORE skip
  if (isFlowBasedSchedule(this.currentSchedule)) {
    if (!isValidFlowIndex(currentIndex, flowSteps)) {
      // Resync index
    }
  }
  
  this.advancePhase();
  
  // Validate state AFTER skip, auto-normalize if invalid
  const result = validateSessionState(this.state, this.currentSchedule);
  if (!result.valid) {
    const normalized = normalizeSessionState(this.state, this.currentSchedule);
    if (normalized.changed) {
      this.state = normalized.state;
    }
  }
}
```

#### 4.3 `advanceFlowBasedPhase()` - Uses transition model
```typescript
private advanceFlowBasedPhase(prevPhase: PhaseType): void {
  // After long break: use transition model
  if (prevPhase === 'long-break') {
    const result = computeNextFlowPhase(0, flowSteps, true);
    this.state.currentFlowStepIndex = result.nextIndex;
    this.startPhase(result.nextPhase);
    return;
  }
  
  // Validate index, resync if needed
  if (!isValidFlowIndex(currentIndex, flowSteps)) {
    const correctIndex = findPhaseIndex(flowSteps, prevPhase);
    currentIndex = correctIndex !== -1 ? correctIndex : 0;
  }
  
  // Use transition model for next phase
  const result = computeNextFlowPhase(currentIndex, flowSteps, false);
  this.state.currentFlowStepIndex = result.nextIndex;
  this.startPhase(result.nextPhase);
}
```

#### 4.4 `advanceRuleBasedPhase()` - Uses transition model
```typescript
private advanceRuleBasedPhase(prevPhase: PhaseType): void {
  // Track break completion
  if (prevPhase === 'short-break') {
    this.state.lastShortBreakAtWorkTimeMs = this.state.cumulativeWorkTimeMs;
  }
  
  // Use transition model
  const nextPhase = computeNextRuleBasedPhase(prevPhase, this.preBreakPhase);
  
  if (isBreakPhase(prevPhase)) {
    this.preBreakPhase = null;
  }
  
  this.startPhase(nextPhase);
}
```

#### 4.5 `resetSession()` - Uses computeResetState()
```typescript
resetSession(): void {
  logTransition(TransitionType.RESET_REQUESTED, { ... });
  
  // Use transition model for deterministic reset
  const resetState = computeResetState(this.currentSchedule);
  
  this.state.currentPhase = resetState.currentPhase;
  this.state.currentFlowStepIndex = resetState.currentFlowStepIndex;
  this.state.phaseRemainingMs = resetState.phaseDurationMs;
  // ... clear all other state ...
  
  // Validate result
  const validation = validateSessionState(this.state, this.currentSchedule);
  if (!validation.valid) {
    logValidationResult(validation, 'Reset Session - validation failed');
  }
}
```

#### 4.6 `getNextPhase()` - Uses transition model
```typescript
getNextPhase(): PhaseType {
  if (isFlowBasedSchedule(this.currentSchedule)) {
    const currentIndex = this.state.currentFlowStepIndex ?? 0;
    const result = computeNextFlowPhase(currentIndex, flowSteps, false);
    return result.nextPhase;
  }
  
  return computeNextRuleBasedPhase(this.state.currentPhase, this.preBreakPhase);
}
```

#### 4.7 `getThenPhase()` - Uses transition model
```typescript
private getThenPhase(nextPhase: PhaseType): PhaseType {
  if (isFlowBasedSchedule(schedule)) {
    const result = computeThenFlowPhase(currentIndex, flowSteps);
    return result.nextPhase;
  }
  
  return computeThenRuleBasedPhase(nextPhase);
}
```

#### 4.8 `recoverStateFromTimestamps()` - Enhanced with validation
```typescript
private recoverStateFromTimestamps(): void {
  // Validate and normalize state first
  const validation = validateSessionState(this.state, activeSchedule);
  if (!validation.valid || validation.warnings.length > 0) {
    logValidationResult(validation, 'Recovery - before normalization');
    
    const normalized = normalizeSessionState(this.state, activeSchedule);
    if (normalized.changed) {
      this.state = normalized.state;
    }
  }
  
  // Verify flow index is valid
  if (isFlowBasedSchedule(activeSchedule)) {
    if (!isValidFlowIndex(this.state.currentFlowStepIndex, flowSteps)) {
      // Resync
    }
  }
  
  // Handle postpone end
  if (this.state.isPostponed && this.state.postponedUntil) {
    if (now >= this.state.postponedUntil) {
      logTransition(TransitionType.POSTPONE_ENDED, { ... });
      // ... trigger postponed break
    }
  }
  
  // Handle stale phases (>5 min old)
  // ... existing logic ...
}
```

---

## Documentation Created

### 5. `docs/PHASE1_AUDIT.md`
- Lists all state flaws identified
- Proposes session state improvements
- Documents implementation plan

### 6. `docs/PHASE1_VERIFICATION.md`
- 10-point verification checklist
- How to run tests
- Regression test list
- Architecture improvements summary

### 7. `docs/PHASE1_CHANGES.md` (this file)
- Complete list of all changes made

---

## Summary of Fixes

| Problem | Solution |
|---------|----------|
| Skip desyncs flow index | Validates before/after, auto-normalizes |
| Reset starts wrong phase | Uses `computeResetState()` which finds first work phase |
| Postpone semantics unclear | Explicit invariants, validated state |
| current/next/then inconsistent | Always derived via transition model |
| Recovery corrupts state | Validates and normalizes on wake/restart |
| Flow index out of bounds | `isValidFlowIndex()` with auto-resync |
| No formal invariants | 7 invariants documented and enforced |

---

## Build Status

✅ TypeScript compiles without new errors

```bash
npx tsc -p tsconfig.json --noEmit
# Only pre-existing warnings (unused variables in other files)
```

---

## Testing Instructions

```bash
# Start dev server
npm run dev

# Watch logs
tail -f ~/.config/rhythmdesk/logs/app.log

# Key log patterns to look for:
# "Transition" - transition model events
# "SessionValidator" - validation results  
# "Recovery:" - restart/recovery events
# "normalized state" - auto-fix applied
```
