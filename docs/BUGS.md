# RhythmDesk Bug Tracker

This document tracks bugs, issues, and their resolutions for the RhythmDesk application.

---

## Bug Index

| ID | Title | Status | Severity | Date |
|----|-------|--------|----------|------|
| BUG-001 | System Freeze During Break Overlay | ✅ Fixed | Critical | 2026-03-12 |
| BUG-002 | Reset Starts Break Instead of Work | ✅ Fixed | High | 2026-03-12 |
| BUG-003 | Flow State Desync | ✅ Fixed | Medium | 2026-03-12 |
| BUG-004 | Cannot Enter Comma in Postpone Options | ✅ Fixed | Low | 2026-03-12 |
| BUG-005 | Postpone Buttons Overflow Screen | ✅ Fixed | Low | 2026-03-12 |
| BUG-006 | App Starts in Break on Restart | ✅ Fixed | High | 2026-03-12 |

---

## BUG-001: System Freeze During Break Overlay

**Status**: ✅ Fixed  
**Severity**: Critical  
**Date Reported**: 2026-03-12  
**Date Fixed**: 2026-03-12

### Symptom
App froze during a 4-minute break, overlay showed blank purple screen, entire system became unresponsive. User had to shut down system to recover.

### Steps to Reproduce
1. Have a time-based schedule active (e.g., 18:00 - 00:30)
2. Be in a break phase when the schedule's end time is reached
3. Overlay stays open but shows blank purple screen
4. System becomes unresponsive due to kiosk mode

### Root Cause
Schedule time window ended while overlay was showing a break. The `checkScheduleChange()` method set `currentPhase = 'idle'`, but:
1. No `phaseChange` event was emitted → overlay didn't close
2. `OverlayView` renders blank div when phase is `idle`
3. Overlay in kiosk mode locked the system

### Fix Applied
1. **Emit phaseChange when schedule ends** (`timerEngine.ts`)
   ```typescript
   this.setIdleState();
   this.emit('phaseChange', { prevPhase, newPhase: 'idle' });
   ```

2. **Add crash/unresponsive handlers** (`windowManager.ts`)
   ```typescript
   overlayWindow.webContents.on('crashed', () => { ... });
   overlayWindow.on('unresponsive', () => { ... });
   ```

3. **Debounce blur/focus handler** (`windowManager.ts`)
   - Prevents rapid focus fights that could freeze system

### Files Modified
- `src/core/timerEngine.ts`
- `src/main/windowManager.ts`

---

## BUG-002: Reset Starts Break Instead of Work

**Status**: ✅ Fixed  
**Severity**: High  
**Date Reported**: 2026-03-12  
**Date Fixed**: 2026-03-12

### Symptom
Clicking "Reset" button started a short-break phase instead of sitting work. Overlay kept appearing immediately after reset.

### Steps to Reproduce
1. Use "Reverse" flow feature
2. Click "Reset" button
3. App starts with short-break instead of sit

### Root Cause
`reverseFlow()` reversed the entire `flowSteps` array, putting `short-break` at index 0:
```
Original: sit → transition → stand → transition → short-break
Reversed: short-break → transition → stand → transition → sit
```

`resetSession()` blindly used index 0, which was now `short-break`.

### Fix Applied
1. **Normalize flow after reverse** (`timerEngine.ts`)
   ```typescript
   let newSteps = [...flowSteps].reverse();
   newSteps = this.normalizeFlowToStartWithWork(newSteps);
   ```

2. **Validate on save** (`configService.ts`)
   - `saveSchedule()` now rotates array if it doesn't start with work phase

3. **Find first work phase in reset** (`timerEngine.ts`)
   ```typescript
   for (let i = 0; i < flowSteps.length; i++) {
     if (flowSteps[i].type === 'sit' || flowSteps[i].type === 'stand') {
       startIndex = i;
       break;
     }
   }
   ```

### Files Modified
- `src/core/timerEngine.ts`
- `src/core/configService.ts`

---

## BUG-003: Flow State Desync

**Status**: ✅ Fixed  
**Severity**: Medium  
**Date Reported**: 2026-03-12  
**Date Fixed**: 2026-03-12

### Symptom
Logs showed warnings:
```
FLOW STATE DESYNC DETECTED in emitTick
currentPhase: sit, currentFlowStepIndex: 0, expectedCurrentPhase: short-break
```

### Steps to Reproduce
1. Be in a break phase
2. Postpone the break
3. Flow index may not match restored work phase

### Root Cause
After postponing a break, the `currentFlowStepIndex` wasn't updated to reflect the restored work phase position in the flow.

### Fix Applied
Added resync logic in `emitTick()` to detect and correct index mismatches:
```typescript
const correctIndex = flowSteps.findIndex(s => s.type === currentPhase);
if (correctIndex !== -1 && correctIndex !== currentIndex) {
  this.state.currentFlowStepIndex = correctIndex;
}
```

### Files Modified
- `src/core/timerEngine.ts`

---

## BUG-004: Cannot Enter Comma in Postpone Options

**Status**: ✅ Fixed  
**Severity**: Low  
**Date Reported**: 2026-03-12  
**Date Fixed**: 2026-03-12

### Symptom
User couldn't type comma-separated values in the postpone options input field in Schedule Form.

### Steps to Reproduce
1. Open schedule editor
2. Try to type "2, 5, 10" in postpone options field
3. Comma gets filtered out immediately

### Root Cause
Input handler parsed the value on every keystroke:
```typescript
onChange={(e) => {
  const options = e.target.value.split(',').map(n => parseInt(n));
  // This immediately filtered incomplete input
}}
```

### Fix Applied
Separate raw text state from parsed values:
```typescript
const [postponeOptionsText, setPostponeOptionsText] = useState<string>('2, 5, 10');

// Store raw text on change
onChange={(e) => setPostponeOptionsText(e.target.value)}

// Parse only on blur
onBlur={() => {
  const options = postponeOptionsText.split(',').map(s => parseInt(s.trim(), 10));
  handleChange('postponeOptionsMinutes', options);
}}
```

### Files Modified
- `src/renderer/components/ScheduleForm.tsx`

---

## BUG-005: Postpone Buttons Overflow Screen

**Status**: ✅ Fixed  
**Severity**: Low  
**Date Reported**: 2026-03-12  
**Date Fixed**: 2026-03-12

### Symptom
With many postpone options configured (e.g., 2, 5, 10, 15, 30, 60, 90, 120), buttons extended beyond the overlay screen width.

### Steps to Reproduce
1. Configure many postpone options in schedule
2. Trigger a break
3. Buttons go off-screen

### Root Cause
CSS container lacked flex wrapping:
```css
.postpone-options {
  display: flex;
  gap: 0.5rem;
  /* No flex-wrap */
}
```

### Fix Applied
```css
.postpone-options {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 1rem;
  max-width: 90vw;
}
```

### Files Modified
- `src/renderer/styles/app.css`

---

## BUG-006: App Starts in Break on Restart

**Status**: ✅ Fixed  
**Severity**: High  
**Date Reported**: 2026-03-12  
**Date Fixed**: 2026-03-12

### Symptom
Every app restart immediately showed break overlay, even though the app was closed during a work phase.

### Steps to Reproduce
1. Close app while in any phase
2. Restart app
3. Break overlay appears immediately

### Root Cause
Multiple factors:
1. Session state persisted with `currentPhase: 'short-break'`
2. Flow was reversed in config (break at index 0)
3. `recoverStateFromTimestamps()` advanced to next phase without checking staleness

### Fix Applied
1. **Stale phase detection** (`timerEngine.ts`)
   ```typescript
   const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
   if (timeSincePhaseEnded > STALE_THRESHOLD_MS) {
     this.state.currentPhase = 'idle';
     // Reset to idle instead of advancing
   }
   ```

2. **Flow normalization** (see BUG-002)
   - Ensures work phase is always first

### Files Modified
- `src/core/timerEngine.ts`

---

## Template for New Bugs

```markdown
## BUG-XXX: [Title]

**Status**: 🔴 Open | 🟡 In Progress | ✅ Fixed  
**Severity**: Critical | High | Medium | Low  
**Date Reported**: YYYY-MM-DD  
**Date Fixed**: YYYY-MM-DD

### Symptom
[What the user observed]

### Steps to Reproduce
1. Step 1
2. Step 2
3. Step 3

### Root Cause
[Technical explanation of why the bug occurred]

### Fix Applied
[Code changes or configuration changes made]

### Files Modified
- `path/to/file1.ts`
- `path/to/file2.ts`
```
