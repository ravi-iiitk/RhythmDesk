# RhythmDesk Release Checklist

## Pre-Release Verification

### Build Verification

- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] No critical lint warnings (`npm run lint`)
- [ ] electron-builder packaging works
- [ ] AppImage builds correctly (`npm run dist:appimage`)
- [ ] deb package builds correctly (`npm run dist:deb`)

### Asset Verification

- [ ] Icon paths resolve correctly
- [ ] All icon sizes present (16x16 to 512x512)
- [ ] Tray icon loads on all platforms

### First-Launch Verification

- [ ] Config directory created (`~/.config/rhythmdesk/`)
- [ ] Logs directory created (`~/.config/rhythmdesk/logs/`)
- [ ] Default config generated correctly
- [ ] No errors on fresh install

---

## Stability Verification

### Timer Engine

- [ ] Timer engine stable during long sessions (>4 hours)
- [ ] No memory leaks during extended use
- [ ] Phase transitions work correctly
- [ ] Timer watchdog detects and recovers from stalls

### Overlay

- [ ] Overlay never freezes indefinitely
- [ ] Overlay heartbeat working
- [ ] Overlay watchdog reloads unresponsive overlays
- [ ] Strict mode works correctly
- [ ] Non-strict mode dismissible

### Tray

- [ ] Tray updates correctly without flicker
- [ ] Tray menu items functional
- [ ] Tray tooltip shows current phase
- [ ] Tray icon changes with phase

---

## Feature Verification

### Schedules

- [ ] Rule-based schedules work
- [ ] Flow-based schedules work
- [ ] Schedule editing works
- [ ] Schedule deletion works
- [ ] Flow edits require reset (isolation working)

### Breaks

- [ ] Short breaks trigger correctly
- [ ] Long breaks trigger correctly
- [ ] Postponed breaks behave correctly
- [ ] Break counts track correctly

### Recovery

- [ ] Restart recovery works during work phase
- [ ] Restart recovery works during break phase
- [ ] Restart recovery works during postponed break
- [ ] Config migration works for older versions

---

## Production Hardening Verification

### Error Handling

- [ ] Uncaught exceptions don't crash app
- [ ] Unhandled rejections logged
- [ ] React error boundary catches UI errors
- [ ] Failsafe triggers on repeated failures

### Logging

- [ ] Logs written to correct location
- [ ] Log rotation working
- [ ] Log categories correct
- [ ] Debug mode toggle working

### Health Monitoring

- [ ] Health monitor running
- [ ] Timer watchdog detecting stalls
- [ ] Overlay watchdog detecting hangs
- [ ] Long session guard working

### Shutdown

- [ ] Clean shutdown on SIGINT
- [ ] Clean shutdown on SIGTERM
- [ ] Session snapshot flushed on exit
- [ ] No data loss on shutdown

---

## Performance Verification

- [ ] CPU usage minimal during idle
- [ ] CPU usage acceptable during ticks (<5%)
- [ ] Memory usage stable over time
- [ ] No UI lag during operation
- [ ] Tray updates debounced

---

## Documentation Verification

- [ ] README.md up to date
- [ ] ARCHITECTURE.md up to date
- [ ] CONTRIBUTING.md accurate
- [ ] LINUX_CAVEATS.md complete

---

## Release Process

1. **Version Bump**
   - Update `package.json` version
   - Update changelog

2. **Build**
   ```bash
   npm run build
   npm run dist:linux
   ```

3. **Test Install**
   - Install AppImage on fresh system
   - Install deb package on fresh system
   - Verify first-launch experience

4. **Create Release**
   - Tag release in git
   - Upload artifacts
   - Write release notes

---

## Post-Release

- [ ] Monitor for crash reports
- [ ] Check log files from users
- [ ] Address critical issues promptly
- [ ] Plan fixes for next release
