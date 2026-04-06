# What is Electrobun?

> Source: https://blackboard.sh/electrobun/docs/guides/what-is-electrobun/

Electrobun is a desktop application framework that lets you build ultra fast, tiny, and cross-platform applications using TypeScript.

## The Problem

Traditional frameworks present trade-offs:

- **Electron:** Strong developer experience but bundles exceeding 150MB, startup delays of 2-5 seconds, substantial update downloads
- **Native development:** Solid performance with steep complexity, platform-dependent code, limited web tech integration
- **Tauri:** Performance improvements over Electron yet large updates and mandatory Rust knowledge

## The Solution

Electrobun provides a third option that doesn't compromise:

- Ultra-small bundles: ~14MB compressed (90%+ smaller than Electron)
- Lightning-fast startup: <50ms cold start
- Tiny updates: 14KB patches using custom binary diff
- Pure TypeScript: Both main process and UI
- Web technologies: HTML, CSS, JavaScript with any frontend framework
- Native performance: Zig bindings with Bun runtime
- Optional CEF: bundle Chromium for cross-platform consistency

## Performance Comparison

| Metric | Electron | Tauri | Electrobun |
|--------|----------|-------|-----------|
| Bundle Size | 150MB+ | 25MB | 14MB |
| Update Size | 100MB+ | 10MB | 14KB |
| Startup Time | 2-5s | 500ms | <50ms |
| Memory Usage | 100-200MB | 30-50MB | 15-30MB |

## Technical Architecture

### Zig and Native Bindings
Native functionality like window management, system trays, and app menus written in C++ and Objc.

### Bun Runtime
The main process runs on Bun, providing lightning-fast Typescript execution and built-in bundling without the overhead of Node.js and V8.

### System WebView
Instead of distributing Chromium, by default Electrobun uses your system's native WebView (WebKit on macOS, Edge WebView2 on Windows, WebKitGTK on Linux).

### Custom Update System
Binary diff updates using a SIMD optimized BSDIFF implementation written in zig to allow for incredibly small update patches - often just kilobytes instead of megabytes.

### ZSTD Self-extracting Distributables
The Electrobun cli bundles your app, then compresses it with state of the art compression making initial downloads as small as possible.

### Custom OOPIF Implementation
Use OOPIFs (super iframes) in your html for secure, isolated, webviews across browser engines and platforms.

## Key Benefits

### Faster Development
- Fast build times using pre-built binaries
- Support for any web framework (React, SolidJS, Vue, Svelte, etc.)
- TypeScript throughout
- Built-in bundling and optimization

### Better Distribution
- 14MB bundles vs 150MB+ with Electron
- Kilobyte updates instead of megabyte downloads
- Built-in code signing and notarization
- Cross-platform builds from any OS
- Built-in ZSTD self-extractor

### Superior Performance
- Sub-50ms startup times
- Minimal memory footprint
- Native-feeling UI responsiveness
- Battery-efficient operation

### Security First
- Process isolation by default
- Secure, encrypted, and typed RPC between processes
- Custom `views://` schema for loading bundled assets
- Minimal attack surface

## When to Use Electrobun

- **Startup MVPs:** Ship fast with small updates
- **Developer tools:** IDEs, terminals, productivity applications requiring native performance
- **Cross-platform apps:** Single codebase with native feel everywhere
- **High-performance apps:** When Electron underperforms but native development seems excessive
- **Bandwidth-conscious apps:** Frequent updates without user friction
- **Multi-tab web browsers:** Mix CEF and Webkit webviews

## Getting Started

Ready to build your first Electrobun app? Follow the [Hello World guide](./03-hello-world.md) to create a new project in minutes.
