# RhythmDesk Integration Audit - Phase 5

## Audit Date: March 2026

## Overview

This document summarizes the integration audit performed before Phase 5 Stability Lockdown.
The audit examines integration between all major modules after the Phase 3 and Phase 4 architectural changes.

---

## CRITICAL INTEGRATION GAPS (FIXED)

### GAP-1: Phase 4/5 Modules Not Integrated into Main Process ✅ FIXED

The following Phase 4/5 modules are now integrated into `main.ts`:

| Module | Function | Status |
|--------|----------|--------|
| `errorHandler.ts` | `setupMainProcessErrorHandlers()` | ✅ INTEGRATED |
| `shutdown.ts` | `installShutdownHandlers()` | ✅ INTEGRATED |
| `healthMonitor.ts` | `getHealthMonitor().start()` | ✅ INTEGRATED |
| `debugMode.ts` | `initDebugMode()` | ✅ INTEGRATED |

**Fix Applied:**
Added initialization calls to `main.ts` in the proper boot sequence (before app ready).

---

### GAP-2: Watchdog Connected to Timer Engine ✅ FIXED

The `TimerWatchdog` now receives tick reports from `main.ts` tick handler.

**Fix Applied:**
- `main.ts` now calls `timerWatchdog.reportTick(tick.phaseRemainingMs)` on each tick
- Overlay watchdog starts/stops monitoring when overlay shows/hides

**Result:**
- Timer stall detection is functional
- Health monitor's timer check works correctly

---

### GAP-3: Atomic Writes Not Used for Session Snapshots

**Severity: MEDIUM**

`atomicWrite.ts` was created but `sessionSnapshot.ts` still uses direct electron-store writes.

**Evidence:**
- `sessionSnapshot.ts` uses `this.store.set()` directly
- No call to `atomicWriteSync()` or `writeSnapshotSafe()`

**Impact:**
- Session snapshots can be corrupted on crash during write
- No backup file for recovery

**Fix Required:**
Consider whether to integrate atomic writes with electron-store or document that electron-store already provides sufficient safety.

---

### GAP-4: Trace Logger Now Used in Timer Engine ✅ FIXED

**Fix Applied:**
- Added `import { trace } from './traceLogger'` to timerEngine.ts
- Added trace calls for: postpone, skip, reset operations

**Result:**
- Debug tracing now shows timer engine events
- Long session debugging is easier

---

### GAP-5: Overlay Watchdog Now Integrated ✅ FIXED

**Fix Applied:**
- `main.ts` now calls `overlayWatchdog.startMonitoring()` when overlay shows
- `main.ts` now calls `overlayWatchdog.stopMonitoring()` when overlay hides

**Result:**
- Overlay hang detection is functional
- Users cannot be trapped in blank fullscreen overlay

---

## INTEGRATION VERIFICATION RESULTS

### A. Config + Runtime Session

| Check | Status | Notes |
|-------|--------|-------|
| Schedule save works | ✅ OK | `configStore.saveSchedule()` |
| Edit doesn't corrupt active session | ✅ OK | `runtimeFlowSnapshot` isolates active session |
| Reset applies new config | ✅ OK | `freezeFlowSnapshot()` on reset |

### B. Runtime Session + Dashboard

| Check | Status | Notes |
|-------|--------|-------|
| Current/next/then phases match | ✅ OK | TimerTick sent on every tick |
| Work time consistent | ✅ OK | `cumulativeWorkTimeMs` in tick |
| Postponed state shown | ✅ OK | `isPostponed`, `pendingBreakPhase` in tick |

### C. Runtime Session + Overlay

| Check | Status | Notes |
|-------|--------|-------|
| Required phases show overlay | ✅ OK | `overlayPolicy.ts` handles this |
| Overlay hides when not needed | ✅ OK | `closeOverlay()` called |
| Overlay synced with phase | ⚠️ PARTIAL | OverlaySync service exists but heartbeat incomplete |

### D. Runtime Session + Tray

| Check | Status | Notes |
|-------|--------|-------|
| Tray tooltip reflects state | ✅ OK | `updateTrayWithTick()` |
| Menu actions work | ✅ OK | Actions call timerEngine directly |
| No stale state after reset | ✅ OK | Tick emitted after reset |

### E. IPC + Main Process

| Check | Status | Notes |
|-------|--------|-------|
| All channels registered | ✅ OK | `registerIpcHandlers()` complete |
| Preload matches IPC contract | ✅ OK | `preload.ts` matches `ipc.ts` |
| No outdated channels | ✅ OK | Reviewed IPC_CHANNELS |

### F. Flow Mode + Rule Mode

| Check | Status | Notes |
|-------|--------|-------|
| Each mode executes correctly | ✅ OK | Separate code paths in timerEngine |
| No flow assumptions in rule mode | ✅ OK | `isFlowBasedSchedule()` guards |
| No rule assumptions in flow mode | ✅ OK | Flow uses `getRuntimeFlowSteps()` |

### G. Storage + Recovery

| Check | Status | Notes |
|-------|--------|-------|
| Session snapshot restore | ✅ OK | `sessionSnapshot.loadSnapshot()` |
| Config migration exists | ✅ OK | `configMigration.ts` created |
| Bootstrap order consistent | ⚠️ PARTIAL | `bootstrapRecovery.ts` exists but not used |

---

## MODULE INTEGRATION MATRIX

| Module | Imports From | Imported By | Integration Status |
|--------|--------------|-------------|-------------------|
| timerEngine | configService, transitions, sessionValidator, runtimeInvariants | main, ipc, tray | ✅ Core integration OK |
| configService | configStore, sessionSnapshot | timerEngine, main, ipc | ✅ Core integration OK |
| errorHandler | failsafe, traceLogger | (none) | ❌ NOT INTEGRATED |
| healthMonitor | watchdog, failsafe, traceLogger | shutdown | ❌ NOT INTEGRATED |
| watchdog | traceLogger | healthMonitor | ❌ NOT INTEGRATED |
| failsafe | transitions, traceLogger | errorHandler, healthMonitor | ✅ Internally consistent |
| traceLogger | logger | watchdog, failsafe, errorHandler, shutdown, healthMonitor | ✅ Used by Phase 4/5 modules |
| atomicWrite | logger | (none) | ❌ NOT INTEGRATED |
| shutdown | healthMonitor, traceLogger | (none) | ❌ NOT INTEGRATED |
| debugMode | traceLogger | (none) | ❌ NOT INTEGRATED |
| configMigration | logger | (none) | ❌ NOT INTEGRATED |
| bootstrapRecovery | (various) | (none) | ❌ NOT INTEGRATED |

---

## RECOMMENDED FIXES (Priority Order)

### Priority 1: Critical Integration

1. **Integrate error handlers in main.ts**
   - Call `setupMainProcessErrorHandlers()` early in boot
   - Catches uncaught exceptions

2. **Integrate shutdown handlers**
   - Call `installShutdownHandlers()` in main.ts
   - Ensures clean shutdown on SIGINT/SIGTERM

3. **Integrate health monitor**
   - Start health monitor after timer engine
   - Provides runtime health checks

4. **Connect timer watchdog to timer engine**
   - Add `reportTick()` call in timerEngine.tick()
   - Enables stall detection

### Priority 2: Important Enhancements

5. **Add trace logging to timer engine**
   - Import trace logger
   - Add trace calls for phase changes, postpone, reset

6. **Start overlay watchdog with overlay**
   - Call `startMonitoring()` when overlay opens
   - Call `stopMonitoring()` when overlay closes

7. **Integrate debug mode**
   - Call `initDebugMode()` in main.ts
   - Enables RHYTHMDESK_DEBUG environment variable

### Priority 3: Nice to Have

8. **Integrate config migration**
   - Call migration on config load
   - Future-proofs config changes

9. **Consider atomic writes for session snapshot**
   - Evaluate if electron-store is sufficient
   - Document decision

---

## CONCLUSION

The core timer/session/UI integration is sound. The Phase 3 architectural changes (runtime flow snapshot, session isolation, etc.) are working correctly.

However, the **Phase 4/5 production hardening modules were created but not integrated** into the main application flow. This means:

- Error handling is not active
- Health monitoring is not running
- Watchdogs are not watching
- Graceful shutdown is not handling signals
- Debug mode toggle has no effect

**These must be integrated before release.**
