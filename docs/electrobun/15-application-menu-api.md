# Application Menu API

> Source: https://blackboard.sh/electrobun/docs/apis/application-menu/

## Overview

The Application Menu API enables developers to create and control application menus. On macOS, this appears as the menu bar in the top-left (File, Edit, etc.).

## Basic Usage

```javascript
import { ApplicationMenu } from "electrobun/bun";

ApplicationMenu.setApplicationMenu([
  {
    submenu: [{ label: "Quit", role: "quit" }],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      {
        label: "Custom Menu Item",
        action: "custom-action-1",
        tooltip: "I'm a tooltip",
      },
      {
        label: "Custom menu disabled",
        enabled: false,
        action: "custom-action-2",
      },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
    ],
  },
]);

Electrobun.events.on("application-menu-clicked", (e) => {
  console.log("application menu clicked", e.data.action);
});
```

## setApplicationMenu

This function accepts an array of menu items as its parameter.

### Menu Dividers

```javascript
{ type: "divider" }
// or
{ type: "separator" }
```

## Default Roles

Menu items can specify a role to access built-in OS functionality with corresponding keyboard shortcuts. Using roles like "copy" or "paste" automatically binds standard keyboard shortcuts (cmd+c, cmd+v on macOS; Ctrl+C, Ctrl+V on Windows).

### Supported Roles

- `quit`, `hide`, `hideOthers`, `showAll`
- `undo`, `redo`
- `cut`, `copy`, `paste`, `pasteAndMatchStyle`, `delete`, `selectAll`
- `startSpeaking`, `stopSpeaking`
- `enterFullScreen`, `exitFullScreen`, `toggleFullScreen`
- `minimize`, `zoom`, `bringAllToFront`
- `close`, `cycleThroughWindows`, `showHelp`

## Custom Menu Items

Custom actions can be specified instead of roles. Listen for these actions via the `application-menu-clicked` event.

```javascript
{ label: "I am a menu item", action: 'some-action' }
```

## Optional Properties

### enabled
Disable menu items by setting to `false`.

### checked
Display a checkbox next to the menu item when set to `true`.

### hidden
Hide menu items by setting to `true`.

### tooltip
Display a tooltip on hover.

### submenu
Add nested submenus to menu items.

### accelerator

Set custom keyboard shortcuts for menu items:

```javascript
{
  label: "Save Project",
  action: "save-project",
  accelerator: "s"  // Cmd+S on macOS, Ctrl+S on Windows
}
```

The accelerator string specifies the key. Default modifiers: Command (macOS), Ctrl (Windows).

#### Platform Support

- **macOS:** Full custom accelerator support; default modifier is Command
- **Windows:** Supports simple single-character accelerators (e.g., "s", "n", "o")
- **Linux:** Application menus not currently supported

> **Note:** Use `accelerator` only for custom actions; roles automatically assign standard shortcuts.
