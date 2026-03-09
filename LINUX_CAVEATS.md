# PostureGuard - Linux-Specific Caveats

## Strict Fullscreen Overlay Behavior

### What Works Well

1. **Kiosk Mode**: The overlay uses Electron's `kiosk: true` option in strict mode, which provides the strongest fullscreen lock available through Chromium.

2. **Always On Top**: Uses `setAlwaysOnTop(true, 'screen-saver')` - the highest priority level available, placing the window above screen savers.

3. **Visible on All Workspaces**: The overlay is configured to appear on all virtual desktops/workspaces with `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`.

4. **Focus Grab**: In strict mode, the overlay attempts to re-grab focus when it loses it (with a small delay to prevent focus fighting).

5. **Close Prevention**: Window close events are intercepted in strict mode, preventing accidental or intentional closing via window manager.

### Known Limitations

| Issue | Description | Workaround |
|-------|-------------|------------|
| **Alt+Tab** | Cannot be blocked at application level on Linux | Users can still switch windows; overlay will attempt to re-focus |
| **Super/Meta Key** | Window manager hotkeys still work | WM-dependent; some allow disabling |
| **Multi-Monitor** | Overlay appears on primary display only | Consider running on single-monitor setup for strict usage |
| **Tiling WMs** | i3, sway, etc. may tile the overlay | May need WM-specific rules |
| **Wayland Compositors** | Some Wayland compositors may not honor always-on-top | Works best with X11 or GNOME Wayland |

### Desktop Environment Compatibility

| DE/WM | Strict Mode Support | Notes |
|-------|---------------------|-------|
| GNOME (Wayland) | ✅ Good | Best kiosk support |
| GNOME (X11) | ✅ Good | Reliable |
| KDE Plasma | ✅ Good | Works well |
| XFCE | ⚠️ Moderate | Less strict |
| Cinnamon | ✅ Good | Mint-friendly |
| i3/sway | ⚠️ Limited | Tiling may interfere |
| Hyprland | ⚠️ Limited | May need special rules |

### Recommendations for Maximum Strictness

1. **Use GNOME or KDE**: These provide the best kiosk mode support.

2. **Disable Compositor Shortcuts**: Some compositors let you disable Super key and other shortcuts.

3. **WM-Specific Rules**: For tiling WMs, add window rules to float and fullscreen PostureGuard overlays:

   **i3 config example:**
   ```
   for_window [title="PostureGuard Overlay"] floating enable, fullscreen enable
   ```

   **sway config example:**
   ```
   for_window [title="PostureGuard Overlay"] floating enable, fullscreen enable
   ```

4. **Single Monitor**: For strict enforcement, consider using a single monitor during work sessions.

## Electron Sandbox

On some Linux distributions, Electron may fail to start with sandbox errors:

```
FATAL:setuid_sandbox_host.cc(158)] The SUID sandbox helper binary was found, but is not configured correctly
```

### Solutions

1. **AppImage**: The AppImage is built to work without the sandbox by default.

2. **Deb Package**: If you encounter sandbox issues, run with:
   ```bash
   postureguard --no-sandbox
   ```

3. **System-wide Fix**: Configure the sandbox binary (not recommended for security):
   ```bash
   sudo chown root:root chrome-sandbox
   sudo chmod 4755 chrome-sandbox
   ```

## Tray Icon

Some desktop environments don't show system tray icons by default:

- **GNOME**: Install "AppIndicator and KStatusNotifierItem Support" extension
- **KDE**: Works by default
- **XFCE**: Works by default
- **Cinnamon**: Works by default

## AppImage Requirements

AppImage may require FUSE on older systems:

```bash
# Ubuntu/Debian
sudo apt install fuse libfuse2

# Fedora
sudo dnf install fuse fuse-libs

# Arch
sudo pacman -S fuse2
```

## File Permissions

After downloading the AppImage, make it executable:

```bash
chmod +x PostureGuard-*.AppImage
```

## Configuration Location

User configuration is stored in:
```
~/.config/posture-guard/config.json
```

To reset configuration, delete this file.
