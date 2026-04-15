# RhythmDesk

> A smart posture and break reminder app for Linux that helps you maintain healthy work habits with sit/stand schedules and enforced break times.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/platform-Linux-blue.svg)](https://www.linux.org/)
[![Electron](https://img.shields.io/badge/Electron-27.3-47848F.svg)](https://www.electronjs.org/)

Designed for users with back pain, sciatica, or anyone who needs to maintain healthy posture habits during long work sessions. RhythmDesk enforces configurable schedules that alternate between sitting and standing work, with automatic break reminders.

## 📸 Screenshots

<!-- TODO: Add screenshots here -->
_Coming soon_

## ✨ Features

### Core Features
- **Sit/Stand Cycles**: Configurable sitting and standing work periods with smooth transition breaks
- **Break Management**: Smart short and long breaks based on cumulative active work time
- **Strict Mode**: Fullscreen overlays that ensure you actually take breaks (not just dismiss them)
- **Postpone System**: Limited postpones per day for when you're in the middle of critical work
- **System Tray**: Quick access to timer state and controls with detailed real-time tooltip
- **Multiple Schedules**: Create named schedules for different work contexts (weekdays, evenings, weekends)
- **Sleep/Wake Recovery**: Timer survives system sleep/hibernate and recovers state from timestamps
- **Auto-Reopen Overlay**: Break overlays automatically reopen if accidentally closed during strict mode
- **Local Storage**: All data stored locally in JSON files - no cloud, no tracking, complete privacy

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

## 📥 Installation

### Option 1: Download Pre-built Package (Recommended)

1. Go to the [Releases](https://github.com/YOUR_USERNAME/rhythmdesk/releases) page
2. Download the latest `.deb` file for Debian/Ubuntu or `.AppImage` for other distros

**For Debian/Ubuntu:**
```bash
sudo dpkg -i RhythmDesk-0.1.0-amd64.deb
```

**For AppImage:**
```bash
chmod +x RhythmDesk-0.1.0-x86_64.AppImage
./RhythmDesk-0.1.0-x86_64.AppImage
```

**Note:** AppImage requires FUSE. Install it if needed:
```bash
sudo apt install libfuse2  # Debian/Ubuntu
```

### Option 2: Build from Source

See the [Development](#-development) section below.

## 🚀 Quick Start

1. **Launch the app** from your application menu or run `rhythmdesk` in terminal
2. **Create your first schedule:**
   - Click "Schedules" in the sidebar
   - Click "+ Create Schedule"
   - Choose "Rule-Based" for simple setup or "Flow-Based" for custom sequences
   - Set your sit/stand durations and break intervals
   - Enable the schedule
3. **The timer starts automatically** when a schedule is active during its time window
4. **Access controls** from the system tray icon (right-click for menu)

### Example Schedules

The app includes two example schedules on first launch:
- **Weekday Work (Example)**: Rule-based schedule for typical 9-5 work (disabled by default)
- **Focus Session (Example)**: Flow-based schedule with custom step sequence (disabled by default)

Feel free to edit or delete these and create your own!

## Technical Stack

- **Electron** - Desktop application framework
- **React** - UI framework
- **TypeScript** - Type-safe JavaScript
- **Vite** - Build tool and dev server

## 🛠️ Development

### Prerequisites

- Node.js 18+ and npm
- Linux development environment

### Setup

1. **Clone the repository:**
```bash
git clone https://github.com/YOUR_USERNAME/rhythmdesk.git
cd rhythmdesk
```

2. **Install dependencies:**
```bash
npm install
```

3. **Run in development mode:**
```bash
npm run dev
```

This starts the Electron app with hot-reload for both main and renderer processes.

### Build Commands

```bash
# Build for production (AppImage + deb)
npm run dist:linux

# Build only AppImage
npm run dist:appimage

# Build only Debian package
npm run dist:deb

# Type checking
npm run typecheck
```

Built packages are output to the `release/` directory.

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

## 📝 Logging & Debugging

In development, logs are output to console. In production, logs are written to:

```
~/.config/rhythmdesk/logs/app.log
```

Logs include:
- Schedule activation and deactivation
- Phase transitions (sit → stand, breaks, etc.)
- Break triggers and postpone actions
- System sleep/wake recovery
- Errors and warnings

**View logs in real-time:**
```bash
tail -f ~/.config/rhythmdesk/logs/app.log
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- UI powered by [React](https://reactjs.org/)
- Icons from system theme

## 💬 Support

If you encounter any issues or have questions:
- Open an [issue](https://github.com/YOUR_USERNAME/rhythmdesk/issues)
- Check existing issues for solutions

---

**Made with ❤️ for healthier work habits**
