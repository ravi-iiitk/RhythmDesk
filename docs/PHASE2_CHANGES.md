# Phase 2: Overlay + Tray Reliability - Changes Summary

**Date**: 2026-03-13  
**Goal**: Make overlay behavior and tray behavior reliable, safe, and predictable on Linux.

---

## Files Created

| File | Purpose |
|------|---------|
| `src/core/overlaySync.ts` | Heartbeat watchdog for overlay health monitoring |
| `src/core/overlayDebug.ts` | Structured debug logging for overlay/tray events |
| `docs/PHASE2_AUDIT.md` | Audit findings and implementation plan |

---

## Files Modified

### `src/main/windowManager.ts`
- Added debug logging imports from `overlayDebug.ts`
- Added `logOverlayShow()` call in `showOverlay()`
- Added `logOverlayHide()` call in `closeOverlay()`
- Added `logOverlayCrash()` calls in crash/unresponsive handlers
- Added `logOverlayRecovered()` call in `recoverOverlayIfNeeded()`

### `src/main/tray.ts`
- Added debug logging imports from `overlayDebug.ts`
- Added `logTrayCreated()` in `createTray()`
- Added `logTrayRefreshDeferred()` when updates are frozen
- Added `logTrayMenuOpen()` / `logTrayMenuClose()` for menu tracking
- Added `logTrayRefreshApplied()` when pending updates are applied
- Added `logTrayMenuRebuilt()` when menu state changes
- Added `logTrayTooltipUpdated()` for tooltip updates

### `src/main/main.ts`
- Added imports for `overlayDebug` and `overlaySync`
- Added `logRestBlockStart()` when rest block begins
- Added `logRestBlockTick()` every 10 seconds during rest blocks
- Added `logRestBlockEnd()` when rest block stops/expires
- Started overlay sync watchdog when rest block starts
- Stopped overlay sync watchdog when rest block ends

### `src/main/ipc.ts`
- Added import for `overlaySync`
- Added IPC handler for `HEARTBEAT_RESPONSE` channel

### `src/main/preload.ts`
- Added import for `OVERLAY_SYNC_CHANNELS`
- Added `sendHeartbeatResponse()` to API
- Added `onHeartbeatRequest()` listener to API

### `src/renderer/components/OverlayView.tsx`
- Added `useEffect` import
- Added heartbeat listener that responds to main process heartbeat requests

---

## Overlay Sync Mechanism

### How It Works
1. When rest block starts, main process starts heartbeat watchdog
2. Watchdog sends heartbeat request every 5 seconds via IPC
3. Overlay renderer responds with heartbeat ACK
4. If no response within 10 seconds (2 missed beats), overlay is considered stale
5. Stale overlay triggers recovery (window recreation)

### Constants
- `HEARTBEAT_INTERVAL_MS`: 5000 (5 seconds)
- `HEARTBEAT_TIMEOUT_MS`: 10000 (10 seconds)
- `MAX_MISSED_HEARTBEATS`: 2

---

## Debug Logging Format

### Overlay Events
```
[OVERLAY] event=overlay-show phase=short-break strictMode=false
[OVERLAY] event=overlay-hide reason=close requested
[OVERLAY] event=overlay-crash reason=webContents crashed
[OVERLAY] event=overlay-recovered
[OVERLAY] event=rest-block-start phase=Coffee Break remainingMs=900s strictMode=false
[OVERLAY] event=rest-block-tick phase=Coffee Break remainingMs=890s
[OVERLAY] event=rest-block-end phase=Coffee Break reason=timer completed
```

### Tray Events
```
[TRAY] event=tray-created
[TRAY] event=tray-tooltip-updated phase=sit remainingMs=300s
[TRAY] event=tray-menu-open
[TRAY] event=tray-menu-close
[TRAY] event=tray-refresh-deferred
[TRAY] event=tray-refresh-applied
[TRAY] event=tray-menu-rebuilt reason=state changed
```

---

## Build Status
✅ TypeScript compiles without new errors

---

## Verification Checklist

### Overlay Behavior
- [ ] Short break always opens fullscreen overlay
- [ ] Long break always opens fullscreen overlay
- [ ] Custom rest block always opens fullscreen overlay
- [ ] Postponed break eventually opens fullscreen overlay when timer expires
- [ ] Office Focus Lock makes sit/stand phases also show overlay
- [ ] Overlay closes when phase completes (non-strict mode)
- [ ] Overlay never stays blank during idle state
- [ ] Long custom break keeps updating countdown for full duration
- [ ] Overlay recovers automatically if it crashes

### Tray Behavior
- [ ] Tray menu opens without flicker
- [ ] Tray tooltip shows current phase and time remaining
- [ ] Tray tooltip shows next break info
- [ ] Tray tooltip updates every 5 seconds
- [ ] Tray tooltip updates immediately on phase change
- [ ] Tray menu does NOT rebuild every second
- [ ] Tray updates are frozen while menu is open
- [ ] Pending updates are applied when menu closes

### Console Logs (Dev Mode)
- [ ] `[OVERLAY]` events visible on overlay show/hide
- [ ] `[TRAY]` events visible on tooltip/menu updates
- [ ] `[OVERLAY_SYNC]` events visible during rest blocks
- [ ] Rest block tick logs appear every 10 seconds

### Fail-Safe Behavior
- [ ] Overlay health check runs every 2 seconds
- [ ] Watchdog recovers frozen overlay during rest blocks
- [ ] Crashed overlay is automatically recreated
- [ ] Unresponsive overlay is destroyed and recovered

---

## Testing Instructions

1. **Start dev server**: `npm run dev`
2. **Open console** to see debug logs
3. **Test short break**: Skip to transition, verify overlay opens
4. **Test rest block**: Start 1-minute rest, verify countdown continues
5. **Test tray**: Open tray menu, verify no flicker, verify tooltip updates
6. **Test long rest**: Start 5-minute rest, verify no freeze

---

## Known Limitations

- **Linux WM Alt+Tab**: Some window managers allow Alt+Tab even in strict mode
- **Tray left-click**: May not work on all Linux desktop environments
- **Kiosk mode escape**: Dev mode allows emergency escape; production locks fully
