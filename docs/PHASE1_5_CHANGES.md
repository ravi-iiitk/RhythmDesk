# Phase 1.5 Runtime Stabilization - Changes Summary

**Date**: 2026-03-13  
**Goal**: Add runtime guardrails and debugging so flow/state bugs become visible and cannot silently corrupt the session.

---

## Files Changed

### 1. NEW: `src/core/sessionDebug.ts`

Structured debug logging and runtime validation module.

**Exports:**
```typescript
// Event logging
logSessionEvent(data: SessionEventData): void

// Flow index normalization
normalizeFlowIndex(index: number | undefined, flowStepsLength: number): number

// Runtime validation
validateRuntimeState(state: SessionState, schedule: Schedule | null, nextPhase: PhaseType): ValidationResult

// Safe recovery
attemptSafeRecovery(state: SessionState, schedule: Schedule | null): RecoveryResult

// Debug snapshot for dashboard
createDebugSnapshot(state, schedule, nextPhase, thenPhase): SessionDebugSnapshot
```

**Event Types Logged:**
- `phaseTransition` - when phase changes
- `skipPhase` - when user skips
- `postponeBreak` - when break is postponed
- `breakStart` - when break begins
- `breakEnd` - when break completes
- `resetSession` - when session is reset
- `restartRecovery` - when app recovers from restart/sleep
- `flowDesync` - when flow index is auto-corrected
- `validationError` - when state validation fails

---

### 2. `src/core/timerEngine.ts`

**Changes:**

#### New Imports
```typescript
import {
  logSessionEvent,
  normalizeFlowIndex,
  validateRuntimeState,
  attemptSafeRecovery,
  createDebugSnapshot,
} from './sessionDebug';
```

#### `skipPhase()` - Enhanced Safety
- Normalizes flow index before skip
- Logs structured event with indexBefore/indexAfter
- Validates and recovers after skip

#### `postpone()` - Validation Added
- Logs postpone event with pending break info
- Validates state after postpone

#### `resetSession()` - Structured Logging
- Logs reset event with cleared state

#### `advancePhase()` - Phase Transition Logging
- Logs every phase transition with from/to phases

#### `triggerBreak()` - Break Start Logging
- Logs when break is triggered

#### `advanceFlowBasedPhase()` - Break End Logging
- Logs when short/long break completes

#### `recoverStateFromTimestamps()` - Recovery Logging
- Logs recovery event at start with full state

#### `emitTick()` - Runtime Validation
- Validates state before every tick
- Auto-recovers on validation failure
- Includes debug snapshot in tick data

---

### 3. `src/shared/types.ts`

**Added to `TimerTick` interface:**
```typescript
debugSnapshot?: {
  currentFlowStepIndex: number | undefined;
  validationStatus: 'ok' | 'warning' | 'error';
  flowStepsCount: number;
};
```

---

### 4. `src/renderer/pages/DashboardPage.tsx`

**Added:** Session Debug Panel (dev mode only)

Displays in dashboard when `NODE_ENV === 'development'`:
- currentPhase
- flowIndex (current / total)
- nextPhase
- cumulativeWork (seconds)
- pendingBreak
- postponeIn (seconds until pending break)
- Validation status badge (OK/WARNING/ERROR)

---

## Example Debug Log Output

```
[TIMER] event=phaseTransition fromPhase=sit toPhase=sit-to-stand-transition indexBefore=0 indexAfter=1 next=stand cumulativeWorkMs=720s
[TIMER] event=skipPhase phase=stand fromPhase=sit-to-stand-transition indexBefore=1 indexAfter=2 next=stand-to-sit-transition
[TIMER] event=postponeBreak phase=sit pendingBreak=short-break postponeUntil=300s cumulativeWorkMs=1800s
[TIMER] event=breakStart phase=short-break fromPhase=sit cumulativeWorkMs=1800s index=0
[TIMER] event=breakEnd phase=short-break cumulativeWorkMs=1800s
[TIMER] event=resetSession phase=sit index=0 cumulativeWorkMs=0s pendingBreak=null
[TIMER] event=restartRecovery phase=stand index=2 pendingBreak=null cumulativeWorkMs=600s
[TIMER] event=flowDesync reason=synced index to phase index=1 phase=sit-to-stand-transition next=stand
```

---

## Runtime Validation Rules

### Flow Index Validation
- Index must be within `[0, flowSteps.length - 1]`
- If out of bounds: auto-wrap to 0

### Phase-Index Consistency
- `currentPhase` should match `flowSteps[currentFlowStepIndex].type`
- Exception: during `long-break` (rule-based interrupt)

### Postpone State Consistency
- If `isPostponed`: `currentPhase` must be work, not break
- `pendingBreakPhase` must be a break type

### Next Phase Validation
- `nextPhase` must not equal `currentPhase` unless flow has consecutive duplicates

---

## Auto-Recovery Behavior

When validation fails, the system attempts safe recovery:

1. **Invalid flow index** → Find correct index for current phase, or reset to 0
2. **Phase-index desync** → Sync index to match current phase
3. **Out of bounds** → Wrap using `normalizeFlowIndex()`

Recovery is logged with `event=flowDesync` for debugging.

---

## Build Status

✅ TypeScript compiles without new errors

---

## Next Steps

- **Manual Testing**: Use dashboard debug panel to verify state during skip/postpone/reset
- **Watch Logs**: Console shows `[TIMER]` events in dev mode
- **Phase 2**: Once stable, proceed with UI polish and packaging
