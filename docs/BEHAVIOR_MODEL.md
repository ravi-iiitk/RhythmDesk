# RhythmDesk Behavior Model

This document describes the core behavior model of RhythmDesk for maintainability and clarity.

---

## Schedule Modes

RhythmDesk supports two schedule modes:

### 1. Rule-Based Mode (Default)

**Behavior**: Time-driven with automatic break interrupts.

```
┌─────────────────────────────────────────────────────────────┐
│                    RULE-BASED MODE                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Sit (X min) → Transition → Stand (Y min) → Transition    │
│        ↑                                           │        │
│        └───────────────────────────────────────────┘        │
│                                                             │
│   INTERRUPTS (based on cumulative work time):               │
│   • Short Break triggers every N work minutes               │
│   • Long Break triggers every M work minutes                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key Points**:
- Sit and Stand phases alternate automatically
- Transitions are mandatory between posture changes
- Breaks **interrupt** the current flow when due
- Work time = sitting + standing only (by default)
- Transitions and short breaks can optionally count as work time

**Break Logic**:
- Breaks trigger based on **cumulative work time**, not wall clock
- Short breaks reset their counter after completion
- Long breaks reset their counter after completion
- If both breaks are due simultaneously, long break takes priority

---

### 2. Flow-Based Mode

**Behavior**: Sequence-driven with explicit steps.

```
┌─────────────────────────────────────────────────────────────┐
│                    FLOW-BASED MODE                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Step 1 → Step 2 → Step 3 → ... → Step N → [Loop to 1]    │
│                                                             │
│   Example flow:                                             │
│   Sit(12m) → Transition(1m) → Stand(8m) → Short Break(5m)  │
│                                                             │
│   INTERRUPTS:                                               │
│   • Long Break still triggers based on cumulative work      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key Points**:
- User defines exact sequence of activities
- Sequence repeats after final step
- Short breaks are **part of the sequence**, not interrupts
- Long breaks still interrupt when cumulative work time threshold is reached
- Flow always starts with a work step (auto-normalized if needed)

---

## Phase Types

| Phase | Description | Work Time? |
|-------|-------------|------------|
| `sit` | Working while sitting | ✅ Yes |
| `stand` | Working while standing | ✅ Yes |
| `sit-to-stand-transition` | Adjusting desk to stand | Configurable |
| `stand-to-sit-transition` | Adjusting desk to sit | Configurable |
| `short-break` | Brief rest period | Configurable |
| `long-break` | Extended rest period | ❌ No |
| `idle` | No active schedule | N/A |

---

## Postpone Behavior

**Postpone delays a break, NOT starts a break.**

```
┌─────────────────────────────────────────────────────────────┐
│                    POSTPONE BEHAVIOR                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Break Due → [User clicks +5m] → Continue working          │
│                                   for 5 more minutes        │
│                                                             │
│   During postpone:                                          │
│   • Dashboard shows "Pending Short Break in 04:32"          │
│   • Work phase continues (sit or stand)                     │
│   • Postponed break triggers when timer expires             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key Points**:
- Postpone returns user to work, not to break
- Pending break is tracked and will trigger
- Dashboard clearly shows pending break countdown
- Postpone count limits per break type per day

---

## Session State

### In-Memory (Source of Truth)
The `timerEngine` holds live session state:
- Current phase and remaining time
- Cumulative work time
- Postpone state
- Pause state
- Flow step index (flow mode)

### Persisted Snapshots
Session state is saved periodically for recovery:
- Debounced writes (every 5 seconds)
- Immediate writes on critical changes
- Used to restore session after restart

---

## Schedule Editing Safety

When an active schedule is edited:

**Flow-Based Mode**:
- `isFlowStale` flag is set when flow config changes
- Dashboard shows warning: "Schedule flow updated"
- User must click "Reset Now" to apply changes
- Until reset, old flow continues

**Rule-Based Mode**:
- Duration changes take effect on next phase
- Break interval changes take effect on next break calculation
- No explicit reset required (changes are gradual)

---

## Overlay Behavior

| Condition | Overlay Shown? | Strict Mode? |
|-----------|---------------|--------------|
| Transition phase | ✅ Yes | Per-schedule config |
| Short break | ✅ Yes | Per-schedule config |
| Long break | ✅ Yes | Per-schedule config |
| Work phase (normal) | ❌ No | N/A |
| Work phase (Focus Lock) | ✅ Yes | Per-session config |
| Rest Block | ✅ Yes | Per-block config |

**Strict Mode**:
- Overlay cannot be dismissed early
- Must wait for timer to complete
- No skip button available

---

## Office Focus Lock

**Purpose**: Enforce overlay during work phases for deep focus.

```
┌─────────────────────────────────────────────────────────────┐
│                  OFFICE FOCUS LOCK                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   User activates Focus Lock for X minutes                   │
│   → Overlay shows during ALL phases (including work)        │
│   → Breaks still occur normally                             │
│   → Strict mode prevents early exit (if enabled)            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Rest Blocks

**Purpose**: Manual breaks independent of schedule.

- User-triggered with custom name and duration
- Pauses normal schedule while active
- Shows fullscreen overlay with countdown
- Can be strict mode (no early exit)
- Presets saved for quick access

---

## State Transitions

```
┌─────────────────────────────────────────────────────────────┐
│                  STATE TRANSITIONS                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   idle ──[schedule activates]──► sit/stand                  │
│                                                             │
│   sit ──[timer ends]──► sit-to-stand-transition             │
│   sit-to-stand-transition ──[timer ends]──► stand           │
│                                                             │
│   stand ──[timer ends]──► stand-to-sit-transition           │
│   stand-to-sit-transition ──[timer ends]──► sit             │
│                                                             │
│   ANY_WORK ──[break due]──► short-break/long-break          │
│   break ──[timer ends]──► resume interrupted phase          │
│                                                             │
│   ANY ──[schedule deactivates]──► idle                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Dashboard Sequence Trust

The dashboard always displays:
- **Current**: Active phase from `timerEngine.state.currentPhase`
- **Next Activity**: Derived from flow index or rule logic
- **After That**: Two steps ahead in sequence

**Guarantees**:
- Sequence matches runtime engine state
- Flow mode uses `currentFlowStepIndex` for accuracy
- Stale config shows warning, not wrong sequence

---

## Validation Rules

### All Schedules
- Name required (1-50 characters)
- At least one active day
- Sit/Stand durations > 0
- Transition durations ≤ 5 minutes

### Flow-Based
- At least one step required
- At least one work step (sit or stand)
- All step durations > 0
- Flow auto-normalizes to start with work step

### Rule-Based
- Break intervals ≥ work cycle duration
- Long break interval > short break interval
- Break durations within limits

---

## Cumulative Work Time

**What Counts**:
- ✅ Sitting time (always)
- ✅ Standing time (always)
- ⚙️ Transitions (configurable)
- ⚙️ Short breaks (configurable)
- ❌ Long breaks (never)
- ❌ Rest blocks (never)
- ❌ Paused time (never)

**Used For**:
- Short break trigger threshold
- Long break trigger threshold
- "Work Time Today" dashboard display
