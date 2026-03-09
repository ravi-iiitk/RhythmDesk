# PostureGuard Test Checklist

## NEW: Office Focus Lock Tests

### Office Focus Lock Basic Functionality
- [ ] **Lock OFF default**: On app start, Office Focus Lock is inactive
- [ ] **Start from Dashboard**: Can start Office Focus Lock from dashboard with label selection
- [ ] **Start from Tray (EPAM)**: Can start Office Focus Lock for EPAM from tray menu
- [ ] **Start from Tray (Resy)**: Can start Office Focus Lock for Resy from tray menu
- [ ] **Custom label**: Can enter and use custom work label
- [ ] **Custom duration**: Can enter and start custom duration
- [ ] **Stop from Dashboard**: Can stop Office Focus Lock from dashboard button
- [ ] **Stop from Tray**: Can stop Office Focus Lock from tray menu
- [ ] **Stop from Overlay**: Can stop Office Focus Lock from overlay during work phase
- [ ] **Auto-stop on expiry**: Office Focus Lock automatically stops when duration expires

### Office Focus Lock Overlay Behavior
- [ ] **No overlay during sit (Lock OFF)**: Sitting work shows normal window, NOT fullscreen
- [ ] **No overlay during stand (Lock OFF)**: Standing work shows normal window, NOT fullscreen
- [ ] **Overlay during sit (Lock ON)**: Sitting work shows fullscreen overlay when Lock active
- [ ] **Overlay during stand (Lock ON)**: Standing work shows fullscreen overlay when Lock active
- [ ] **Overlay during transition**: Transitions ALWAYS show fullscreen overlay
- [ ] **Overlay during short break**: Short breaks ALWAYS show fullscreen overlay
- [ ] **Overlay during long break**: Long breaks ALWAYS show fullscreen overlay

### Office Focus Lock State Display
- [ ] **Dashboard indicator**: Lock badge with label appears on dashboard when active
- [ ] **Dashboard countdown**: Dashboard shows Lock remaining time
- [ ] **Tray tooltip**: Tray tooltip shows Lock status, label, and remaining time
- [ ] **Tray menu status**: Tray menu shows Lock status with label
- [ ] **Overlay indicator**: Overlay shows Lock indicator with label during work phases

### Office Focus Lock Independence
- [ ] **Does not affect work time**: Lock does not change cumulative work time tracking
- [ ] **Does not affect breaks**: Break calculations unchanged by Lock
- [ ] **Does not persist**: Lock resets to OFF on app restart
- [ ] **Manual only**: No automatic detection from windows/processes

---

## Timer Engine Robustness

### Sleep/Wake Recovery
- [ ] **System suspend**: Timer state saved before suspend
- [ ] **System resume**: Timer recovers phase from timestamps
- [ ] **Phase expired during sleep**: Advances to next phase on wake
- [ ] **Postpone expired during sleep**: Resumes postponed phase on wake

### Time Jump Protection
- [ ] **Clock adjustment**: Timer detects >5s time jump and recovers
- [ ] **No cumulative drift**: Remaining time accurate after long sleep

### State Persistence
- [ ] **App restart recovery**: Phase and progress restored after restart
- [ ] **Renderer reload**: Timer continues in main process during page refresh
- [ ] **Debounced saves**: State not saved on every tick (performance)

---

## Overlay Reliability

### Auto-Reopen
- [ ] **Accidentally closed overlay**: Overlay reopens within 2 seconds
- [ ] **Break overlay always shows**: Cannot close break overlay permanently
- [ ] **Strict mode blocking**: Cannot dismiss strict mode overlay

### Linux-Specific
- [ ] **Always on top**: Overlay stays above other windows
- [ ] **Visible on all workspaces**: Overlay appears when switching workspace
- [ ] **Kiosk mode in strict**: Cannot minimize or Alt+Tab away (WM dependent)

---

## A. Schedule Activation

- [ ] **No schedules**: App shows "Idle" state when no schedules exist
- [ ] **Schedule active**: App activates correct schedule based on day/time
- [ ] **Schedule overlap**: Earlier-created schedule wins when multiple overlap
- [ ] **Schedule disabled**: Disabled schedules are not activated
- [ ] **Day filtering**: Schedule only activates on configured days
- [ ] **Time range**: Schedule activates within time window, deactivates outside
- [ ] **Overnight schedule**: Schedule spanning midnight works (e.g., 22:00-02:00)

## B. Sit/Stand Transitions

- [ ] **Sit → Transition → Stand**: Transition overlay appears when sit phase ends
- [ ] **Stand → Transition → Sit**: Transition overlay appears when stand phase ends
- [ ] **Transition duration**: Uses configured `transitionDurationSeconds`
- [ ] **Overlay shows**: Fullscreen overlay appears for transitions
- [ ] **Overlay closes**: Overlay closes when transition completes or "Done" clicked
- [ ] **Phase loop**: Full cycle works: sit → transition → stand → transition → sit

## C. Short Break

- [ ] **Trigger timing**: Short break triggers based on cumulative work time only
- [ ] **Work time only**: Transition/break time does NOT count toward short break threshold
- [ ] **Overlay appears**: Fullscreen overlay for short break
- [ ] **Break duration**: Uses configured `shortBreakDurationSeconds`
- [ ] **Resume phase**: After short break, resumes to interrupted phase (sit or stand)
- [ ] **Counter reset**: `lastShortBreakAtWorkTimeMs` updates after break

## D. Long Break

- [ ] **Trigger timing**: Long break triggers based on cumulative work time only
- [ ] **Priority**: Long break overrides short break if both are due
- [ ] **Overlay appears**: Fullscreen overlay for long break
- [ ] **Break duration**: Uses configured `longBreakDurationSeconds`
- [ ] **Full reset**: After long break, starts fresh with sit phase
- [ ] **Counter reset**: `lastLongBreakAtWorkTimeMs` updates after break

## E. Postpone Feature

- [ ] **Postpone enabled**: Postpone buttons appear only when `allowPostpone: true`
- [ ] **Postpone disabled**: No postpone buttons when `allowPostpone: false`
- [ ] **Postpone options**: Shows correct duration options from schedule config
- [ ] **Max postpones**: Cannot exceed `maxPostponesPerDay`
- [ ] **Counter display**: Shows remaining postpones in UI
- [ ] **Overlay closes**: Overlay closes when postpone accepted
- [ ] **Timer pauses**: Phase timer pauses during postpone
- [ ] **Postpone ends**: After postpone time, overlay re-appears
- [ ] **Daily reset**: Postpone counter resets at midnight
- [ ] **Persist state**: Postpone count persists across app restart (same day)

## F. Strict Mode

- [ ] **Kiosk mode**: In strict mode, overlay uses kiosk mode on Linux
- [ ] **No close button**: "Close Overlay" button hidden in strict mode
- [ ] **No skip button**: "Skip" button hidden in strict mode
- [ ] **Focus grab**: Overlay re-focuses if loses focus in strict mode
- [ ] **Always on top**: Overlay stays above other windows
- [ ] **All workspaces**: Overlay visible on all virtual desktops
- [ ] **Can complete**: "Done" button still works to complete phase
- [ ] **Can postpone**: Postpone still works if enabled in schedule
- [ ] **Normal mode**: Non-strict overlays allow close/skip

## G. Packaging (Linux)

### Pre-build
- [ ] **Build succeeds**: `npm run build` completes without errors
- [ ] **TypeScript clean**: `npm run typecheck` passes

### AppImage
- [ ] **Generate**: `npm run dist:linux` creates AppImage in `release/`
- [ ] **Execute**: AppImage runs with `./PostureGuard-*.AppImage`
- [ ] **Permissions**: AppImage has execute permission
- [ ] **Icon**: App icon appears in taskbar/dock

### Deb Package
- [ ] **Generate**: `npm run dist:linux` creates .deb in `release/`
- [ ] **Install**: `sudo dpkg -i postureguard_*.deb` succeeds
- [ ] **Launch**: App launches from application menu
- [ ] **Uninstall**: `sudo dpkg -r postureguard` removes cleanly

### Runtime
- [ ] **Tray icon**: System tray icon appears
- [ ] **Single instance**: Second launch focuses existing window
- [ ] **Persist config**: Settings persist after restart
- [ ] **No sandbox**: App runs with `--no-sandbox` on Linux if needed

---

## Linux-Specific Caveats

### Strict Mode Limitations

1. **Window Manager Dependent**: Some WMs (e.g., i3, sway) may allow switching workspaces even in kiosk mode
2. **Alt+Tab**: Cannot be fully blocked on X11/Wayland without compositor-level integration
3. **Multi-monitor**: Overlay appears on primary display only
4. **Keyboard shortcuts**: WM shortcuts may still work (Super key, etc.)

### Recommended Testing WMs

- GNOME (Wayland) - Best kiosk support
- GNOME (X11) - Good support
- KDE Plasma - Good support
- XFCE - Works but less strict
- i3/sway - Tiling WMs have limitations

### Known Issues

1. **Electron sandbox**: May need `--no-sandbox` on some Linux distros
2. **Tray icon**: Some desktop environments don't show tray icons by default (GNOME needs extension)
3. **AppImage FUSE**: Older systems may need FUSE installed for AppImage

---

## Test Scenarios

### Scenario 1: Basic Workday
1. Create schedule: 09:00-17:00, Mon-Fri
2. Set sit: 25min, stand: 10min, transition: 30sec
3. Enable short break: every 30min, duration 5min
4. Start app during schedule time
5. Verify phases cycle correctly
6. Verify short breaks trigger

### Scenario 2: Strict Mode Break
1. Enable strict mode on schedule
2. Trigger a transition or break
3. Try to close/dismiss overlay
4. Verify only "Done" button works

### Scenario 3: Postpone Limit
1. Set maxPostponesPerDay: 2
2. Postpone twice
3. Verify third postpone is blocked
4. Restart app, verify counter persists
5. Change system date to tomorrow, verify counter resets

### Scenario 4: Long Break Priority
1. Set short break: every 15min
2. Set long break: every 30min
3. Work for 30min
4. Verify long break triggers (not short break)
