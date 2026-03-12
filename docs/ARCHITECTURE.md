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

## Future Considerations

1. **SQLite Migration**: Config service abstraction allows future migration from JSON
2. **Multi-Monitor Support**: Overlay on specific display
3. **Cloud Sync**: Sync schedules across devices
4. **Analytics**: Track break compliance, work patterns
