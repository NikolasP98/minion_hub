# Electrobun Documentation Index

> Local mirror of the [Electrobun documentation](https://blackboard.sh/electrobun/docs/).
> Electrobun is a framework for building ultra fast, tiny, and cross-platform desktop apps with TypeScript.
> GitHub: https://github.com/blackboardsh/electrobun

## Getting Started

| # | Document | Description |
|---|----------|-------------|
| 01 | [What is Electrobun?](./01-what-is-electrobun.md) | Overview, motivation, performance comparison vs Electron/Tauri |
| 02 | [Quick Start](./02-quick-start.md) | Create your first app with `bunx electrobun init` |
| 03 | [Hello World](./03-hello-world.md) | Step-by-step guide building from scratch |
| 04 | [Creating UI](./04-creating-ui.md) | Building UIs with webviews, HTML, and the Electroview class |
| 05 | [Bundling & Distribution](./05-bundling-and-distribution.md) | Packaging, artifacts, and release hosting |

## Architecture & Guides

| # | Document | Description |
|---|----------|-------------|
| 06 | [Architecture Overview](./06-architecture-overview.md) | App structure, bundles, IPC, self-extracting bundles, updating |
| 07 | [Webview Tag Architecture](./07-webview-tag-architecture.md) | OOPIF implementation, process isolation, vs iframes |
| 08 | [Cross-Platform Development](./08-cross-platform-development.md) | Platform differences, CEF on Linux, CI builds |
| 09 | [Updates Guide](./09-updates-guide.md) | GitHub Releases hosting, GitHub Actions CI, limitations |
| 24 | [Compatibility](./24-compatibility.md) | Platform support matrix, dependency versions, webview engines |
| 25 | [Code Signing](./25-code-signing.md) | macOS certificates, notarization, environment variables |

## Bun APIs (Main Process)

| # | Document | Description |
|---|----------|-------------|
| 10 | [Bun API](./10-bun-api.md) | Main process API overview, import methods |
| 11 | [BrowserWindow API](./11-browser-window-api.md) | Window creation, title bar styles, transparency, RPC, events |
| 12 | [BrowserView API](./12-browser-view-api.md) | Webview control, navigation rules, downloads |
| 14 | [Context Menu API](./14-context-menu-api.md) | Native context menus with roles and custom actions |
| 15 | [Application Menu API](./15-application-menu-api.md) | Menu bar with roles, accelerators, custom items |
| 16 | [Tray API](./16-tray-api.md) | System tray icons and menus |
| 17 | [Updater API](./17-updater-api.md) | Check, download, and apply updates (14KB patches) |
| 18 | [Paths API](./18-paths-api.md) | RESOURCES_FOLDER, VIEWS_FOLDER |
| 19 | [Events API](./19-events-api.md) | Event system, propagation, shutdown lifecycle, before-quit |
| 20 | [Utils API](./20-utils-api.md) | File ops, dialogs, clipboard, notifications, GlobalShortcut, Screen, Session |
| 26 | [WebGPU API](./26-webgpu-api.md) | Dawn integration, GPU windows, Three.js/Babylon.js |
| 32 | [BuildConfig API](./32-build-config-api.md) | Runtime access to build configuration |

## Browser APIs (Webview-side)

| # | Document | Description |
|---|----------|-------------|
| 13 | [Electroview Class](./13-electroview-class.md) | Browser-side API, RPC from webview to Bun |
| 21 | [Webview Tag API](./21-webview-tag-api.md) | `<electrobun-webview>` attributes, methods, events, security |
| 27 | [Draggable Regions](./27-draggable-regions.md) | Custom titlebar drag zones with CSS classes |
| 28 | [Global Properties](./28-global-properties.md) | `__electrobunWebviewId`, `__electrobunWindowId` |

## CLI & Configuration

| # | Document | Description |
|---|----------|-------------|
| 22 | [Build Configuration](./22-build-configuration.md) | electrobun.config.ts -- bundler options, ASAR, CEF, hooks, runtime |
| 23 | [CLI Arguments](./23-cli-args.md) | init, build, run, dev commands and environments |
| 29 | [Bundled Assets](./29-bundled-assets.md) | views:// schema for static assets |
| 30 | [Bundling CEF](./30-bundling-cef.md) | Chromium embedding, mixed renderers, custom versions |
| 31 | [Application Icons](./31-application-icons.md) | macOS iconset, Windows .ico, Linux .png |

## Reference

| # | Document | Description |
|---|----------|-------------|
| 33 | [GitHub README](./33-github-readme.md) | Project overview, build commands, platform support |

---

*Fetched from https://blackboard.sh/electrobun/docs/ on 2026-03-30*
