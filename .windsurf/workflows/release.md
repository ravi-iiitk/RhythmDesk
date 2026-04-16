---
description: How to create a new release
---

# Release Process

## 1. Decide Version Number

Follow Semantic Versioning:
- **Patch** (0.1.0 → 0.1.1): Bug fixes only
- **Minor** (0.1.0 → 0.2.0): New features, backward-compatible
- **Major** (0.1.0 → 1.0.0): Breaking changes or first stable release

## 2. Update Version

```bash
# Option A: Use npm (recommended)
npm version patch   # or minor, or major
npm version minor -m "chore: release v%s"

# Option B: Manual
# Edit package.json, change "version": "0.2.0"
git add package.json
git commit -m "chore: bump version to 0.2.0"
git tag -a v0.2.0 -m "Release v0.2.0"
```

## 3. Build Production Packages

```bash
npm run dist:linux
```

This creates:
- `release/RhythmDesk-{VERSION}-amd64.deb`
- `release/RhythmDesk-{VERSION}-x86_64.AppImage`

## 4. Push to GitHub

```bash
git push origin main --tags
```

## 5. Create GitHub Release

1. Go to: https://github.com/YOUR_USERNAME/rhythmdesk/releases/new
2. Select the tag (e.g., `v0.2.0`)
3. Release title: `RhythmDesk v0.2.0`
4. Write release notes:
   - What's new
   - Bug fixes
   - Breaking changes (if any)
5. Upload files from `release/`:
   - `RhythmDesk-0.2.0-amd64.deb`
   - `RhythmDesk-0.2.0-x86_64.AppImage`
6. Click "Publish release"

## 6. Test the Release

Download and install from GitHub Releases page to verify.

## Example Release Notes Template

```markdown
## What's New
- Added feature X
- Improved Y performance

## Bug Fixes
- Fixed crash when Z
- Fixed schedule not activating issue

## Installation

**Debian/Ubuntu:**
```bash
sudo dpkg -i RhythmDesk-0.2.0-amd64.deb
```

**Other Linux (AppImage):**
```bash
chmod +x RhythmDesk-0.2.0-x86_64.AppImage
./RhythmDesk-0.2.0-x86_64.AppImage
```
```

## Version History

- **v0.1.0** - Initial release
- **v0.2.0** - Bug fixes and improvements
- **v1.0.0** - First stable release
