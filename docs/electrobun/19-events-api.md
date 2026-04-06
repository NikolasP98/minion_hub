# Events API

> Source: https://blackboard.sh/electrobun/docs/apis/events/

## Event System in the Main Bun Process

### Event Propagation

#### Global Events

Most events can be monitored either directly on the object generating them or globally. Global event handlers fire first. Then handlers are fired in the sequence that they were registered in. One exception exists: window `close` events process per-window handlers before global handlers to ensure window close handlers execute before the `exitOnLastWindowClosed` logic.

```javascript
// listen to global event
Electrobun.events.on("will-navigate", (e) => {
    // handle
});

// listen to event on object
win.webview.on('will-navigate', (e) => {
    // handle
});
```

#### Event.response

Certain events allow you to set a response. These are typically events initiated from zig that pause the zig process while awaiting a bun reply. By freezing the zig process and waiting for bun we allow bun to remain async while the events propagate.

```javascript
Electrobun.events.on("will-navigate", (e) => {
  console.log(
    "example global will-navigate handler",
    e.data.url,
    e.data.webviewId
  );
  e.response = { allow: true };
});
```

#### Event.responseWasSet

This property indicates whether the response has been set, which can be useful when an event passes through multiple handlers rather than inferring from the response value itself.

#### Event.clearResponse

Allows you to clear the response set by a previous handler by calling `e.clearResponse()`.

#### Event.data

Each event populates different event data depending on its type.

---

## Application Events

### open-url

Triggered when the application opens via a custom URL scheme (deep linking). This event is macOS-only.

**Event data:**
- `url` - The complete URL used to open the app (e.g., `myapp://some/path?query=value`)

```javascript
Electrobun.events.on("open-url", (e) => {
  console.log("App opened with URL:", e.data.url);

  const url = new URL(e.data.url);
  console.log("Protocol:", url.protocol); // "myapp:"
  console.log("Pathname:", url.pathname); // "/some/path"
});
```

**Platform support:**
- macOS: Fully supported. App must be in `/Applications` folder for URL scheme registration to work reliably.
- Windows: Not yet supported
- Linux: Not yet supported

**Setup:** Register URL schemes in your `electrobun.config.ts`. See the [Build Configuration](./22-build-configuration.md) documentation for details.

### before-quit

Triggered before the application quits, regardless of the quit trigger -- `Utils.quit()`, `process.exit()`, `exitOnLastWindowClosed`, or the updater. You can prevent the quit by setting `event.response = { allow: false }`.

```javascript
// Listen for quit and do cleanup
Electrobun.events.on("before-quit", (e) => {
  console.log("App is about to quit, saving state...");
  saveAppState();
});

// Prevent quit (e.g. unsaved changes)
Electrobun.events.on("before-quit", (e) => {
  if (hasUnsavedChanges()) {
    e.response = { allow: false };
  }
});
```

---

## Shutdown Lifecycle

Electrobun provides a unified shutdown flow ensuring the `before-quit` handler fires regardless of how the quit was triggered.

### Quit Triggers

All these quit paths follow the same lifecycle:
- **Programmatic:** Calling `Utils.quit()` from app code
- **process.exit():** Electrobun intercepts and routes through the quit lifecycle
- **exitOnLastWindowClosed:** When the last window closes and this option is enabled
- **System-initiated:** macOS dock icon Quit, Cmd+Q, Windows taskbar close, etc.
- **Signals:** Ctrl+C (SIGINT) and SIGTERM from terminal or process managers
- **Updater:** When the updater needs to restart the app

### Shutdown Sequence

When any quit trigger fires:
1. The `before-quit` event fires on the bun worker thread
2. Your handlers run -- you can perform cleanup (save state, close connections, flush logs) or cancel the quit by setting `event.response = { allow: false }`
3. If the quit is not cancelled, the native event loop stops (CEF shuts down, windows close)
4. The process exits cleanly

**Linux note:** On Linux, system-initiated quit paths (Ctrl+C, window manager close, taskbar quit) do not currently fire `before-quit`. Programmatic quit via `Utils.quit()` and `process.exit()` works correctly on all platforms.

### Ctrl+C Behavior (Dev Mode)

In dev mode (`bun dev`), Ctrl+C triggers a graceful shutdown:
- **First Ctrl+C:** Fires `before-quit`, gives your app time to clean up. The terminal stays busy until shutdown completes.
- **Second Ctrl+C:** Force-kills the entire process tree immediately, including CEF helper processes.
- **Safety timeout:** If the app hangs during shutdown for more than 10 seconds, it is automatically force-killed.

### Comparison with Node.js / Bun Exit Events

| Event | Async | Can Cancel | Fires on quit | Notes |
|-------|-------|-----------|---------------|-------|
| `Electrobun.events.on("before-quit")` | Yes | Yes | Yes | Recommended for app cleanup |
| `process.on("exit")` | No (sync only) | No | Yes | Runs after before-quit. No async work. |
| `process.on("beforeExit")` | Yes | No | No | Does not fire when `process.exit()` is called. |

**Recommendation:** Use Electrobun's `before-quit` event for all shutdown cleanup.

### Example: Complete Shutdown Handling

```javascript
import Electrobun from "electrobun/bun";

// Main cleanup handler -- fires for all quit triggers
Electrobun.events.on("before-quit", async (e) => {
  console.log("Saving application state...");
  await saveAppState();
  await closeDatabase();
  console.log("Cleanup complete, quitting.");
});

// Optional: sync-only last-resort hook (no async, no I/O)
process.on("exit", (code) => {
  console.log("Process exiting with code:", code);
});
```
