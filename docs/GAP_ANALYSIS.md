# RhythmDesk Gap Analysis

## Professional Quality Improvements Assessment

---

## 1. Robust Timer Engine

### Current State
- ✅ Timer runs in main process via `setInterval`
- ✅ Uses `deltaMs` calculation from `lastTickTime`
- ✅ Persists `SessionState` to disk
- ❌ No system sleep/wake detection
- ❌ No large time jump protection
- ❌ No graceful recovery from renderer crash
- ❌ State derived from interval-based decrements, not timestamps

### Required Changes
- Add `powerMonitor` for sleep/wake events
- Detect time jumps (deltaMs > 5s) and recalculate phase from `phaseStartedAt`
- Add `phaseEndsAt` timestamp for reliable state recovery
- Emit state on renderer reconnect

---

## 2. Centralized State Model

### Current State
- ✅ `SessionState` interface exists in types.ts
- ✅ Persisted via `configService`
- ❌ Missing `phaseEndsAt` for reliable recovery
- ❌ `OfficeFocusLockState` is runtime-only (not in SessionState)

### Required Changes
- Add `phaseEndsAt: number` to SessionState
- Derive remaining time from timestamps, not decrements
- Keep OfficeFocusLock runtime-only (correct behavior)

---

## 3. Overlay Window Reliability

### Current State
- ✅ `alwaysOnTop` with 'screen-saver' level
- ✅ `setVisibleOnAllWorkspaces(true)`
- ✅ Fullscreen and frameless
- ✅ Kiosk mode for strict mode
- ✅ Focus re-grab on blur in strict mode
- ❌ No auto-reopen if overlay accidentally closed
- ❌ No periodic check that overlay is visible when required

### Required Changes
- Add overlay health check every tick
- Auto-reopen overlay if closed during required phase

---

## 4. Tray UX Improvements

### Current State
- ✅ Basic tray with tooltip
- ✅ Menu includes pause/resume/postpone
- ✅ Office Focus Lock menu
- ❌ Tooltip format doesn't match spec exactly
- ❌ Missing "Open Dashboard" menu item
- ❌ Missing "Settings" separate from Dashboard

### Required Changes
- Update tooltip format
- Add "Open Dashboard" menu item
- Reorganize menu structure

---

## 5. Dashboard UX Polish

### Current State
- ✅ Shows current phase, countdown, schedule info
- ✅ Office Focus Lock controls
- ❌ Layout not clearly sectioned
- ❌ Typography could be larger
- ❌ Missing "next break" info
- ❌ Missing "today's schedule window"

### Required Changes
- Add clear section headers
- Improve typography sizes
- Add schedule quick info section

---

## 6. Configuration Validation

### Current State
- ❌ No validation when saving schedules
- ❌ No form error display

### Required Changes
- Create `validateSchedule()` function
- Add validation rules for all numeric fields
- Display errors in schedule form

---

## 7. Logging & Debug Mode

### Current State
- ❌ Only `console.log/error` used
- ❌ No structured logging
- ❌ No log file in production
- ❌ No debug toggle

### Required Changes
- Create `src/core/logger.ts`
- Log to console in dev, file in prod
- Add debug setting to GeneralSettings

---

## 8. Error Handling

### Current State
- ✅ Basic try/catch in configService
- ✅ Global `uncaughtException` handler in main.ts
- ❌ No IPC error handling
- ❌ No user-facing error messages

### Required Changes
- Wrap IPC handlers in try/catch
- Add error notification system
- Log all errors

---

## 9. Linux Desktop Integration

### Current State
- ✅ Basic icon path configured
- ✅ Desktop category set
- ❌ No proper PNG icons in required sizes
- ❌ No autostart implementation
- ❌ StartupWMClass set but may need verification

### Required Changes
- Generate proper icon sizes (16, 32, 48, 64, 128, 256, 512)
- Implement autostart toggle
- Verify desktop entry works

---

## 10. Packaging & Distribution

### Current State
- ✅ electron-builder configured
- ✅ AppImage and deb targets
- ✅ dist:linux script exists
- ❌ No artifactName configured
- ❌ Author field empty
- ❌ No tested builds

### Required Changes
- Add artifactName
- Fill author field
- Test build process

---

## 11. Performance Optimization

### Current State
- ✅ Timer in main process
- ✅ Renderer subscribes via IPC
- ❌ Config saved on every tick (excessive I/O)
- ❌ No debouncing on state saves

### Required Changes
- Debounce state saves (every 5s instead of every tick)
- Only save on actual state changes

---

## 12. Code Structure Cleanup

### Current State
- ✅ Good folder structure (core, main, renderer, shared)
- ✅ Modules properly separated
- ❌ Some dead code possible

### Required Changes
- Review and remove any dead code
- Ensure all exports are used

---

## 13. Documentation

### Current State
- ✅ TEST_CHECKLIST.md exists
- ✅ LINUX_CAVEATS.md exists
- ❌ No comprehensive README
- ❌ No architecture documentation

### Required Changes
- Create proper README.md
- Document architecture

---

## 14. Testing Checklist

### Current State
- ✅ TEST_CHECKLIST.md has basic tests
- ❌ Not comprehensive for all scenarios

### Required Changes
- Expand test checklist

---

## Priority Order

1. **Critical (Timer Reliability)**: #1, #2, #3, #11
2. **Important (UX)**: #4, #5, #6
3. **Professional (Quality)**: #7, #8, #9, #10
4. **Cleanup**: #12, #13, #14

