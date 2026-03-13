# Phase 3: Behavior Clarity and Configuration Safety

**Date**: 2026-03-13  
**Goal**: Improve clarity of behavior, configuration safety, and predictability without UI redesign.

---

## Wording Changes

### Dashboard (`DashboardPage.tsx`)

| Before | After |
|--------|-------|
| "⏱️ Worked Today" | "⏱️ Work Time Today" |
| "Next:" | "Next Activity:" |
| "⏳ Short Break in 04:32" | "⏳ Pending Short Break in 04:32" |

### Schedule Form (`ScheduleForm.tsx`)

| Before | After |
|--------|-------|
| "Short Break Every (minutes)" | "Short Break Every (work minutes)" |
| "Long Break Every (minutes)" | "Long Break Every (work minutes)" |
| "Activities follow a configured sequence that repeats" | "Activities follow the exact sequence defined below. The cycle repeats after the final step." |
| "Breaks trigger based on cumulative work time rules" | "Breaks trigger based on cumulative work time (sitting + standing only)" |

---

## New Helper Text

### Flow Mode Explanation
Added info box in schedule editor when Flow Mode is selected:
```
💡 In Flow Mode, activities follow the exact sequence defined below. 
   The cycle repeats after the final step.
```

### Work Time Clarification
Added helper text under short break settings:
```
Work time = sitting + standing only. 
Transitions and breaks don't count unless configured below.
```

---

## Safe Schedule Editing

### Existing Implementation (isFlowStale)
Flow-based schedules already have safety:
- `isFlowStale` flag detects when flow config changes
- Dashboard shows warning banner: "Schedule flow updated"
- "Reset Now" button to apply changes
- Old flow continues until reset

### Dashboard Warning Banner
```
⚠️ Schedule flow updated
   Reset session to apply the new flow order
   [Reset Now]
```

---

## Postpone Feedback

### Clear Pending Break Display
When a break is postponed, dashboard shows:
```
⏳ Pending Short Break in 04:32
```

This makes it clear that:
- The break was postponed, not canceled
- Work continues temporarily
- Break will trigger when countdown ends

---

## Validation Improvements (`validation.ts`)

### New Flow Steps Validation
Added `validateFlowSteps()` function:
- ✅ Flow must have at least one step
- ✅ Flow must contain at least one work step (sit or stand)
- ✅ All step durations must be > 0
- ✅ Step durations must be ≤ 24 hours
- ⚠️ Warning if flow doesn't start with work step (auto-adjusted)

### Existing Validation
Already validates:
- Schedule name (required, ≤50 chars)
- Active days (at least one)
- Sit/Stand durations (> 0, ≤ 120 min)
- Transition durations (≥ 0, ≤ 5 min)
- Break intervals (≥ cycle duration)
- Long break > short break interval

---

## Documentation Added

### `docs/BEHAVIOR_MODEL.md`
Comprehensive documentation of:
- Schedule modes (rule-based vs flow-based)
- Phase types and work time accounting
- Postpone behavior
- Session state management
- Schedule editing safety
- Overlay behavior rules
- State transitions
- Validation rules

---

## Files Modified

| File | Changes |
|------|---------|
| `src/renderer/pages/DashboardPage.tsx` | Wording clarity improvements |
| `src/renderer/components/ScheduleForm.tsx` | Flow mode explanation, break label clarity |
| `src/core/validation.ts` | Flow steps validation |

## Files Created

| File | Purpose |
|------|---------|
| `docs/BEHAVIOR_MODEL.md` | Behavior model documentation |
| `docs/PHASE3_CHANGES.md` | This changes summary |

---

## Build Status
✅ TypeScript compiles successfully

---

## Verification Checklist

### Dashboard Wording
- [ ] "Work Time Today" label visible in stats row
- [ ] "Next Activity:" prefix on next phase
- [ ] Postponed breaks show "Pending [Break Type] in XX:XX"

### Schedule Form
- [ ] Flow mode shows explanation box when selected
- [ ] Short break shows "(work minutes)" label
- [ ] Long break shows "(work minutes)" label
- [ ] Helper text explains what counts as work time

### Flow Mode Safety
- [ ] Editing flow shows "⚠️ Flow Updated" badge
- [ ] Warning banner appears with "Reset Now" button
- [ ] Old flow continues until reset clicked
- [ ] After reset, new flow is active

### Validation
- [ ] Empty flow shows error
- [ ] Flow without work step shows error
- [ ] Zero duration step shows error
- [ ] Invalid flow is auto-normalized on save

### No UI Redesign
- [ ] Dashboard layout unchanged
- [ ] Schedule form layout unchanged
- [ ] Colors and spacing unchanged
- [ ] No new major UI components

---

## Testing Instructions

1. **Dashboard wording**: Start a schedule, verify new labels
2. **Postpone feedback**: Trigger a break, postpone it, verify "Pending" message
3. **Flow explanation**: Edit schedule, switch to Flow Mode, verify info box
4. **Break labels**: In Rule Mode, verify "(work minutes)" labels
5. **Flow safety**: Edit active flow schedule, verify warning banner
6. **Validation**: Try to save invalid flow, verify error messages
