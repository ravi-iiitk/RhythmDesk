# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x     | ✅ Active  |
| 1.x     | ❌ EOL     |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

To report a vulnerability, open a [GitHub Security Advisory](https://github.com/ravi-iiitk/RhythmDesk/security/advisories/new) (preferred), or contact the maintainer directly via GitHub.

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You will receive a response within 7 days. If the issue is confirmed, a patch will be released as soon as possible.

## Security Notes

RhythmDesk is a local desktop application:
- **No network connections** are made by the app
- **No telemetry or tracking** of any kind
- All data is stored locally in `~/.config/rhythmdesk/`
- The app does not request elevated privileges
