# RhythmDesk App Icons

This folder contains app icons in multiple sizes for Linux packaging and runtime.

## Icon Files

| File | Size | Purpose |
|------|------|---------|
| `512x512.png` | 512×512 | Linux high-DPI displays, app stores |
| `256x256.png` | 256×256 | BrowserWindow icon, standard displays |
| `128x128.png` | 128×128 | Medium resolution |
| `64x64.png` | 64×64 | Taskbar/dock |
| `48x48.png` | 48×48 | System tray icon |
| `32x32.png` | 32×32 | Small tray icon fallback |
| `16x16.png` | 16×16 | Tiny icon |
| `icon.png` | 256×256 | Legacy compatibility |
| `icon.svg` | Vector | Source SVG |

## Regenerating Icons

If you update the source icon, regenerate PNGs:

```bash
node scripts/generate-icons.js
```

## Usage

- **BrowserWindow (launcher/taskbar)**: Uses `256x256.png`
- **System Tray**: Uses `48x48.png` or `32x32.png`
- **electron-builder**: Uses this folder for Linux packaging

## Linux Icon Cache Refresh

If icons don't update after packaging, refresh the icon cache:

```bash
# Update icon cache
gtk-update-icon-cache -f -t ~/.local/share/icons/hicolor
sudo gtk-update-icon-cache -f -t /usr/share/icons/hicolor

# Update desktop database
update-desktop-database ~/.local/share/applications

# For AppImage, the icon is embedded - no cache needed
```
