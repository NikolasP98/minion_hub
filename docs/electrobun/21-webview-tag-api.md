# Electrobun Webview Tag API

> Source: https://blackboard.sh/electrobun/docs/apis/browser/electrobun-webview-tag/

## Introduction

Electrobun's custom webview tag implementation behaves similarly to an enhanced iframe, but with key differences in capabilities and isolation. It serves as a positional anchor within the DOM, communicating with a Zig backend to manage a distinct, isolated BrowserView.

## Basic Usage

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>webview tag test</title>
    <script src="views://webviewtag/index.js"></script>
  </head>
  <body>
    <electrobun-webview src="https://electrobun.dev"></electrobun-webview>
  </body>
</html>
```

## Compatibility

The Electrobun webview tag integrates seamlessly with any reactive JavaScript framework, such as React or SolidJS. The HTML element functions as a positional anchor that reports its position and relays events to Zig, which manages a completely separate BrowserView and overlays it at the same coordinates within the window.

## Differences from Electron's Webview Tag

Electron's webview tag relies on a Chrome feature designed for Chrome apps that has been deprecated since 2020. Electrobun provides its own independent implementation without relying on Chrome's now-deprecated webview tag, ensuring longevity and stability.

Because Electrobun uses a div anchor and positions a separate isolated BrowserView above the parent BrowserView, the framework offers special methods for handling edge cases where developers need to interact with the parent document or DOM.

## Properties and Attributes

### src
- **Type:** `string`
- **Description:** URL of the web page to load in the webview.

### html
- **Type:** `string`
- **Description:** HTML content to be directly loaded into the webview.

### preload
- **Type:** `string`
- **Description:** Path to a script that should be preloaded before any other scripts run in the webview.

### partition
- **Type:** `string`
- **Description:** Sets a partition to provide separate storage for different sessions.

### sandbox
- **Type:** `boolean`
- **Description:** When set to true, creates the webview in sandbox mode. Disables RPC communication and only allows event emission.

```html
<electrobun-webview
  src="https://untrusted-site.com"
  sandbox
></electrobun-webview>
```

### transparent
- **Type:** `boolean`
- **Description:** When set to true, makes the webview transparent.

### passthroughEnabled
- **Type:** `boolean`
- **Description:** Enables or disables mouse and touch events to pass through to underlying elements.

### hidden
- **Type:** `boolean`
- **Description:** Controls the visibility of the webview.

### webviewId
- **Type:** `number`
- **Description:** A unique identifier for the webview instance, automatically managed.

## Methods

### canGoBack()
- **Returns:** `Promise<boolean>`

### canGoForward()
- **Returns:** `Promise<boolean>`

### on(event, listener)
Attach event listeners for webview-specific events.

### off(event, listener)
Detach event listeners.

### syncDimensions(force?)
Synchronizes the dimensions and position of the webview with its anchor element.

### goBack()
Navigates the webview back to the previous page.

### goForward()
Navigates the webview forward to the next page.

### reload()
Reloads the current content.

### loadURL(url)
Loads a given URL into the webview.

### setNavigationRules(rules)
Set an allow/block list of URL patterns to control navigation.

**Rule Format:**
- Rules use glob-style wildcards where `*` matches any characters
- Prefix a rule with `^` to make it a block rule
- Rules are evaluated top-to-bottom, last matching rule wins
- If no rule matches, navigation is allowed by default

```javascript
document.querySelector('electrobun-webview').setNavigationRules([
  "^*",                           // Block everything by default
  "*://en.wikipedia.org/*",       // Allow Wikipedia
  "*://upload.wikimedia.org/*",   // Allow Wikipedia images
]);
```

### executeJavascript(js)
Execute arbitrary JavaScript in the webview. Fire-and-forget, does not return a result.

### toggleTransparent(value?)
Toggles the transparency state.

### togglePassthrough(value?)
Toggles click passthrough.

### toggleHidden(value?)
Toggles visibility.

## Events

### dom-ready
Fired when the DOM of the webview's content has finished loading.

### did-navigate
Fired when the webview navigates to a new URL.

### did-navigate-in-page
Fired for in-page navigations (e.g., hash changes).

### did-commit-navigation
Fired when the webview commits to navigating to a new URL.

### new-window-open
Fired when the webview attempts to open a new window.

### host-message
Fired when the webview's preload script sends a message to the host using `window.__electrobunSendToHost()`.

```javascript
document.querySelector('electrobun-webview').on('host-message', (event) => {
  console.log('Received message from webview:', event.detail);
});
```

## Preload Scripts

### window.__electrobunSendToHost(message)
Sends a message from the webview's preload script to the host BrowserWindow. Only available inside preload scripts running within an `electrobun-webview`.

```html
<electrobun-webview
  id="myWebview"
  src="https://example.com"
  preload="
    document.addEventListener('keydown', (e) => {
      window.__electrobunSendToHost({
        type: 'keydown',
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey
      });
    });
  "
></electrobun-webview>
```

## Security Considerations

### Sandbox Mode
Always use the `sandbox` attribute when loading untrusted content. This completely disables RPC communication.

### Navigation Rules
Combine sandbox mode with navigation rules to restrict where the webview can navigate.

### Process Isolation
Each `electrobun-webview` runs in a completely separate browser process providing memory isolation, crash isolation, and security boundaries.

### Best Practices
- Always sandbox untrusted content
- Use navigation rules to prevent redirects to malicious sites
- Use partitions to isolate session storage between webviews
- Validate host messages from preload scripts
- Prefer HTTPS -- block HTTP content with navigation rules
