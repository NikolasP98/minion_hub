# Context Menu API

> Source: https://blackboard.sh/electrobun/docs/apis/context-menu/

## Overview

The Context Menu API enables developers to display native context menus at the mouse cursor position, even outside the application window. These menus can use built-in roles or custom actions.

## Basic Usage

```javascript
import { ContextMenu } from "electrobun/bun";

setTimeout(() => {
  ContextMenu.showContextMenu([
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
  ]);
}, 5000);

Electrobun.events.on("context-menu-clicked", (e) => {
  console.log("context event", e.data.action);
});
```

## Menu Item Properties

### accelerator

The `accelerator` property sets a keyboard shortcut hint displayed next to menu items:

```javascript
ContextMenu.showContextMenu([
  {
    label: "Save",
    action: "save",
    accelerator: "s"  // Shows Cmd+S on macOS
  },
  {
    label: "New Tab",
    action: "new-tab",
    accelerator: "t"
  },
  { type: "separator" },
  { role: "copy" },
  { role: "paste" },
]);
```

**Platform Support:**
- **macOS:** Full support with Command modifier
- **Windows:** Simple single-character accelerators
- **Linux:** Not currently supported

### Other Properties

- **label:** Display text for the menu item
- **action:** String identifier emitted on click
- **role:** Built-in role (e.g., "copy", "paste", "cut")
- **enabled:** Disable item when false
- **checked:** Show checkbox when true
- **hidden:** Hide item when true
- **tooltip:** Hover tooltip text
- **data:** Arbitrary data passed with click event
- **submenu:** Nested menu items array
