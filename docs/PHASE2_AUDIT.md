# Phase 2 Audit: Overlay + Tray Reliability

## Current State Analysis

### ✅ Already Well-Implemented

#### Overlay Policy (`overlayPolicy.ts`)
- Centralized policy function `getOverlayPolicy()`
- Correct business rules:
  - Work phases (sit/stand): overlay only with Focus Lock
  - Break/transition phases: always show overlay
  - Strict mode from per-break config
  - Paused/postponed: no overlay

#### Window Manager (`windowManager.ts`)
- Crash recovery: `webContents.on('crashed')` handler
- Unresponsive recovery: `on('unresponsive')` handler  
- Health check: `isOverlayHealthy()` function
- Recovery function: `recoverOverlayIfNeeded()`
- Linux kiosk mode for strict phases
- Focus regain with debounce

#### Tray (`tray.ts`)
- Menu open/close tracking (`isMenuOpen`)
- Updates frozen while menu open
- Tooltip throttled (5s cadence)
- Menu rebuilt only on structural changes
- Phase changes trigger immediate tooltip update

#### Main Process (`main.ts`)
- Watchdog for rest blocks (10s interval)
- Overlay health check (2s interval)
- Rest block tick forwarding to overlay
- Centralized overlay policy usage

### ⚠️ Issues Found / Improvements Needed

#### 1. Custom Break Overlay Freeze
**Problem**: Long custom breaks may freeze because:
- Rest block tick is sent via IPC but overlay may not be receiving
- No heartbeat confirmation from overlay to main
- No resync mechanism if overlay misses updates

**Fix Needed**:
- Add overlay heartbeat with watchdog
- Add resync mechanism
- Add dedicated custom break logging

#### 2. Overlay Blank/Frozen State Risk
**Problem**: If overlay renders blank or freezes:
- User could be stuck in kiosk mode
- No fail-safe to detect and recover

**Fix Needed**:
- Add overlay content verification
- Add emergency exit mechanism
- Add blank state detection

#### 3. Missing Phase 2 Debug Logging
**Problem**: No structured logging for overlay/tray events

**Fix Needed**:
- Add overlay lifecycle logging
- Add tray state change logging
- Make issues visible in console

#### 4. Postponed Break Overlay
**Issue**: When postponed break triggers, overlay should show
**Status**: Currently handled in `recoverStateFromTimestamps()` but needs verification

---

## Implementation Plan

### 1. Create `src/core/overlaySync.ts`
- Overlay heartbeat mechanism
- Resync protocol
- Blank state detection
- Emergency recovery

### 2. Enhance `windowManager.ts`
- Add heartbeat listener
- Add blank state detection
- Add emergency escape hatch

### 3. Create `src/core/overlayDebug.ts`
- Structured logging for Phase 2
- Overlay lifecycle events
- Tray state events

### 4. Update `OverlayView.tsx`
- Add heartbeat sender
- Add resync handler
- Add error boundary

### 5. Update `main.ts`
- Integrate overlay sync
- Enhanced watchdog
