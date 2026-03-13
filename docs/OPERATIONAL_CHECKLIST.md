# RhythmDesk Operational Checklist

## Quick Reference for Daily Use

---

## File Locations

| Data | Location |
|------|----------|
| **Config** | `~/.config/rhythmdesk/config.json` |
| **Session Snapshot** | `~/.config/rhythmdesk/session-snapshot.json` |
| **Logs** | `~/.config/rhythmdesk/logs/` |
| **App Binary (AppImage)** | Wherever you downloaded it |
| **App Binary (deb)** | `/usr/bin/rhythmdesk` |

---

## Common Operations

### Start the App

```bash
# If installed via deb
rhythmdesk

# If using AppImage
./RhythmDesk-*.AppImage

# Development mode
cd /path/to/posture-guard
npm run dev
```

### Check App Status

Look for the tray icon in your system tray. Hover over it to see current phase and time remaining.

### Access Dashboard

- Click tray icon (left-click)
- Or right-click tray → "Open Dashboard"

### Change Settings

1. Open Dashboard
2. Navigate to Settings (gear icon)
3. Edit schedule
4. Save changes
5. Click "Reset Now" if editing active schedule

---

## Troubleshooting

### App Won't Start

```bash
# Check if already running
pgrep rhythmdesk

# Kill existing instance
killall rhythmdesk

# Try starting again
rhythmdesk
```

### Runtime Gets Stuck

1. **Try Reset Session:**
   - Right-click tray → "Reset Session"

2. **Try Restart App:**
   ```bash
   killall rhythmdesk
   rhythmdesk
   ```

3. **Clear Session State (keeps config):**
   ```bash
   rm ~/.config/rhythmdesk/session-snapshot.json
   rhythmdesk
   ```

4. **Full Reset (loses all settings):**
   ```bash
   rm -rf ~/.config/rhythmdesk
   rhythmdesk
   ```

### Overlay Won't Close (Strict Mode)

1. **Wait for timer** - strict mode overlay closes when phase completes
2. **Emergency kill:**
   ```bash
   killall rhythmdesk
   # Or
   pkill -9 rhythmdesk
   # Or press Ctrl+Alt+F2 for TTY, then: pkill rhythmdesk
   ```

### Tray Icon Missing

Some Linux desktop environments have tray issues. Try:

```bash
# Install tray support
sudo apt install libappindicator3-1

# Or for GNOME
# Install "AppIndicator Support" extension
```

### No Overlay Appearing

1. Check if schedule is active (tray tooltip)
2. Check if phase requires overlay (breaks/transitions)
3. Check logs for errors:
   ```bash
   cat ~/.config/rhythmdesk/logs/rhythmdesk.log | tail -50
   ```

---

## Debug Mode

Enable verbose logging:

```bash
RHYTHMDESK_DEBUG=true rhythmdesk
```

This enables:
- Verbose logging
- Trace events
- Debug assertions
- Detailed diagnostics

---

## Log Locations

```bash
# Current log
~/.config/rhythmdesk/logs/rhythmdesk.log

# Archived logs (after rotation)
~/.config/rhythmdesk/logs/rhythmdesk.log.1
~/.config/rhythmdesk/logs/rhythmdesk.log.2

# View recent logs
tail -100 ~/.config/rhythmdesk/logs/rhythmdesk.log

# Watch logs live
tail -f ~/.config/rhythmdesk/logs/rhythmdesk.log
```

---

## Backup / Restore Config

### Backup

```bash
cp -r ~/.config/rhythmdesk ~/rhythmdesk-backup
```

### Restore

```bash
killall rhythmdesk
rm -rf ~/.config/rhythmdesk
cp -r ~/rhythmdesk-backup ~/.config/rhythmdesk
rhythmdesk
```

---

## Autostart Setup

### GNOME / Ubuntu

1. Open "Startup Applications"
2. Add new entry:
   - Name: RhythmDesk
   - Command: `rhythmdesk` (or full path to AppImage)
   - Comment: Posture reminder app

### KDE

1. System Settings → Autostart
2. Add script/application
3. Point to `rhythmdesk` or AppImage

### Manual (systemd user service)

Create `~/.config/systemd/user/rhythmdesk.service`:

```ini
[Unit]
Description=RhythmDesk Posture Reminder
After=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/bin/rhythmdesk
Restart=on-failure

[Install]
WantedBy=default.target
```

Enable:
```bash
systemctl --user enable rhythmdesk
systemctl --user start rhythmdesk
```

---

## Health Check

Quick verification that app is working:

1. ✓ Tray icon visible
2. ✓ Tooltip shows phase info
3. ✓ Timer counting down
4. ✓ Dashboard opens
5. ✓ Schedule listed in Settings

If any fail, check logs or restart app.

---

## Emergency Contacts

If you encounter a bug:

1. Check logs: `~/.config/rhythmdesk/logs/`
2. Note the steps to reproduce
3. File an issue with:
   - RhythmDesk version
   - Linux distro and version
   - Desktop environment
   - Log excerpt
   - Steps to reproduce

---

## Version Check

```bash
# Check installed version
rhythmdesk --version
# Or look at About in Settings
```

---

## Uninstall

### AppImage
Just delete the AppImage file.

### Deb Package
```bash
sudo apt remove rhythmdesk
```

### Remove All Data
```bash
rm -rf ~/.config/rhythmdesk
```
