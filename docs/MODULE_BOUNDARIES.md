# RhythmDesk Module Boundaries

## Purpose
This document defines clear ownership boundaries between modules to prevent future regressions and maintain architectural consistency.

---

## Ownership Map

```
┌─────────────────────────────────────────────────────────────────┐
│                     APPLICATION LAYERS                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   RENDERER  │  │    TRAY     │  │   OVERLAY   │             │
│  │  (Display)  │  │  (Display)  │  │  (Display)  │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         ▼                ▼                ▼                     │
│  ┌─────────────────────────────────────────────────────────────┤
│  │                     IPC LAYER                               │
│  │              (preload.ts, ipc.ts)                           │
│  └──────────────────────┬──────────────────────────────────────┤
│                         │                                       │
│                         ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┤
│  │                   CORE LAYER                                │
│  │                                                             │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  │   TIMER     │  │   OVERLAY   │  │   CONFIG    │         │
│  │  │   ENGINE    │  │   POLICY    │  │   SERVICE   │         │
│  │  │  (Truth)    │  │  (Decision) │  │  (Delegate) │         │
│  │  └──────┬──────┘  └─────────────┘  └──────┬──────┘         │
│  │         │                                 │                 │
│  │         ▼                                 ▼                 │
│  │  ┌─────────────────────────────────────────────────────────┤
│  │  │               STORAGE LAYER                             │
│  │  │                                                         │
│  │  │  ┌─────────────┐  ┌─────────────┐                       │
│  │  │  │ CONFIG STORE│  │  SESSION    │                       │
│  │  │  │  (Durable)  │  │  SNAPSHOT   │                       │
│  │  │  │             │  │  (Recovery) │                       │
│  │  │  └─────────────┘  └─────────────┘                       │
│  │  └─────────────────────────────────────────────────────────┤
│  └─────────────────────────────────────────────────────────────┤
└─────────────────────────────────────────────────────────────────┘
```

---

## Module Definitions

### 1. Timer Engine (`src/core/timerEngine.ts`)

**OWNS:**
- Live runtime session state (THE source of truth)
- Phase transitions
- Break/transition timing calculations
- Cumulative work time tracking
- Postpone logic
- Pause/resume logic
- Skip/complete logic
- Flow step management
- Schedule resolution

**DOES NOT OWN:**
- Overlay display decisions (→ overlayPolicy)
- Config persistence (→ configService)
- UI state (→ renderer)

**INVARIANTS:**
- `currentPhase` always matches `flowSteps[currentFlowStepIndex]` in flow mode
- `phaseRemainingMs <= phaseTotalMs`
- Postponed state cleared on reset

---

### 2. Config Service (`src/core/configService.ts`)

**OWNS:**
- Unified access to storage
- Delegation to ConfigStore and SessionSnapshot
- Backward compatibility interface

**DOES NOT OWN:**
- Live runtime state (→ timerEngine)
- Storage implementation details (→ configStore, sessionSnapshot)

**ROLE:**
Facade/delegate - routes requests to appropriate storage module.

---

### 3. Config Store (`src/core/storage/configStore.ts`)

**OWNS:**
- Durable user configuration
- Schedules
- General settings
- Rest block presets
- Schema migration

**DOES NOT OWN:**
- Session state (→ sessionSnapshot)
- Runtime state (→ timerEngine)

**INVARIANTS:**
- Data survives app restart
- Schema version tracked
- Defaults applied for missing fields

---

### 4. Session Snapshot (`src/core/storage/sessionSnapshot.ts`)

**OWNS:**
- Session state snapshots for recovery
- Debounced persistence (5s)
- Immediate persistence for critical changes
- Snapshot expiry (24h)

**DOES NOT OWN:**
- Live runtime state (→ timerEngine)
- User configuration (→ configStore)

**INVARIANTS:**
- Snapshots expire after 24 hours
- Malformed snapshots return null (safe recovery)
- Debounce prevents excessive writes

---

### 5. Overlay Policy (`src/core/overlayPolicy.ts`)

**OWNS:**
- All overlay display decisions
- Strict mode determination
- Postpone permission checking
- Focus Lock overlay logic

**DOES NOT OWN:**
- Window creation (→ windowManager)
- Runtime state (→ timerEngine)

**RULES:**
- Work phases: overlay only if Focus Lock active
- Break/transition phases: always show overlay
- Paused/postponed: no overlay
- Idle: no overlay

---

### 6. Window Manager (`src/main/windowManager.ts`)

**OWNS:**
- BrowserWindow lifecycle
- Main window creation
- Overlay window creation
- Window focus management
- Path resolution for renderer

**DOES NOT OWN:**
- Overlay display decisions (→ overlayPolicy)
- Timer state (→ timerEngine)

**INVARIANTS:**
- Only one overlay window at a time
- Strict mode overlay prevents close
- Crashed overlay triggers recovery

---

### 7. Tray (`src/main/tray.ts`)

**OWNS:**
- System tray icon
- Tray menu
- Tooltip updates
- Menu-open freeze behavior

**DOES NOT OWN:**
- Timer state (→ timerEngine)
- Timer actions execution (calls timerEngine)

**CONSUMES:**
- TimerTick events (read-only)

**INVARIANTS:**
- No updates while menu is open
- Tooltip throttled to 5s
- Menu only rebuilds on structural changes

---

### 8. IPC Handlers (`src/main/ipc.ts`)

**OWNS:**
- IPC channel registration
- Request/response mapping
- Channel definitions

**DOES NOT OWN:**
- Business logic (calls timerEngine, configService)
- Window management (calls windowManager)

**ROLE:**
Bridge between renderer and main process.

---

### 9. Preload (`src/main/preload.ts`)

**OWNS:**
- Renderer API exposure
- IPC bridge for renderer
- Type-safe API surface

**DOES NOT OWN:**
- Business logic
- State

**INVARIANTS:**
- Must match ipc.ts channel registrations
- Must match types.ts IPC_CHANNELS

---

### 10. Renderer Components

**OWN:**
- UI display
- User interaction handling
- Local UI state (forms, modals)

**DO NOT OWN:**
- Runtime truth (→ timerEngine via IPC)
- Business logic

**CONSUME:**
- TimerTick via IPC (read-only display)
- Config via IPC (read for display, write via saveSchedule)

---

## Data Flow Summary

```
User Action → Renderer → IPC → Main Process → Timer Engine
                                    ↓
                              State Change
                                    ↓
                              Emit Tick
                                    ↓
                    ┌───────────────┼───────────────┐
                    ↓               ↓               ↓
                Renderer         Tray          Overlay
                (Display)     (Display)      (Display)
```

---

## Critical Rules

### Rule 1: Single Source of Truth
**Timer Engine owns live runtime state.**
All other modules read from TimerTick or query via IPC.

### Rule 2: No Direct State Mutation
Renderer NEVER mutates state directly. Always through IPC → Timer Engine.

### Rule 3: Overlay Policy Decides
All overlay show/hide decisions go through overlayPolicy.ts.

### Rule 4: Storage Separation
- ConfigStore = user configuration (durable)
- SessionSnapshot = recovery snapshots (ephemeral)
- Timer Engine = live state (in-memory truth)

### Rule 5: Tray is Read-Only
Tray displays state but never modifies it except by calling timerEngine methods.

---

## Anti-Patterns to Avoid

1. ❌ Renderer directly modifying state
2. ❌ Tray making overlay decisions
3. ❌ Multiple modules writing session state
4. ❌ Overlay policy checking storage directly
5. ❌ Config store holding runtime state
6. ❌ Timer engine managing windows

---

## Module Interaction Matrix

| From → To | Timer | Config | Store | Snapshot | Policy | Window | Tray | IPC | Renderer |
|-----------|-------|--------|-------|----------|--------|--------|------|-----|----------|
| Timer     | -     | ✓ read | -     | ✓ write  | ✓ call | -      | -    | -   | -        |
| Config    | -     | -      | ✓     | ✓        | -      | -      | -    | -   | -        |
| Store     | -     | -      | -     | -        | -      | -      | -    | -   | -        |
| Snapshot  | -     | -      | -     | -        | -      | -      | -    | -   | -        |
| Policy    | -     | -      | -     | -        | -      | -      | -    | -   | -        |
| Window    | -     | -      | -     | -        | ✓ call | -      | -    | -   | -        |
| Tray      | ✓ call| -      | -     | -        | -      | ✓ call | -    | -   | -        |
| IPC       | ✓ call| ✓ call | -     | -        | -      | ✓ call | -    | -   | -        |
| Renderer  | -     | -      | -     | -        | -      | -      | -    | ✓   | -        |
| Main      | ✓ own | ✓ init | -     | -        | ✓ call | ✓ own  | ✓ own| ✓ reg| -       |

---

## Future Considerations

When adding new features:

1. **New Break Type:** Add to timerEngine transitions, overlayPolicy rules, configStore schema
2. **New UI Panel:** Renderer only, reads via IPC
3. **New Tray Action:** Tray calls timerEngine method
4. **New Storage Field:** Add to appropriate store (config vs snapshot)
5. **New Overlay Behavior:** Modify overlayPolicy.ts ONLY
