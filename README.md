# PostureGuard

A strict work posture and break scheduler for Linux desktop. Designed for users with back pain / sciatica who need to enforce configurable work schedules alternating between sitting and standing work.

## Features

- **Sit/Stand Cycles**: Configurable sitting and standing work periods with transition breaks
- **Break Management**: Short and long breaks based on cumulative active work time
- **Strict Mode**: Fullscreen overlays that block normal interaction during breaks
- **Postpone System**: Limited postpones per day for when you're in the middle of work
- **Office Focus Lock**: Manual mode to enforce fullscreen blocking during work phases for paid work
- **System Tray**: Quick access to timer state and controls with detailed tooltip
- **Multiple Schedules**: Create named schedules for different work contexts (e.g., "EPAM Day", "Resy Night")
- **Sleep/Wake Recovery**: Timer survives system sleep and recovers state from timestamps
- **Auto-Reopen Overlay**: Break overlays automatically reopen if accidentally closed
- **Local Storage**: All data stored locally in JSON, no cloud sync

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

## Default Schedules

Two sample schedules are created on first run:

### EPAM Day
- Days: Mon-Fri, 08:00-16:00
- Sit: 12 min / Stand: 8 min
- Short break: every 60 min for 5 min
- Long break: every 150 min for 15 min

### Resy Night
- Days: Mon-Sat, 20:00-00:00
- Sit: 10 min / Stand: 10 min
- Short break: every 50 min for 5 min
- Long break: every 120 min for 12 min

## Office Focus Lock

A manual mode for enforcing fullscreen overlay during work phases when doing paid office work:

- **Manual Activation**: User selects a work label (EPAM, Resy, or custom) and duration
- **Duration Options**: 30, 60, 90, 120 minutes or custom
- **Overlay Behavior**: Forces fullscreen takeover during sit/stand phases
- **No Persistence**: Resets on app restart
- **Does NOT affect**: Schedule timing, work time calculations, or break thresholds

## Overlay Logic

| Phase Type | Without Focus Lock | With Focus Lock |
|------------|-------------------|-----------------|
| Sitting Work | Normal window | Fullscreen overlay |
| Standing Work | Normal window | Fullscreen overlay |
| Transitions | Fullscreen overlay | Fullscreen overlay |
| Short Break | Fullscreen overlay | Fullscreen overlay |
| Long Break | Fullscreen overlay | Fullscreen overlay |

## Configuration Storage

Data is stored in `~/.config/posture-guard/config.json`:

- **Schedules**: All schedule configurations
- **Session State**: Current phase, timestamps, postpone counts
- **General Settings**: Sound, dark mode, notifications

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
~/.config/posture-guard/logs/app.log
```

Logs include schedule activation, phase transitions, break triggers, postpone actions, and errors.

## License

MIT
