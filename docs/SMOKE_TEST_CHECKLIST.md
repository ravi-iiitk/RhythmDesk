# RhythmDesk Smoke Test Checklist

## Purpose
Final integration verification before release. Run through each scenario to verify the application works correctly end-to-end.

---

## Pre-Test Setup

```bash
# Clean slate (optional - removes all config)
rm -rf ~/.config/rhythmdesk

# Build fresh
npm run build

# Run in dev mode first
npm run dev
```

---

## Scenario 1: Fresh Start (No Config)

- [ ] App starts without errors
- [ ] Default schedule created
- [ ] Config directory created: `~/.config/rhythmdesk/`
- [ ] Logs directory created: `~/.config/rhythmdesk/logs/`
- [ ] Tray icon visible
- [ ] Dashboard shows "No active schedule" or default schedule

**Pass Criteria:** App starts cleanly with defaults.

---

## Scenario 2: Load Existing Config

- [ ] Create a test schedule in Settings
- [ ] Restart app
- [ ] Schedule persists after restart
- [ ] Session state recovered (if within 24h)

**Pass Criteria:** Config and state survive restart.

---

## Scenario 3: Rule-Based Schedule

- [ ] Create rule-based schedule
- [ ] Set short durations for testing (1-2 min)
- [ ] Timer starts in sit phase
- [ ] Transition overlay appears at phase end
- [ ] Short break triggers after configured time
- [ ] Long break triggers after configured time

**Pass Criteria:** All phases execute in correct order.

---

## Scenario 4: Flow-Based Schedule

- [ ] Create flow-based schedule
- [ ] Define custom flow steps
- [ ] Timer follows flow order exactly
- [ ] Flow wraps around to beginning
- [ ] Flow index stays consistent

**Pass Criteria:** Flow executes as defined.

---

## Scenario 5: Skip Phase

- [ ] Start a work phase
- [ ] Click Skip in tray or dashboard
- [ ] Phase advances correctly
- [ ] Skip multiple phases in succession
- [ ] No state corruption

**Pass Criteria:** Skip works reliably.

---

## Scenario 6: Postpone Short Break

- [ ] Wait for short break to trigger
- [ ] Click Postpone (2/5/10 min)
- [ ] Overlay closes
- [ ] Work continues during postpone
- [ ] Break re-triggers after postpone duration
- [ ] Postpone count increments

**Pass Criteria:** Postpone works correctly.

---

## Scenario 7: Postpone Long Break

- [ ] Wait for long break to trigger
- [ ] Postpone the break
- [ ] Verify work continues
- [ ] Break re-triggers after delay

**Pass Criteria:** Long break postpone works.

---

## Scenario 8: Reset Session

- [ ] Start a session
- [ ] Accumulate some work time
- [ ] Click Reset Session
- [ ] Phase returns to first work phase
- [ ] Cumulative work time resets to 0
- [ ] Postpone counts preserved (not reset)

**Pass Criteria:** Reset clears runtime state correctly.

---

## Scenario 9: Edit Active Schedule

- [ ] While schedule is running, go to Settings
- [ ] Edit the active schedule (change duration)
- [ ] Save schedule
- [ ] Dashboard shows "Flow Updated" banner
- [ ] Click "Reset Now" to apply
- [ ] New durations take effect

**Pass Criteria:** Edits apply correctly after reset.

---

## Scenario 10: Restart Recovery

Test recovery during different phases:

### 10a: During Work Phase
- [ ] Kill app during work phase (`pkill rhythmdesk`)
- [ ] Restart app
- [ ] Phase recovers correctly
- [ ] Time remaining is approximate

### 10b: During Transition
- [ ] Kill app during transition overlay
- [ ] Restart app
- [ ] Verifies state is handled (may reset if >5min old)

### 10c: During Break
- [ ] Kill app during break overlay
- [ ] Restart app
- [ ] Break state recovers or resets appropriately

### 10d: During Postponed Break
- [ ] Kill app while break is postponed
- [ ] Restart app
- [ ] Postponed break triggers if still within window

**Pass Criteria:** App recovers gracefully from crashes.

---

## Scenario 11: Office Focus Lock

- [ ] Start Office Focus Lock from tray
- [ ] Select duration (e.g., 30 min)
- [ ] Overlay appears in strict mode
- [ ] Cannot close overlay
- [ ] Focus Lock indicator in dashboard
- [ ] Stop Focus Lock from tray
- [ ] Overlay closes

**Pass Criteria:** Focus Lock enforces strict mode.

---

## Scenario 12: Custom Rest Block (Long Duration)

- [ ] Start custom rest block (e.g., 30 min)
- [ ] Overlay appears
- [ ] Timer counts down correctly
- [ ] Timer continues updating for full duration
- [ ] Complete or stop early

**Pass Criteria:** Long rest blocks work without freezing.

---

## Scenario 13: Tray Functionality

- [ ] Tray icon visible
- [ ] Right-click shows menu
- [ ] Tooltip shows current phase and time
- [ ] Pause/Resume works from tray
- [ ] Skip Phase works from tray
- [ ] Reset Session works from tray
- [ ] Open Dashboard works
- [ ] Quit works

**Pass Criteria:** All tray actions functional.

---

## Scenario 14: Overlay Behavior

- [ ] Overlay appears fullscreen during breaks
- [ ] Strict mode: cannot close overlay
- [ ] Non-strict mode: can dismiss overlay
- [ ] Overlay closes when phase ends
- [ ] Overlay countdown accurate
- [ ] Overlay shows correct phase info

**Pass Criteria:** Overlay behaves as expected.

---

## Scenario 15: Packaged App Startup

```bash
# Build packaged app
npm run dist:appimage

# Run AppImage
./release/RhythmDesk-*.AppImage
```

- [ ] AppImage launches
- [ ] Tray icon appears
- [ ] Dashboard opens
- [ ] Timer runs correctly
- [ ] Config saved to correct location
- [ ] Icons display correctly

**Pass Criteria:** Packaged app works like dev mode.

---

## Quick Verification Script

For automated basic checks:

```bash
#!/bin/bash
# quick-verify.sh

echo "=== RhythmDesk Quick Verification ==="

# Check config directory
if [ -d ~/.config/rhythmdesk ]; then
    echo "✓ Config directory exists"
    ls -la ~/.config/rhythmdesk/
else
    echo "✗ Config directory missing"
fi

# Check logs directory
if [ -d ~/.config/rhythmdesk/logs ]; then
    echo "✓ Logs directory exists"
else
    echo "✗ Logs directory missing"
fi

# Check for config file
if [ -f ~/.config/rhythmdesk/config.json ]; then
    echo "✓ Config file exists"
else
    echo "? Config file not found (may use electron-store)"
fi

# Check for session snapshot
if [ -f ~/.config/rhythmdesk/session-snapshot.json ]; then
    echo "✓ Session snapshot exists"
else
    echo "? Session snapshot not found"
fi

echo "=== End Verification ==="
```

---

## Post-Test Cleanup (Optional)

```bash
# Remove test config (fresh start next time)
rm -rf ~/.config/rhythmdesk

# Or just remove session to test fresh start
rm ~/.config/rhythmdesk/session-snapshot.json
```

---

## Test Results Template

| Scenario | Status | Notes |
|----------|--------|-------|
| 1. Fresh Start | ☐ | |
| 2. Load Config | ☐ | |
| 3. Rule-Based | ☐ | |
| 4. Flow-Based | ☐ | |
| 5. Skip Phase | ☐ | |
| 6. Postpone Short | ☐ | |
| 7. Postpone Long | ☐ | |
| 8. Reset Session | ☐ | |
| 9. Edit Schedule | ☐ | |
| 10. Restart Recovery | ☐ | |
| 11. Focus Lock | ☐ | |
| 12. Custom Rest | ☐ | |
| 13. Tray | ☐ | |
| 14. Overlay | ☐ | |
| 15. Packaged App | ☐ | |

**Overall Status:** ☐ PASS / ☐ FAIL

**Tester:** ________________  
**Date:** ________________  
**Version:** ________________
