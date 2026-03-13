# Hybrid Storage Architecture

**Date**: 2026-03-13  
**Goal**: Separate durable configuration from live runtime session state without SQLite.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        HYBRID STORAGE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────┐      ┌───────────────────────────────┐  │
│  │   ConfigStore     │      │    SessionSnapshot            │  │
│  │   (electron-store)│      │    (electron-store)           │  │
│  │                   │      │                               │  │
│  │  • schedules      │      │  • session state snapshots    │  │
│  │  • generalSettings│      │  • debounced writes (5s)      │  │
│  │  • restBlockPresets│     │  • immediate on phase change  │  │
│  │                   │      │  • 24h max age for recovery   │  │
│  └───────────────────┘      └───────────────────────────────┘  │
│           │                              │                      │
│           └──────────────┬───────────────┘                      │
│                          │                                      │
│                          ▼                                      │
│              ┌───────────────────────┐                          │
│              │    ConfigService      │                          │
│              │    (unified API)      │                          │
│              └───────────────────────┘                          │
│                          │                                      │
│                          ▼                                      │
│              ┌───────────────────────┐                          │
│              │    TimerEngine        │                          │
│              │    (in-memory state)  │                          │
│              │    SOURCE OF TRUTH    │                          │
│              └───────────────────────┘                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Storage Components

### 1. ConfigStore (`src/core/storage/configStore.ts`)

**Purpose**: Durable user configuration  
**Backend**: electron-store (`~/.config/rhythmdesk/config.json`)

**Stores**:
| Data | Description |
|------|-------------|
| `schedules` | User-defined work/break schedules |
| `generalSettings` | App preferences (sound, theme, startup) |
| `restBlockPresets` | Custom rest block presets |
| `schemaVersion` | For future migrations |

**Features**:
- Type-safe with TypeScript generics
- Automatic schema migrations
- Flow-based schedule normalization

---

### 2. SessionSnapshot (`src/core/storage/sessionSnapshot.ts`)

**Purpose**: Runtime state snapshots for restart recovery  
**Backend**: electron-store (`~/.config/rhythmdesk/session-snapshot.json`)

**Stores**:
| Data | Description |
|------|-------------|
| `snapshot` | Full SessionState object |
| `savedAt` | Timestamp of last save |
| `schemaVersion` | For migrations |

**Features**:
- **Debounced writes**: 5 seconds (avoids excessive I/O)
- **Immediate writes**: On critical changes (phase change, pause, reset)
- **Max age**: 24 hours (stale snapshots discarded)
- **Flush on quit**: Pending snapshots saved before app exits

---

### 3. In-Memory Session State (TimerEngine)

**Purpose**: LIVE runtime state - **SOURCE OF TRUTH**  
**Location**: `src/core/timerEngine.ts`

**Contains**:
```typescript
interface SessionState {
  activeScheduleId: string | null;
  currentPhase: PhaseType;
  currentFlowStepIndex?: number;
  phaseStartedAt: number;
  phaseEndsAt: number;
  cumulativeWorkTimeMs: number;
  isPaused: boolean;
  isPostponed: boolean;
  postponedUntil: number | null;
  // ... and more
}
```

**Key Principle**: TimerEngine owns the live state. Snapshots are only for recovery.

---

### 4. Migration (`src/core/storage/migration.ts`)

**Purpose**: One-time migration from legacy `config.json`

**Process**:
1. Check if legacy `config.json` exists
2. Import schedules/settings → ConfigStore
3. Import session state → SessionSnapshot
4. Rename legacy file to `config.json.migrated`
5. Log migration completion

**Safety**:
- Original file backed up (not deleted)
- No data loss
- Clear logging

---

## File Changes

### Created Files

| File | Purpose |
|------|---------|
| `src/core/storage/configStore.ts` | Durable config with electron-store |
| `src/core/storage/sessionSnapshot.ts` | Debounced session snapshots |
| `src/core/storage/migration.ts` | Legacy config migration |
| `src/core/storage/index.ts` | Module exports |

### Modified Files

| File | Changes |
|------|---------|
| `src/core/configService.ts` | Rewritten to use hybrid storage |
| `src/core/timerEngine.ts` | Uses `saveSessionStateImmediate()` |
| `src/core/restBlockService.ts` | Uses ConfigStore for presets |
| `src/main/main.ts` | Flushes snapshot on quit |

---

## Storage Locations

After migration, storage is split across two files:

```
~/.config/rhythmdesk/
├── config.json           # ConfigStore: schedules, settings, presets
├── session-snapshot.json # SessionSnapshot: runtime state
└── config.json.migrated  # Backup of legacy file (if migrated)
```

---

## API Reference

### ConfigService (main entry point)

```typescript
// Configuration (immediate persistence)
configService.getSchedules(): Schedule[]
configService.saveSchedule(schedule: Schedule): void
configService.deleteSchedule(id: string): void
configService.getGeneralSettings(): GeneralSettings
configService.saveGeneralSettings(settings: GeneralSettings): void
configService.getRestBlockPresets(): RestBlockPreset[]
configService.saveRestBlockPreset(preset: RestBlockPreset): void
configService.deleteRestBlockPreset(id: string): boolean

// Session state (debounced persistence)
configService.getSessionState(): SessionState
configService.saveSessionState(state: SessionState): void      // Debounced
configService.saveSessionStateImmediate(state: SessionState): void  // Immediate
configService.clearSessionState(): void
configService.flushSessionSnapshot(): void  // Call on app quit
```

### Direct Access (when needed)

```typescript
import { configStore, sessionSnapshot } from './configService';

// ConfigStore
configStore.getSchedules()
configStore.saveSchedule(schedule)

// SessionSnapshot
sessionSnapshot.loadSnapshot()
sessionSnapshot.saveSnapshot(state)      // Debounced
sessionSnapshot.saveSnapshotImmediate(state)  // Immediate
sessionSnapshot.flushPending()
```

---

## Debounce Strategy

| Event | Save Method | Timing |
|-------|------------|--------|
| Timer tick | `saveSessionState()` | Debounced (5s) |
| Phase change | `saveSessionStateImmediate()` | Immediate |
| Pause/Resume | `saveSessionStateImmediate()` | Immediate |
| Session reset | `saveSessionStateImmediate()` | Immediate |
| App quit | `flushSessionSnapshot()` | Immediate |
| System suspend | `saveSessionStateImmediate()` | Immediate |

---

## Recovery Flow

```
App Start
    │
    ▼
┌───────────────────┐
│ Check for legacy  │
│ config.json       │
└─────────┬─────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
 Exists?     No legacy
    │           │
    ▼           │
 Migrate        │
    │           │
    └─────┬─────┘
          │
          ▼
┌───────────────────┐
│ Load snapshot     │
│ (if < 24h old)    │
└─────────┬─────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
 Valid?     Invalid/Old
    │           │
    ▼           ▼
 Resume      Fresh start
 session     (INITIAL_SESSION_STATE)
```

---

## Build Status

✅ TypeScript compiles successfully  
✅ All modules properly exported  
✅ Backward compatibility maintained  
✅ No breaking changes to existing APIs

---

## Testing Checklist

- [ ] Fresh install creates ConfigStore with defaults
- [ ] Schedules persist across app restart
- [ ] General settings persist across app restart
- [ ] Rest block presets persist across app restart
- [ ] Session state recovers after restart (< 24h)
- [ ] Stale session state (> 24h) starts fresh
- [ ] Legacy config.json migrates successfully
- [ ] Legacy file backed up after migration
- [ ] App shutdown flushes pending snapshots
- [ ] System suspend saves state immediately
- [ ] Phase changes save state immediately
- [ ] Normal ticks use debounced saves
