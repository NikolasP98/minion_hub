# Bun API

> Source: https://blackboard.sh/electrobun/docs/apis/bun/

## Overview

The Bun API serves as the main process API, managing application lifecycle, window creation, system events, and providing the bridge between UI and operating system.

## Getting Started

Electrobun functions as an npm dependency within bun projects. Review the [Quick Start](./02-quick-start.md) guide before beginning.

## Implementation Details

Electrobun allows developers to write TypeScript for the main process. When bundled, the application ships with a bun runtime version that executes the main process, supporting any bun-compatible TypeScript.

## Import Methods

For main process development, explicitly import from the `electrobun/bun` module:

### Option 1 - Default Import

```typescript
import Electrobun from "electrobun/bun";

const win = new Electrobun.BrowserWindow(/*...*/);
```

### Option 2 - Named Imports

```typescript
import {
  BrowserWindow,
  ApplicationMenu,
  // other specified imports
} from "electrobun/bun";

const win = new BrowserWindow(/*...*/);
```

## Available APIs

The following APIs are available from `electrobun/bun`:

- **BrowserWindow** - Create and manage application windows
- **BrowserView** - Create and control webviews
- **ApplicationMenu** - Application menu bar
- **ContextMenu** - Native context menus
- **Tray** - System tray icons and menus
- **Updater** - Built-in update mechanism
- **Utils** - File operations, dialogs, clipboard, notifications, etc.
- **Paths** - Access to bundled resources paths
- **Events** - Global event system
- **BuildConfig** - Runtime access to build configuration
- **WebGPU** - GPU-accelerated rendering
- **GlobalShortcut** - Global keyboard shortcuts
- **Screen** - Display and cursor information
- **Session** - Cookie and storage management
