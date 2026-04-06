# Bundling CEF (Chromium Embedded Framework)

> Source: https://blackboard.sh/electrobun/docs/apis/bundling-cef/

## Overview

Electrobun supports bundling CEF (Chromium Embedded Framework) with your application for cross-platform consistency and advanced features. While the default system webview provides smaller bundle sizes, CEF ensures near-identical rendering and behavior across all platforms.

## Configuration

```typescript
import { type ElectrobunConfig } from "electrobun";

export const config: ElectrobunConfig = {
  build: {
    macos: { bundleCEF: true },
    win: { bundleCEF: true },
    linux: { bundleCEF: true },
  },
};
```

## Platform Considerations

### Windows
On Windows the system renderer is Webview2 (essentially Edge/Chromium). Bundling CEF may still be beneficial to pin the version of Chromium you distribute.

### Linux
**Bundling CEF is strongly recommended on Linux** as the default GTKWebKit renderer doesn't support Electrobun's advanced layer compositing features.

### Bundle Size Impact
CEF adds approximately **100MB** to initial bundle (vs ~14MB with system webviews). Incremental updates remain small (as little as 14KB).

## Using CEF Renderer

### BrowserWindow API

```typescript
import { BrowserWindow } from "electrobun/bun";

const cefWindow = new BrowserWindow({
  width: 1200,
  height: 800,
  renderer: "cef",
  url: "views://main/index.html"
});

const systemWindow = new BrowserWindow({
  width: 800,
  height: 600,
  renderer: "system",
  url: "views://secondary/index.html"
});
```

### Electrobun Webview Tag

```html
<electrobun-webview
  src="https://example.com"
  renderer="cef"
  style="width: 100%; height: 500px;">
</electrobun-webview>
```

## Mixed Renderer Support

### macOS and Windows
You can mix and match renderers within the same application.

### Linux Limitation
Renderer mixing is not supported on Linux. The build creates two separate binaries (GTKWebKit vs CEF).

## When to Bundle CEF

**Bundle CEF when you need:**
- Consistent rendering across all platforms
- Advanced compositing features (especially on Linux)
- Latest Chromium features
- Predictable behavior for complex web applications

**Use system webviews when you want:**
- Smallest possible bundle size (~14MB vs ~100MB)
- Native platform integration and appearance
- Lower memory usage
- Faster initial download

## Custom CEF Versions

Override the default CEF version:

```typescript
export default {
  build: {
    cefVersion: "144.0.11+ge135be2+chromium-144.0.7559.97",
    mac: { bundleCEF: true },
    linux: { bundleCEF: true },
    win: { bundleCEF: true },
  },
} satisfies ElectrobunConfig;
```

The format is `CEF_VERSION+chromium-CHROMIUM_VERSION` from [Spotify CEF builds](https://cef-builds.spotifycdn.com/).

### Compatibility Notes
- **Same major version** (e.g., 144.x to 144.y): Safe
- **Adjacent major versions** (e.g., 144.x to 145.x): Usually works, test thoroughly
- **Distant major versions** (e.g., 130.x to 145.x): Higher risk of incompatibility
