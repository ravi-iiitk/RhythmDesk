# RhythmDesk

A strict work posture and break scheduler for Linux desktop. Designed for users with back pain / sciatica who need to enforce configurable work schedules alternating between sitting and standing work.

## Features

### Core Features
- **Sit/Stand Cycles**: Configurable sitting and standing work periods with transition breaks
- **Break Management**: Short and long breaks based on cumulative active work time
- **Strict Mode**: Fullscreen overlays that block normal interaction during breaks
- **Postpone System**: Limited postpones per day for when you're in the middle of work
- **System Tray**: Quick access to timer state and controls with detailed tooltip
- **Multiple Schedules**: Create named schedules for different work contexts (e.g., "EPAM Day", "Resy Night")
- **Sleep/Wake Recovery**: Timer survives system sleep and recovers state from timestamps
- **Auto-Reopen Overlay**: Break overlays automatically reopen if accidentally closed
- **Local Storage**: All data stored locally in JSON, no cloud sync

### Schedule Modes
- **Rule-Based**: Traditional mode with sit/stand durations and break intervals
- **Flow-Based**: Define exact sequence of steps (sit → transition → stand → break → ...)

### Flow Controls (Flow-Based Schedules)
- **🔀 Shuffle**: Swap sit/stand positions (start with standing instead of sitting)
- **↩️ Reverse**: True reversal - last step becomes first (even breaks can come first)
- **Flow Updated Banner**: Dashboard shows when flow config changed, click "Reset Now" to apply

### Office Focus Lock
- **Manual Activation**: Select work label and duration (30-120 min)
- **Fullscreen Enforcement**: Forces overlay during sit/stand work phases
- **Strict Mode Option**: Extra blocking during focus lock

### Custom Rest Blocks
- **On-Demand Breaks**: Start custom rest periods anytime
- **Presets**: Save favorite rest block configurations
- **Strict Mode**: Optional full blocking during rest

### Sound Notifications
- **Event Sounds**: Different sounds for breaks, transitions, focus lock, etc.
- **Per-Event Control**: Enable/disable sounds for specific events
- **Volume Control**: Adjustable sound volume

## Technical Stack

- **Electron** - Desktop application framework
- **React** - UI framework
- **TypeScript** - Type-safe JavaScript
- **Vite** - Build tool and dev server

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Install Dependencies

```bash
npm install
```

### Run in Development

```bash
npm run electron:dev
```

### Build for Production

```bash
npm run electron:build
```

This will create AppImage and deb packages in the `release/` directory.

## Architecture

```
src/
  main/           # Electron main process
    main.ts       # Entry point
    tray.ts       # System tray
    windowManager.ts  # Window management
    ipc.ts        # IPC handlers
    preload.ts    # Preload script
  renderer/       # React UI
    pages/        # Page components
    components/   # Reusable components
    styles/       # CSS
  shared/         # Shared types and utilities
    types.ts      # TypeScript interfaces
    constants.ts  # Constants
    timeUtils.ts  # Time utilities
  core/           # Business logic
    timerEngine.ts    # Timer state machine
    scheduleResolver.ts  # Schedule selection
    configService.ts  # Configuration persistence
```

## Timer Logic

The timer engine tracks:

- **Active work time**: Only sit and stand phases count
- **Transitions**: Do NOT count as active work time
- **Breaks**: Do NOT count as active work time
- **Paused/Postponed time**: Does NOT count

Break triggers are based on cumulative active work time, not wall clock.

Priority order:
1. Long break (highest)
2. Short break
3. Transition break
4. Sit/Stand phase

## Schedule Modes

### Rule-Based (Default)
Traditional mode where you set:
- Sit duration (minutes)
- Stand duration (minutes)
- Short break interval and duration
- Long break interval and duration

The timer automatically cycles through phases based on these rules.

### Flow-Based
Define an exact sequence of steps that repeat in order:
```
Example: Sit (12m) → Transition (1m) → Stand (8m) → Transition (1m) → Short Break (5m)
```

Flow-based schedules give you precise control over the exact order and duration of each step.

**Flow Controls:**
- **Shuffle**: Swaps sit/stand blocks (e.g., start with standing)
- **Reverse**: Completely reverses the flow order (last becomes first)

## Overlay Logic

| Phase Type | Without Focus Lock | With Focus Lock |
|------------|-------------------|-----------------|
| Sitting Work | Normal window | Fullscreen overlay |
| Standing Work | Normal window | Fullscreen overlay |
| Transitions | Fullscreen overlay | Fullscreen overlay |
| Short Break | Fullscreen overlay | Fullscreen overlay |
| Long Break | Fullscreen overlay | Fullscreen overlay |

## Configuration Storage

Data is stored in `~/.config/rhythmdesk/`:

- **config.json**: Schedules, general settings, rest block presets
- **session-snapshot.json**: Current phase, timestamps, postpone counts
- **logs/app.log**: Application logs (with rotation)

### Sound Files

Custom sounds can be placed in:
- `~/.config/rhythmdesk/sounds/` (user custom)
- `resources/sounds/` (bundled with app)

Supported formats: WAV, MP3, OGG

## Building & Distribution

### Build AppImage

```bash
npm run dist:appimage
```

### Build Debian Package

```bash
npm run dist:deb
```

### Build All Linux Targets

```bash
npm run dist:linux
```

Output files are placed in `release/` directory.

## Logging

In development, logs are output to console. In production, logs are written to:

```
~/.config/rhythmdesk/logs/app.log
```

Logs include schedule activation, phase transitions, break triggers, postpone actions, and errors.

## License

MIT
