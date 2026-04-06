# BrowserView API

> Source: https://blackboard.sh/electrobun/docs/apis/browser-view/

## Overview

Create and control browser views (sometimes referred to as webviews). The recommended approach is accessing BrowserViews created by BrowserWindow or using Webview Tags within HTML, rather than creating them directly from the bun process.

## Basic Usage

```typescript
import { BrowserView } from "electrobun/bun";
const webview = BrowserView.getById(id);

// or access from BrowserWindow
const win = new BrowserWindow(/*....*/);
const webview = win.webview;

// Advanced: Create directly
const webview = new BrowserView({
  url: "views://mainview/index.html",
  frame: {
    width: 1800,
    height: 600,
    x: 2000,
    y: 2000,
  },
});
```

## Constructor Options

### frame
Define webview dimensions relative to the window using width, height, x, and y properties.

### url
Set the initial URL for navigation. Supports both internet URLs and bundled content via `views://` scheme.

### html
Load an HTML string directly instead of a URL.

```typescript
const htmlString = "<html><head></head><body><h1>hello world</h1></body></html>";
const webview = new BrowserView({ html: htmlString });
```

### partition
Separate browser sessions (cookies, storage, etc.). Prefix with `persist:` for persistence across restarts.

### preload
Execute scripts after HTML parsing but before page scripts run. Supports URLs or inline JavaScript.

### rpc
Enable Remote Procedure Calls between bun and browser processes for async function execution.

### sandbox
When `true`, runs in sandbox mode, disabling RPC while allowing events -- useful for untrusted content.

## Static Methods

### BrowserView.getAll()
Returns references to all BrowserViews including defaults, nested OOPIFs, and manually created instances.

### BrowserView.getById(id)
Retrieves a specific BrowserView by its identifier.

### BrowserView.defineRPC()
Creates typed RPC instances for communication between processes using schema definitions.

## Instance Methods

### executeJavascript(script)
Execute arbitrary JavaScript in the webview. Fire-and-forget execution without return values.

### setPageZoom(level) / getPageZoom()
Control zoom levels (1.0 = 100%). Fully supported on macOS; limited on Windows/Linux (CEF).

### loadURL(url)
Navigate to a specified URL, triggering navigation events.

### loadHTML(html)
Replace content with HTML string and trigger navigation events.

### setNavigationRules(rules)
Define glob-style allow/block patterns controlling navigation destinations. Block rules require `^` prefix.

```typescript
webview.setNavigationRules([
  "^*",                           // Block everything by default
  "*://en.wikipedia.org/*",       // Allow Wikipedia
  "*://upload.wikimedia.org/*",   // Allow images
]);
```

### findInPage(text, options?)
Search and highlight text with forward/backward direction and case-sensitivity options.

### stopFindInPage()
Clear search highlighting.

### openDevTools() / closeDevTools() / toggleDevTools()
Manage DevTools window visibility.

## Properties

### id
The webview's unique identifier.

### hostWebviewId
Parent BrowserView ID for nested OOPIFs created via WebviewTag.

### rpc
Access typed request and message methods for configured RPC communication.

### rpc.request.evaluateJavascriptWithResponse()
Built-in method executing arbitrary JavaScript and returning results.

```typescript
const title = await webview.rpc.request.evaluateJavascriptWithResponse({
  script: "document.title"
});
```

## Events

### will-navigate
Fires before navigation with `url` and `allowed` (based on navigation rules).

### did-navigate
Fires after navigation completes.

### did-navigate-in-page
Fires after in-page navigation.

### did-commit-navigation
Main frame begins receiving content.

### dom-ready
DOM is ready in browser context.

### new-window-open
Window/popup opening requested with URL and modifier information.

### download-started / download-progress / download-completed / download-failed
Download lifecycle events with filename, path, and progress/error details.
