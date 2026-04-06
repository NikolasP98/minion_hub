# BrowserWindow API

> Source: https://blackboard.sh/electrobun/docs/apis/browser-window/

## Overview

The BrowserWindow API enables creation and control of browser windows in Electrobun applications.

```typescript
import { BrowserWindow } from "electrobun/bun";

const win = new BrowserWindow({
  title: "my url window",
  frame: {
    width: 1800,
    height: 600,
    x: 2000,
    y: 2000,
  },
  url: "views://mainview/index.html",
});
```

## Constructor Options

### title

Sets the window title.

### frame

Configures window dimensions and position with `width`, `height`, `x`, `y` properties.

### styleMask

Controls macOS window appearance and functionality. Properties include: `Borderless`, `Titled`, `Closable`, `Miniaturizable`, `Resizable`, `UnifiedTitleAndToolbar`, `FullScreen`, `FullSizeContentView`, `UtilityWindow`, `DocModalWindow`, `NonactivatingPanel`, `HUDWindow`.

### titleBarStyle

Manages title bar appearance across platforms (macOS, Windows, Linux).

**Available values:**
- `"default"` - Standard title bar with native window controls
- `"hidden"` - No title bar; implement custom window chrome in HTML/CSS
- `"hiddenInset"` - Transparent title bar with inset native controls

When using hidden title bar styles, implement custom window controls via `close()`, `minimize()`, and `maximize()` methods.

### transparent

Enables window background transparency for non-rectangular windows, floating widgets, or windows with rounded corners.

```typescript
const floatingWidget = new BrowserWindow({
  title: "Floating Widget",
  url: "views://widget/index.html",
  frame: { width: 300, height: 200, x: 100, y: 100 },
  titleBarStyle: "hidden",
  transparent: true,
});
```

Works across all platforms with native WebKit and CEF renderers.

### sandbox

Enables sandbox mode, disabling RPC while allowing event emission. Use for untrusted content.

```typescript
const externalBrowser = new BrowserWindow({
  title: "External Browser",
  url: "https://example.com",
  sandbox: true,
});
```

**Security model:**
- Events continue to function (navigation, dom-ready)
- RPC disabled; function calls between browser and main process blocked
- No nested webview tags allowed
- Navigation controls operational

### url

Sets the initial URL for the window's default BrowserView. Supports `https://` and `views://` schemes.

### html

Sets an HTML string for the window's default BrowserView to load on opening.

### partition

Separates browser sessions, allowing independent cookies and login states.

```typescript
// Ephemeral partition
const win = new BrowserWindow({ partition: "partition1" });

// Persistent partition
const win = new BrowserWindow({ partition: "persist:partition1" });
```

### preload

Sets a preload script executed after HTML parsing but before page scripts. Accepts URLs, `views://` paths, or inline JavaScript strings.

### rpc

Establishes RPC between the bun process and window's default BrowserView, enabling asynchronous function calls in both directions.

**Type definition (src/shared/types.ts):**

```typescript
export type MyWebviewRPCType = {
  bun: RPCSchema<{
    requests: {
      someBunFunction: {
        params: { a: number; b: number };
        response: number;
      };
    };
    messages: {
      logToBun: { msg: string };
    };
  }>;
  webview: RPCSchema<{
    requests: {
      someWebviewFunction: {
        params: { a: number; b: number };
        response: number;
      };
    };
    messages: {
      logToWebview: { msg: string };
    };
  }>;
};
```

**Implementation (src/bun/index.ts):**

```typescript
import { BrowserWindow, BrowserView } from "electrobun/bun";
import { type MyWebviewRPCType } from "../shared/types";

const myWebviewRPC = BrowserView.defineRPC<MyWebviewRPCType>({
  maxRequestTime: 5000,
  handlers: {
    requests: {
      someBunFunction: ({ a, b }) => {
        console.log(`browser asked me to do math with: ${a} and ${b}`);
        return a + b;
      },
    },
    messages: {
      "*": (messageName, payload) => {
        console.log("global message handler", messageName, payload);
      },
      logToBun: ({ msg }) => {
        console.log("Log to bun: ", msg);
      },
    },
  },
});

const win = new BrowserWindow({
  title: "my window",
  url: "views://mainview/index.html",
  frame: { width: 1800, height: 600, x: 2000, y: 2000 },
  rpc: myWebviewRPC,
});

// Call a browser function from bun
const answer = await win.webview.rpc.request.someWebviewFunction({ a: 4, b: 6 });

// Send a message to the BrowserView from bun
win.webview.rpc.send.logToWebview({ msg: "my message" });
```

## Properties

### webview

Getter for the window's default BrowserView.

## Methods

### setTitle(title)
Changes the window title.

### close()
Closes a window.

### focus()
Brings a window to the front and focuses it.

### minimize() / unminimize() / isMinimized()
Controls and checks the minimized state.

### maximize() / unmaximize() / isMaximized()
Controls and checks the maximized state. On macOS, uses the "zoom" functionality.

### setFullScreen(enabled) / isFullScreen()
Controls and checks fullscreen state.

### setAlwaysOnTop(enabled) / isAlwaysOnTop()
Controls and checks whether a window stays above all others.

### setPosition(x, y)
Moves the window to a specific screen position.

### setSize(width, height)
Resizes the window while preserving top-left corner position.

### setFrame(x, y, width, height)
Sets position and size in a single call.

### getFrame()
Returns current position and size with `x`, `y`, `width`, and `height` properties.

### getPosition()
Returns current position with `x` and `y` properties.

### getSize()
Returns current size with `width` and `height` properties.

### setVisibleOnAllWorkspaces(enabled) / isVisibleOnAllWorkspaces()
Controls and checks visibility across virtual desktops/workspaces. Fully supported on macOS; no-ops on Windows and Linux.

### setPageZoom(level) / getPageZoom()
Controls and retrieves page zoom level (1.0 = 100%). Fully supported on macOS (WebKit). On Windows and Linux (CEF), no-ops.

### on(name, handler)
Subscribes to BrowserWindow events.

## Events

### close
Fires when a window closes. Per-window handlers execute before global close handlers.

```typescript
win.on('close', (event) => {
  const {id} = event.data;
  console.log('window closed');
});
```

### resize
Fires when window width or height changes. Event data includes `id`, `x`, `y`, `width`, `height`.

### move
Fires when window position changes. Event data includes `id`, `x`, `y`.

### focus
Fires when window becomes the key window and receives focus.

### blur
Fires when window loses focus.
