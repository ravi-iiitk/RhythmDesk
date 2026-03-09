# Contributing to RhythmDesk

Thank you for your interest in contributing to RhythmDesk! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Running the App](#running-the-app)
- [Building the App](#building-the-app)
- [Coding Style](#coding-style)
- [Commit Messages](#commit-messages)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

## Development Setup

### Prerequisites

- **Node.js**: Version 18 or higher
- **npm**: Version 9 or higher
- **Linux**: Ubuntu 20.04+ or equivalent (for development and testing)

### Installing Dependencies

```bash
git clone https://github.com/yourusername/postureguard.git
cd postureguard
npm install
```

## Project Structure

```
postureguard/
├── src/
│   ├── core/           # Business logic (timer engine, services)
│   ├── main/           # Electron main process
│   ├── renderer/       # React UI components
│   └── shared/         # Shared types and utilities
├── assets/
│   └── icons/          # Application icons
├── docs/               # Documentation
├── scripts/            # Build and release scripts
├── .github/            # GitHub workflows and templates
└── package.json
```

## Running the App

### Development Mode

```bash
npm run dev
```

This starts:
- TypeScript compiler in watch mode for main process
- Vite dev server for renderer process
- Electron app connected to both

### Production Build

```bash
npm run build
```

## Building the App

### Build Linux Installers

```bash
# Build all Linux targets (AppImage + deb)
npm run dist:linux

# Build AppImage only
npm run dist:appimage

# Build deb only
npm run dist:deb
```

Output files are placed in the `release/` directory.

## Coding Style

### TypeScript

- Use TypeScript for all new code
- Enable strict mode
- Use explicit types for function parameters and return values
- Prefer `interface` over `type` for object shapes

### React

- Use functional components with hooks
- Keep components small and focused
- Use the existing component patterns in the codebase

### Formatting

- Use 2 spaces for indentation
- Use single quotes for strings
- Add trailing commas in multi-line arrays/objects
- Run `npm run lint` before committing

### File Naming

- Use `camelCase` for files: `timerEngine.ts`
- Use `PascalCase` for React components: `DashboardPage.tsx`
- Use `kebab-case` for CSS files: `dashboard-page.css`

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Build process or auxiliary tool changes

### Examples

```
feat(timer): add sleep/wake recovery

fix(overlay): prevent overlay from being accidentally closed

docs(readme): add installation instructions

chore(deps): update electron to v28
```

## Pull Request Guidelines

### Before Submitting

1. **Fork the repository** and create your branch from `main`
2. **Run the app** to verify your changes work
3. **Run linting**: `npm run lint`
4. **Run type checking**: `npm run typecheck`
5. **Test on Linux** if possible

### PR Requirements

- Clear description of changes
- Reference any related issues
- Screenshots for UI changes
- Testing steps

### PR Title Format

Use the same format as commit messages:

```
feat(timer): add pause for duration feature
```

## Reporting Bugs

Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md) and include:

- Your Linux distribution and version
- Steps to reproduce the bug
- Expected vs actual behavior
- Log files from `~/.config/rhythmdesk/logs/`
- Screenshots if applicable

## Suggesting Features

Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md) and include:

- Clear description of the feature
- Use case / problem it solves
- Proposed implementation (optional)

## Questions?

Feel free to open an issue for any questions about contributing.

Thank you for helping make RhythmDesk better! 🎯
