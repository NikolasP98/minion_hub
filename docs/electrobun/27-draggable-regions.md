# Draggable Regions

> Source: https://blackboard.sh/electrobun/docs/apis/browser/draggable-regions/

## Overview

Configure HTML elements to function as draggable regions, enabling users to move native application windows by clicking and dragging. This feature is essential for frameless window designs where custom titlebars replace native window chrome.

## Implementation

### Step 1: Instantiate the Electroview Class

```typescript
// /src/mainview/index.ts
import { Electroview } from "electrobun/view";

const electrobun = new Electroview();
```

### Step 2: Add the Draggable Region CSS Class

Elements with the `electrobun-webkit-app-region-drag` class automatically become draggable areas:

```html
<div class="electrobun-webkit-app-region-drag">
  click here and drag to move this window
</div>
```

### Step 3: Exclude Interactive Elements with No-Drag

Interactive elements inside draggable regions must be excluded using the `electrobun-webkit-app-region-no-drag` class:

```html
<div class="titlebar electrobun-webkit-app-region-drag">
    <div class="window-controls electrobun-webkit-app-region-no-drag">
        <button class="close-btn" id="closeBtn"></button>
        <button class="minimize-btn" id="minimizeBtn"></button>
        <button class="maximize-btn" id="maximizeBtn"></button>
    </div>
    <span class="title">My App</span>
</div>
```

## Complete Custom Titlebar Example

### Bun Process (src/bun/index.ts)

```typescript
import { BrowserWindow, BrowserView } from "electrobun/bun";

const rpc = BrowserView.defineRPC({
  handlers: {
    requests: {},
    messages: {
      closeWindow: () => win.close(),
      minimizeWindow: () => win.minimize(),
      maximizeWindow: () => {
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      },
    },
  },
});

const win = new BrowserWindow({
  title: "Custom Titlebar",
  url: "views://mainview/index.html",
  frame: { width: 800, height: 600, x: 100, y: 100 },
  titleBarStyle: "hidden",
  rpc,
});
```

### Browser Process (src/mainview/index.ts)

```typescript
import { Electroview } from "electrobun/view";

const electrobun = new Electroview();

document.getElementById("closeBtn")?.addEventListener("click", () => {
  electrobun.rpc.send.closeWindow();
});

document.getElementById("minimizeBtn")?.addEventListener("click", () => {
  electrobun.rpc.send.minimizeWindow();
});

document.getElementById("maximizeBtn")?.addEventListener("click", () => {
  electrobun.rpc.send.maximizeWindow();
});
```

### CSS (src/mainview/index.css)

```css
.titlebar {
    height: 32px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    background: #2d2d2d;
    user-select: none;
}

.window-controls {
    display: flex;
    gap: 8px;
}

.window-controls button {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
}

.close-btn { background: #ff5f57; }
.minimize-btn { background: #febc2e; }
.maximize-btn { background: #28c840; }

.title {
    flex: 1;
    text-align: center;
    font-size: 13px;
    color: #ccc;
}
```

## Related Documentation

See the [BrowserWindow API](./11-browser-window-api.md) for `titleBarStyle` and `transparent` window options.
