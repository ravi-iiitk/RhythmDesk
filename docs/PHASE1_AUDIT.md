# Phase 1 Architecture Audit

## 1. Current State Flaws Identified

### 1.1 Config vs Runtime State Mixing

**Problem**: `SessionState` is stored inside `AppConfig` alongside schedule definitions. Editing a schedule can indirectly affect session state because:
- `configService.saveSchedule()` normalizes flow but doesn't consider active session
- `timerEngine.checkScheduleChange()` refreshes schedule without validating session consistency
- Flow hash detection exists but only triggers UI banner, doesn't enforce reset

**Evidence**:
```typescript
// configService.ts - session state embedded in config
interface AppConfig {
  schedules: Schedule[];
  generalSettings: GeneralSettings;
  sessionState: SessionState;  // ← Mixed with config!
}
```

### 1.2 Postpone Semantics Issues

**Problem**: Postpone state is partially correct but has edge cases:
- `isPostponed` correctly indicates pending break exists
- `postponedPhase` stores the pending break correctly
- BUT: `interruptedPhase` vs `prePostponeWorkPhase` are redundant/confusing
- When postpone ends, flow index may not match restored work phase

**Evidence**:
```typescript
// Redundant fields for same concept
interruptedPhase: PhaseType | null;
interruptedPhaseRemainingMs: number;
prePostponeWorkPhase: PhaseType | null;       // ← Same as interruptedPhase?
prePostponeWorkPhaseRemainingMs: number;
```

### 1.3 Skip Semantics Issues

**Problem**: Skip in flow-based mode doesn't properly sync `currentFlowStepIndex`:
- `skipPhase()` calls `advancePhase()` directly
- `advanceFlowBasedPhase()` expects to advance from current index
- BUT: if current phase doesn't match index (e.g., after break interrupt), desync occurs

**Evidence**:
```typescript
// advanceFlowBasedPhase checks for desync but doesn't fully handle it
if (expectedPhaseAtIndex !== prevPhase && !isShortBreak) {
  logger.warn('TimerEngine', 'Flow index desync detected - resyncing');
  // But then still advances from syncedIndex which wasn't updated
}
```

### 1.4 Reset Semantics Issues

**Problem**: `resetSession()` is mostly correct but:
- Finds first work phase (good fix from earlier)
- BUT: doesn't clear `preBreakPhase` member variable (only clears at end)
- Doesn't validate flow index bounds after reset

### 1.5 Current/Next/Then Derivation Issues

**Problem**: `getNextPhase()` and `getThenPhase()` don't account for:
- Pending postponed breaks (should next be the pending break?)
- Flow index mismatches
- Long break interrupts resetting flow to index 0

**Evidence**:
```typescript
// getThenPhase looks 2 steps ahead but uses currentFlowStepIndex
// which may not match currentPhase
const thenIndex = (currentIndex + 2) % flowSteps.length;
```

### 1.6 Flow State Consistency Issues

**Problem**: Multiple places can modify flow state without coordination:
- `advanceFlowBasedPhase()` increments index
- `emitTick()` may resync index if desync detected
- `resetSession()` sets index to first work phase
- `triggerBreak()` doesn't touch index (correct for long-break, unclear for short)

### 1.7 Restart/Recovery Issues

**Problem**: `recoverStateFromTimestamps()` handles basic cases but:
- Doesn't validate `currentFlowStepIndex` bounds
- Doesn't verify flow hash on recovery
- Postpone recovery may have stale work phase

---

## 2. Proposed Minimal Session State Improvements

### 2.1 Session State Invariants (to add as code comments and enforce)

```typescript
/**
 * SESSION STATE INVARIANTS:
 * 
 * 1. PHASE-MODE CONSISTENCY:
 *    - If schedule mode is 'flow-based', currentFlowStepIndex MUST be valid (0 to flowSteps.length-1)
 *    - If schedule mode is 'rule-based', currentFlowStepIndex MUST be undefined
 * 
 * 2. FLOW INDEX-PHASE CONSISTENCY:
 *    - In flow mode, currentPhase MUST match flowSteps[currentFlowStepIndex].type
 *    - EXCEPTION: during long-break (rule-based interrupt), phase won't match
 * 
 * 3. POSTPONE STATE CONSISTENCY:
 *    - If isPostponed is true: postponedPhase MUST be a break phase, currentPhase MUST be work phase
 *    - If isPostponed is false: postponedPhase MUST be null, postponedUntil MUST be null
 * 
 * 4. CURRENT/NEXT/THEN DERIVATION:
 *    - next and then are ALWAYS derived from session state, never stored
 *    - In flow mode: next = flowSteps[(currentFlowStepIndex + 1) % length].type
 *    - EXCEPTION: if isPostponed, next might be the pending break when postpone ends
 * 
 * 5. RESET PRODUCES CLEAN STATE:
 *    - After reset: currentPhase is first work phase
 *    - After reset: all postpone/pause/interrupted state is cleared
 *    - After reset: cumulative work time is 0
 */
```

### 2.2 Consolidated State Fields

Remove redundant fields:
- Keep `interruptedPhase` and `interruptedPhaseRemainingMs`
- Remove `prePostponeWorkPhase` and `prePostponeWorkPhaseRemainingMs` (use interrupted* instead)

### 2.3 Explicit Transition Model

Create `src/core/transitions.ts`:
```typescript
enum TransitionType {
  PHASE_COMPLETED,
  SKIP_REQUESTED,
  POSTPONE_REQUESTED,
  POSTPONE_ENDED,
  RESET_REQUESTED,
  PAUSE_REQUESTED,
  RESUME_REQUESTED,
  BREAK_DUE,
  SCHEDULE_CHANGED,
  SCHEDULE_ENDED,
}
```

---

## 3. Implementation Plan

### Step 1: Add invariant validation helper
### Step 2: Consolidate redundant state fields  
### Step 3: Create transition model
### Step 4: Fix skip to properly advance flow index
### Step 5: Fix postpone to use consolidated fields
### Step 6: Fix reset to validate and normalize
### Step 7: Fix recovery to validate flow state
### Step 8: Add flow normalization to single location

---

## 4. Files to Modify

- `src/shared/types.ts` - Remove redundant fields, add invariant comments
- `src/core/timerEngine.ts` - Main fixes for transitions
- `src/core/configService.ts` - Already has flow normalization
- `src/core/transitions.ts` - NEW: explicit transition model
- `src/core/sessionValidator.ts` - NEW: invariant validation
- `src/core/flowUtils.ts` - Add validation helpers
