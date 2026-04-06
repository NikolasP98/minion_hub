# Webview Tag Architecture (OOPIF)

> Source: https://blackboard.sh/electrobun/docs/guides/architecture/webview-tag/

## Overview

The `<electrobun-webview>` tag implements an Out-Of-Process IFrame (OOPIF), delivering a secure, isolated, and performant way to embed web content within your application. Unlike traditional iframes or Electron's deprecated webview, this approach provides process isolation with DOM integration.

## Why Not Regular IFrames?

Standard iframes present challenges for desktop applications:

- **Security restrictions**: Browsers prevent cross-domain iframe loading
- **Limited control**: Cannot customize behavior or bypass same-origin policies
- **Performance constraints**: Share the parent page's process
- **Feature limitations**: Restricted access to native APIs and advanced features

## The OOPIF Advantage

Out-Of-Process IFrames resolve these limitations through:

- **Process isolation**: Each webview runs in its own isolated process
- **Security boundary**: Complete separation between host and embedded content
- **Performance**: Independent resource allocation and crash protection
- **Flexibility**: Full control over content loading and permissions

## How It Works

The tag functions as a layer positioned above the main window, synchronized with the DOM element's position and size. This provides:

1. **DOM Integration**: Style, animate, and position like any DOM element
2. **Process Separation**: Content runs in an isolated process
3. **Transparent Layering**: Support for transparency without breaking host design
4. **Native Performance**: Direct rendering without iframe restrictions

## Key Features

### Full Isolation

Each webview runs independently, ensuring:

- Crash protection (isolated failures)
- Memory isolation
- Security boundaries between content sources

### Seamless Communication

Fast inter-process communication (IPC) between:

- The Bun main process
- The host webview
- Individual OOPIF webviews

### Not Deprecated

Unlike Electron's webview (deprecated, removal scheduled January 2025), Electrobun's implementation is built from the ground up and will continue to be supported and improved.

## Usage Example

```html
<electrobun-webview
  src="https://electrobun.dev"
  style="width: 100%; height: 500px;">
</electrobun-webview>
```

## Architecture Benefits

- **Security**: Process isolation prevents cross-site scripting attacks
- **Reliability**: Crash isolation protects your application
- **Performance**: Independent resource allocation and rendering
- **Flexibility**: Full content control without iframe limitations
- **Future-proof**: Independent of deprecated Chromium features
