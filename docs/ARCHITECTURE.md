# RhythmDesk Architecture Documentation

## Overview

RhythmDesk is a desktop application built with **Electron** that helps users maintain healthy work habits by managing sit/stand transitions, breaks, and focus sessions. The app runs in the system tray and displays overlay screens during breaks/transitions.

---

## High-Level Design (HLD)

### System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         RhythmDesk Application                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    IPC Bridge    ┌──────────────────────────────┐ │
│  │              │◄────────────────►│                              │ │
│  │  Main Process│                  │     Renderer Process         │ │
│  │  (Node.js)   │                  │     (React + TypeScript)     │ │
│  │              │                  │                              │ │
│  │ • TimerEngine│                  │ • Dashboard Page             │ │
│  │ • ConfigSvc  │                  │ • Schedules Page             │ │
│  │ • WindowMgr  │                  │ • Settings Page              │ │
│  │ • TrayManager│                  │ • Overlay View               │ │
│  │ • IPC Handler│                  │                              │ │
│  └──────────────┘                  └──────────────────────────────┘ │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────┐                                                   │
│  │ Config File  │  ~/.config/rhythmdesk/config.json                 │
│  │ (JSON)       │                                                   │
│  └──────────────┘                                                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| **Main Process** | `src/main/` | Electron main process, window management, system tray |
| **Renderer Process** | `src/renderer/` | React UI, user interactions |
| **Core Services** | `src/core/` | Business logic (timer, config, validation) |
| **Shared Types** | `src/shared/` | TypeScript types, constants, utilities |

### Data Flow

```
User Action → Renderer → IPC Channel → Main Process → TimerEngine
                                                          │
                                                          ▼
                                                    Config Service
                                                          │
                                                          ▼
                                                    JSON File
```

---

## Low-Level Design (LLD)

### 1. Timer Engine (`src/core/timerEngine.ts`)

The heart of the application. Manages phase transitions, break triggers, and state persistence.

#### State Machine

```
                    ┌─────────────┐
                    │    IDLE     │
                    └──────┬──────┘
                           │ Schedule becomes active
                           ▼
              ┌────────────────────────┐
              │                        │
              ▼                        │
       ┌──────────┐            ┌───────────┐
       │   SIT    │◄──────────►│   STAND   │
       └────┬─────┘            └─────┬─────┘
            │                        │
            │    ┌──────────────┐    │
            └───►│ TRANSITIONS  │◄───┘
                 │ (sit↔stand)  │
                 └──────┬───────┘
                        │
                        ▼
              ┌─────────────────┐
              │  SHORT BREAK    │ (every X min of cumulative work)
              └─────────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │  LONG BREAK     │ (every Y min of cumulative work)
              └─────────────────┘
```

#### Key Methods

| Method | Purpose |
|--------|---------|
| `tick()` | Main loop, called every 1s |
| `advancePhase()` | Transitions to next phase |
| `startPhase(phase)` | Initializes a new phase |
| `postpone(minutes)` | Delays break, continues work |
| `resetSession()` | Resets timer to initial state |
| `shuffleFlow()` | Swaps sit/stand order in flow |
| `reverseFlow()` | Reverses flow order |

#### Schedule Modes

1. **Rule-Based**: Uses `sitMinutes`, `standMinutes`, break intervals
2. **Flow-Based**: Uses `flowSteps[]` array for custom sequences

### 2. Config Service (`src/core/configService.ts`)

Manages persistence of schedules, settings, and session state.

```typescript
interface AppConfig {
  schedules: Schedule[];
  generalSettings: GeneralSettings;
  sessionState: SessionState;
}
```

#### Key Responsibilities
- Load/save config from `~/.config/rhythmdesk/config.json`
- Migrate legacy schedule formats
- Validate and normalize flow configurations

### 3. Window Manager (`src/main/windowManager.ts`)

Manages Electron `BrowserWindow` instances.

#### Windows

| Window | Purpose | Strict Mode Behavior |
|--------|---------|---------------------|
| **Main Window** | Dashboard, settings | Normal window |
| **Overlay Window** | Break/transition display | Fullscreen, always-on-top, kiosk mode |

#### Overlay Strict Mode Features
- `alwaysOnTop: true` with `'screen-saver'` level
- `kiosk: true` for Linux
- Prevents closing via window manager
- Auto-refocuses on blur (debounced)

### 4. IPC Communication (`src/main/ipcHandlers.ts`)

Electron IPC channels for main-renderer communication.

```
Renderer                    Main Process
   │                             │
   │──── TIMER_TICK ────────────►│ (subscribe to tick events)
   │◄─── tick data ──────────────│
   │                             │
   │──── PAUSE ─────────────────►│
   │──── RESUME ────────────────►│
   │──── POSTPONE ──────────────►│
   │──── SKIP_PHASE ────────────►│
   │──── RESET_SESSION ─────────►│
   │                             │
   │──── SHOW_OVERLAY ──────────►│
   │──── CLOSE_OVERLAY ─────────►│
```

### 5. Renderer Components

```
src/renderer/
├── App.tsx                 # Main app with routing
├── pages/
│   ├── DashboardPage.tsx   # Main timer display
│   ├── SchedulesPage.tsx   # Schedule management
│   └── SettingsPage.tsx    # App settings
├── components/
│   ├── OverlayView.tsx     # Break/transition overlay
│   ├── ScheduleForm.tsx    # Schedule editor
│   └── CountdownCard.tsx   # Timer display widget
└── styles/
    └── app.css             # Global styles
```

### 6. Type System (`src/shared/types.ts`)

Key types:

```typescript
type PhaseType = 
  | 'idle' 
  | 'sit' 
  | 'stand' 
  | 'sit-to-stand-transition'
  | 'stand-to-sit-transition'
  | 'short-break' 
  | 'long-break';

interface FlowStep {
  id: string;
  type: FlowStepType;
  durationSeconds: number;
}

interface Schedule {
  id: string;
  name: string;
  mode: 'rule-based' | 'flow-based';
  flowSteps?: FlowStep[];
  // ... break configs, timing, etc.
}

interface SessionState {
  currentPhase: PhaseType;
  currentFlowStepIndex?: number;
  phaseRemainingMs: number;
  cumulativeWorkTimeMs: number;
  isPostponed: boolean;
  postponedPhase?: PhaseType;
  // ... etc.
}
```

---

## Key Design Decisions

### 1. Flow Normalization Invariant
**Rule**: Flow-based schedules must ALWAYS start with a work phase (`sit` or `stand`).

**Enforced at**:
- `reverseFlow()` - rotates array after reversing
- `shuffleFlow()` - maintains work-first order
- `configService.saveSchedule()` - validates on every save
- `resetSession()` - finds first work phase as fallback

### 2. Postpone Behavior
When a break is postponed:
- Break becomes "pending" (`postponedPhase`)
- Work phase resumes immediately
- Cumulative work time continues
- Postponed break triggers after duration

### 3. Strict Mode
Prevents user from:
- Closing overlay window
- Clicking "Done" button early
- Switching away (on supported WMs)

### 4. State Recovery
On app restart or system wake:
- `recoverStateFromTimestamps()` calculates elapsed time
- If phase ended > 5 min ago → reset to idle
- Otherwise → advance to next phase

---

## Build & Development

```bash
# Development
npm run dev          # Start with hot reload

# Build
npm run build        # Compile TypeScript
npm run package      # Create distributable

# Type check
npx tsc --noEmit
```

## File Structure

```
posture-guard/
├── src/
│   ├── main/           # Electron main process
│   │   ├── main.ts
│   │   ├── windowManager.ts
│   │   ├── trayManager.ts
│   │   ├── ipcHandlers.ts
│   │   └── preload.ts
│   ├── core/           # Business logic
│   │   ├── timerEngine.ts
│   │   ├── configService.ts
│   │   ├── scheduleResolver.ts
│   │   ├── validation.ts
│   │   ├── officeFocusLockService.ts
│   │   ├── restBlockService.ts
│   │   └── logger.ts
│   ├── renderer/       # React UI
│   │   ├── App.tsx
│   │   ├── pages/
│   │   ├── components/
│   │   └── styles/
│   └── shared/         # Shared types & utils
│       ├── types.ts
│       ├── constants.ts
│       └── timeUtils.ts
├── docs/
│   └── ARCHITECTURE.md
├── package.json
├── tsconfig.json
├── vite.config.ts
└── electron-builder.json
```

---

## Phase 4: Production Hardening

### Runtime Safety Mechanisms

#### 1. Test Harness (`src/core/testing/testHarness.ts`)

Lightweight test harness for timer/session engine that runs without UI.

**Test Scenarios:**
1. Full flow cycle (sit → transition → stand → transition → break → resume)
2. Skip repeatedly across full flow cycle
3. Postpone break during flow-based schedule
4. Reset during work phase
5. Reset during break phase
6. Restart recovery during work
7. Restart recovery during break
8. Restart recovery during postponed break
9. Edit schedule while active
10. Flow wrap-around

#### 2. Runtime Invariants (`src/core/runtimeInvariants.ts`)

Formal session state invariants with pre/post-transition validation.

**Invariant Categories:**
- `INV-1`: Phase-Mode Consistency
- `INV-2`: Flow Index-Phase Consistency
- `INV-3`: Postpone State Consistency
- `INV-4`: Pause State Consistency
- `INV-5`: Timestamp Consistency
- `INV-6`: Overlay Safety

#### 3. Transition Table (`src/core/transitionTable.ts`)

Explicit transition definitions with preconditions, postconditions, and side effects.

**Transition Categories:**
- Automatic: PHASE_COMPLETED, SHORT_BREAK_DUE, LONG_BREAK_DUE, POSTPONE_ENDED
- User-initiated: SKIP_REQUESTED, POSTPONE_REQUESTED, RESET_REQUESTED
- System: SCHEDULE_ACTIVATED, SCHEDULE_DEACTIVATED, RUNTIME_RECOVERY

### Persistence & Safety

#### 4. Atomic Writes (`src/core/atomicWrite.ts`)

Crash-safe atomic file writes for snapshot persistence.

**Strategy:**
```
write temp → fsync → rename
```

**Features:**
- Atomic rename (safe on most filesystems)
- Backup of last known good snapshot
- Integrity checksum validation
- Fallback to backup on corruption

#### 5. Bootstrap Recovery (`src/core/bootstrapRecovery.ts`)

Deterministic startup sequence and recovery logic.

**Bootstrap Sequence:**
1. STORAGE_INIT → Initialize config store
2. CONFIG_LOAD → Load schedules/settings
3. SNAPSHOT_LOAD → Load persisted session
4. VALIDATE_NORMALIZE → Check and fix state
5. TIMER_INIT → Start timer engine
6. UI_INIT → Create windows

**Recovery Decision Matrix:**
| Condition | Action |
|-----------|--------|
| No snapshot | Start fresh (idle) |
| Snapshot >24h old | Start fresh (idle) |
| Schedule not found | Start fresh (idle) |
| Phase ended >5min ago | Reset to first work |
| Phase ended <5min ago | Advance to next phase |
| Snapshot valid | Resume from snapshot |

### Watchdogs

#### 6. Timer Watchdog (`src/core/watchdog.ts`)

Detects timer stalls and triggers recovery.

**Configuration:**
- Check interval: 5 seconds
- Stall threshold: 3 seconds
- Max consecutive stalls before recovery: 3

**Actions:**
- `reportTick()` - Timer reports healthy tick
- `checkTimerHealth()` - Detects stalls
- `triggerRecovery()` - Emits recovery event

#### 7. Overlay Watchdog (`src/core/watchdog.ts`)

Monitors overlay renderer health via heartbeat.

**Configuration:**
- Heartbeat interval: 1 second
- Timeout: 5 seconds
- Max missed heartbeats: 5

**Actions:**
- `reportHeartbeat()` - Renderer sends heartbeat
- `triggerReload()` - Reloads unresponsive overlay

#### 8. Long Session Guard (`src/core/watchdog.ts`)

Protects against long session issues.

**Limits:**
- Max tick count: 1,000,000
- Max session duration: 24 hours
- Max cumulative work: 12 hours

**Checks:**
- Integer overflow prevention
- Timestamp drift detection
- Cumulative time corruption

### Failsafe & Recovery

#### 9. Failsafe Manager (`src/core/failsafe.ts`)

User-safe failback when state becomes unrecoverable.

**Triggers:**
- 5 consecutive validation failures
- 3 failed normalization attempts
- 10 recovery attempts per session

**Actions:**
- Force reset to known good state
- Log detailed error
- Notify user with recovery message
- Never allow infinite invalid state loops

#### 10. Performance Guard (`src/core/failsafe.ts`)

Monitors and alerts on performance issues.

**Metrics:**
- Tick handler average/max duration
- Tray update frequency
- Snapshot write frequency

**Thresholds:**
- Tick handler: warn if >50ms
- Tray updates: warn if >60/min
- Snapshot writes: warn if >20/min

### Observability

#### 11. Trace Logger (`src/core/traceLogger.ts`)

Optional debug tracing mode for session events.

**Format:**
```
[TRACE] +Ns event details
```

**Events:**
- phase_change, skip, postpone, reset
- break_start, break_end
- recovery, schedule_change
- invariant_violation, watchdog_trigger

#### 12. Dev Diagnostics (`src/renderer/components/DevDiagnostics.tsx`)

Dev-mode-only diagnostics panel.

**Displays:**
- Current phase, schedule mode
- Next/then phases
- Timing info (remaining, cumulative)
- Postpone state
- Break progress
- System status (overlay, paused, stale)

### Overlay Safety (`src/core/overlaySafety.ts`)

**Safety Invariants:**
- `INV-OVERLAY-1`: Never show for idle phase
- `INV-OVERLAY-2`: Close when schedule deactivates
- `INV-OVERLAY-3`: Escape hatch in non-strict mode
- `INV-OVERLAY-4`: Max strict mode duration (30 min)
- `INV-OVERLAY-5`: Renderer crash must not trap user

**Linux Degradation Strategy:**
- Tray: Keep menu static, reduce updates
- Kiosk: Best-effort fullscreen + always-on-top
- Focus stealing: Show notification as backup
- Multi-monitor: Primary monitor only

---

## File Structure (Updated)

```
posture-guard/
├── src/
│   ├── main/
│   ├── core/
│   │   ├── timerEngine.ts
│   │   ├── configService.ts
│   │   ├── runtimeInvariants.ts    # NEW: Session invariants
│   │   ├── transitionTable.ts      # NEW: Transition definitions
│   │   ├── bootstrapRecovery.ts    # NEW: Startup sequence
│   │   ├── overlaySafety.ts        # NEW: Overlay safety
│   │   ├── atomicWrite.ts          # NEW: Crash-safe writes
│   │   ├── watchdog.ts             # NEW: Timer/overlay watchdogs
│   │   ├── failsafe.ts             # NEW: User-safe failback
│   │   ├── traceLogger.ts          # NEW: Event tracing
│   │   ├── testing/
│   │   │   └── testHarness.ts      # NEW: Test scenarios
│   │   └── ...
│   ├── renderer/
│   │   ├── components/
│   │   │   ├── DevDiagnostics.tsx  # NEW: Dev panel
│   │   │   └── ...
│   │   └── ...
│   └── shared/
└── docs/
    └── ARCHITECTURE.md
```

---

## Phase 5: Stability Lockdown

### Error Handling System

#### Centralized Error Handler (`src/core/errorHandler.ts`)

Catches unhandled exceptions in main process with structured logging.

**Global Handlers:**
- `process.on('uncaughtException')` - Fatal errors
- `process.on('unhandledRejection')` - Promise errors
- `process.on('SIGINT')` / `process.on('SIGTERM')` - Shutdown signals

**Error Categories:**
- `uncaught_exception`, `unhandled_rejection`
- `timer_error`, `ipc_error`, `overlay_error`
- `storage_error`, `validation_error`

**Actions:**
- Log structured error info
- Track consecutive errors
- Trigger failsafe after 5 consecutive errors

#### React Error Boundary (`src/renderer/components/ErrorBoundary.tsx`)

Catches renderer errors and provides recovery UI.

### Health Monitoring

#### Health Monitor (`src/core/healthMonitor.ts`)

Lightweight runtime health checker running every 30 seconds.

**Checks:**
| Check | Healthy | Degraded | Unhealthy |
|-------|---------|----------|-----------|
| Timer Engine | No stalls | 1 stall | 2+ stalls |
| Overlay | Heartbeats OK | 1-2 missed | 3+ missed |
| Session State | Valid | Validation failures | Failsafe active |
| Performance | Within limits | High resource use | - |

**Recovery:**
- Attempt automatic recovery
- Trigger failsafe after 3 failures

### Logging System

#### Log Categories (`src/core/logRotation.ts`)

```
[BOOT]    System initialization
[TIMER]   Phase transitions
[SESSION] Runtime state updates
[OVERLAY] Overlay lifecycle
[TRAY]    Tray events
[STORAGE] Persistence events
[ERROR]   Critical issues
[TRACE]   Optional debug trace
[IPC]     IPC communication
[CONFIG]  Configuration changes
[HEALTH]  Health monitoring
```

#### Log Rotation

- Max file size: 5 MB
- Max files: 3 (current + 2 archived)
- Location: `~/.config/rhythmdesk/logs/`

### Config Migration (`src/core/configMigration.ts`)

**Schema Versions:**
| Version | Changes |
|---------|---------|
| 1.0.0 | Initial schema |
| 1.1.0 | Flow-based schedules |
| 1.2.0 | Per-break configuration |
| 1.3.0 | Phase 4/5 runtime fields |

**Migration Process:**
1. Detect current version
2. Run migrations in sequence
3. Add schema version to config
4. Log migration result

### Debug Mode (`src/core/debugMode.ts`)

**Enable via:**
- Environment: `RHYTHMDESK_DEBUG=true`
- Runtime toggle

**When Enabled:**
- Verbose logging
- Session diagnostics panel
- Trace logs
- Invariant assertions

### Safe Shutdown (`src/core/shutdown.ts`)

**Shutdown Sequence:**
1. Stop health monitor
2. Stop timer engine
3. Flush session snapshot
4. Close overlay windows
5. Exit application

**Signal Handling:**
- SIGINT (Ctrl+C)
- SIGTERM (kill)
- app.quit()

**Timeout:** 5 seconds before forced exit

### Integration Points (Phase 5 Verification)

All Phase 4/5 modules are now fully integrated into the main application:

**Initialization Sequence (`main.ts`):**
```
1. setupMainProcessErrorHandlers()  - Install global error handlers
2. initDebugMode()                  - Initialize debug mode from env
3. installShutdownHandlers()        - Install SIGINT/SIGTERM handlers
4. app.whenReady()                  - Electron ready
5. timerWatchdog.start()            - Start timer stall detection
6. healthMonitor.start()            - Start health monitoring
7. timerEngine.start()              - Start timer
```

**Timer Tick Flow:**
```
timerEngine.tick()
  → main.ts receives 'tick' event
  → timerWatchdog.reportTick(phaseRemainingMs)
  → sendToAll(TIMER_TICK, tick)
  → updateTrayWithTick(tick)
```

**Overlay Lifecycle:**
```
Phase change → overlay shows
  → overlayWatchdog.startMonitoring()
  → showOverlay(strictMode)

Phase change → overlay hides
  → closeOverlay()
  → overlayWatchdog.stopMonitoring()
```

---

## File Structure (Final)

```
posture-guard/
├── src/
│   ├── main/
│   │   ├── main.ts
│   │   ├── windowManager.ts
│   │   ├── tray.ts
│   │   ├── ipc.ts
│   │   └── preload.ts
│   ├── core/
│   │   ├── timerEngine.ts
│   │   ├── configService.ts
│   │   ├── runtimeInvariants.ts    # Phase 4: Session invariants
│   │   ├── transitionTable.ts      # Phase 4: Transition definitions
│   │   ├── bootstrapRecovery.ts    # Phase 4: Startup sequence
│   │   ├── overlaySafety.ts        # Phase 4: Overlay safety
│   │   ├── atomicWrite.ts          # Phase 4: Crash-safe writes
│   │   ├── watchdog.ts             # Phase 4: Watchdogs
│   │   ├── failsafe.ts             # Phase 4: Failback
│   │   ├── traceLogger.ts          # Phase 4: Event tracing
│   │   ├── errorHandler.ts         # Phase 5: Error handling
│   │   ├── healthMonitor.ts        # Phase 5: Health monitoring
│   │   ├── logRotation.ts          # Phase 5: Log rotation
│   │   ├── configMigration.ts      # Phase 5: Config migration
│   │   ├── debugMode.ts            # Phase 5: Debug mode
│   │   ├── shutdown.ts             # Phase 5: Safe shutdown
│   │   ├── testing/
│   │   │   └── testHarness.ts
│   │   └── ...
│   ├── renderer/
│   │   ├── components/
│   │   │   ├── ErrorBoundary.tsx   # Phase 5: Error boundary
│   │   │   ├── DevDiagnostics.tsx
│   │   │   └── ...
│   │   └── ...
│   └── shared/
└── docs/
    ├── ARCHITECTURE.md
    └── RELEASE_CHECKLIST.md        # Phase 5: Release checklist
```

---

## Future Considerations

1. **SQLite Migration**: Config service abstraction allows future migration from JSON
2. **Multi-Monitor Support**: Overlay on specific display
3. **Cloud Sync**: Sync schedules across devices
4. **Analytics**: Track break compliance, work patterns
