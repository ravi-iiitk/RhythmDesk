# Phase 1 Verification Checklist

## Summary of Changes

### New Files Created
- `src/core/transitions.ts` - Explicit transition model
- `src/core/sessionValidator.ts` - Session state validation and normalization

### Files Modified
- `src/shared/types.ts` - Added session state invariant documentation
- `src/core/timerEngine.ts` - Integrated transition model and session validator
- `src/core/configService.ts` - Flow normalization on save (from previous fix)

---

## Verification Checklist

### 1. Rule-Based Schedule Works
- [ ] Start app with rule-based schedule active
- [ ] Verify sit → transition → stand → transition cycle works
- [ ] Verify short break triggers after configured work time
- [ ] Verify long break triggers after configured cumulative time
- [ ] Verify skip advances to next phase correctly
- [ ] Verify reset returns to sitting work phase

### 2. Flow-Based Schedule Works
- [ ] Start app with flow-based schedule active
- [ ] Verify flow cycles through configured steps in order
- [ ] Verify `currentFlowStepIndex` increments correctly
- [ ] Verify skip advances flow index and phase together
- [ ] Verify reset returns to first work phase in flow (not necessarily index 0)
- [ ] Verify current/next/then display correctly on dashboard

### 3. Postpone Behavior Correct
- [ ] Trigger a break (short or long)
- [ ] Click postpone with a duration
- [ ] Verify work phase resumes immediately (NOT break phase)
- [ ] Verify `isPostponed` is true in logs
- [ ] Verify `postponedPhase` shows the pending break
- [ ] Wait for postpone to end
- [ ] Verify break phase activates when postpone ends
- [ ] Verify overlay appears for the break

### 4. Pending/Postponed Break State
- [ ] During postpone, verify `currentPhase` is work phase (sit/stand)
- [ ] During postpone, verify `postponedPhase` is break phase
- [ ] Verify these are distinct states (not the same phase)
- [ ] Verify dashboard shows "pending break" indicator

### 5. Skip Keeps Current/Next Sequence Correct
- [ ] In flow mode, note current/next/then phases
- [ ] Click skip
- [ ] Verify old "next" becomes new "current"
- [ ] Verify old "then" becomes new "next"
- [ ] Verify new "then" is derived from flow correctly
- [ ] Repeat skip multiple times, verify sequence stays correct
- [ ] **CRITICAL**: Verify current and next are NEVER the same (unless flow has consecutive duplicates)

### 6. Reset Starts Session Cleanly
- [ ] Click reset during any phase
- [ ] Verify currentPhase is first work phase (sit or stand)
- [ ] Verify cumulative work time is 0
- [ ] Verify postpone state is cleared (isPostponed = false)
- [ ] Verify pause state is cleared (isPaused = false)
- [ ] Verify interrupted phase is cleared
- [ ] In flow mode, verify flowStepIndex is at first work phase

### 7. Editing Active Flow Schedule
- [ ] While flow-based session is active, edit the schedule flow
- [ ] Verify "Flow Updated" banner appears
- [ ] Verify session continues (doesn't crash)
- [ ] Click "Reset Now" to apply new flow
- [ ] Verify new flow order is used after reset
- [ ] **CRITICAL**: Editing should NOT silently corrupt session state

### 8. Current/Next/Then Derived from Real State
- [ ] Check logs during various phases
- [ ] Verify next phase matches `flowSteps[(currentFlowStepIndex + 1) % length]` in flow mode
- [ ] Verify then phase matches `flowSteps[(currentFlowStepIndex + 2) % length]` in flow mode
- [ ] Verify these are computed, not stored values

### 9. Runtime State Survives Restart
- [ ] Note current phase and remaining time
- [ ] Quit app (Cmd+Q / Ctrl+Q)
- [ ] Restart app
- [ ] Verify phase continues (if within 5 min threshold)
- [ ] Verify remaining time is recalculated correctly
- [ ] If postponed, verify postpone state survives restart
- [ ] If phase ended >5 min ago, verify reset to idle

### 10. Flow Index Validation
- [ ] Check logs for "Flow index desync" warnings
- [ ] If desync detected, verify auto-resync happens
- [ ] Verify `currentFlowStepIndex` is always within bounds
- [ ] Verify session validator normalizes invalid state

---

## Known Limitations (Phase 2 Scope)

These items are NOT fixed in Phase 1:
- Tray visual polish
- Overlay visual polish
- Linux packaging
- Dashboard redesign
- Multi-monitor support

---

## How to Run Tests

```bash
# Build and run
npm run dev

# Check logs in real-time
tail -f ~/.config/rhythmdesk/logs/app.log

# Look for these log patterns:
# - "Transition" - transition model logging
# - "SessionValidator" - validation results
# - "Recovery:" - restart/recovery events
# - "FLOW STATE DESYNC" - should be rare now
```

---

## Regression Tests

If any of these fail, there may be a regression:

1. **Basic timer works**: Phase countdown decrements every second
2. **Phase completion**: Automatically advances when timer reaches 0
3. **Pause/Resume**: Pausing stops countdown, resume continues
4. **Schedule activation**: Timer starts when schedule time window begins
5. **Schedule deactivation**: Timer goes idle when schedule time window ends
6. **Config persistence**: Changes to schedules are saved to disk

---

## Architecture Improvements Made

### Before Phase 1
- Ad-hoc transitions scattered in timerEngine
- No formal state validation
- Skip/reset could desync flow index
- Postpone semantics unclear in code
- Recovery had no validation

### After Phase 1
- Explicit transition model (`transitions.ts`)
- Formal session state invariants documented
- Session validator with normalization
- Skip validates and auto-normalizes state
- Reset uses `computeResetState()` for deterministic output
- Recovery validates and normalizes on wake/restart
- All next/then derivation uses transition model
