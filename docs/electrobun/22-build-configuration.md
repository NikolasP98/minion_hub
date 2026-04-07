# Build Configuration (electrobun.config.ts)

> Source: https://blackboard.sh/electrobun/docs/apis/cli/build-configuration/

## Overview

Electrobun uses `electrobun.config.ts` in your project root to control how your application is built and packaged. The config file uses TypeScript with ESM syntax, providing type safety and modern JavaScript features.

## Basic Structure

```typescript
// electrobun.config.ts
import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "MyApp",
    identifier: "com.example.myapp",
    version: "1.0.0",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
  },
} satisfies ElectrobunConfig;
```

## Bun Bundler Options

Both `build.bun` and each entry in `build.views` accept all Bun.build() options as pass-through properties. The only required field is `entrypoint` -- everything else is optional.

### Available Options

| Option | Type | Description |
|--------|------|-------------|
| `plugins` | `BunPlugin[]` | Bundler plugins |
| `external` | `string[]` | Modules to exclude from bundling |
| `sourcemap` | `"none" \| "linked" \| "inline" \| "external"` | Source map generation |
| `minify` | `boolean \| { whitespace, identifiers, syntax }` | Minification options |
| `splitting` | `boolean` | Enable code splitting |
| `define` | `Record<string, string>` | Global identifier replacements at build time |
| `loader` | `Record<string, Loader>` | Custom file extension loaders |
| `format` | `"esm" \| "cjs" \| "iife"` | Output module format |
| `naming` | `string \| { chunk, entry, asset }` | Output file naming patterns |
| `banner` | `string` | Prepend text to output |
| `drop` | `string[]` | Remove function calls (e.g., `["console", "debugger"]`) |
| `env` | `"inline" \| "disable" \| "PREFIX_*"` | Environment variable handling |
| `jsx` | `{ runtime, importSource, factory, fragment }` | JSX transform configuration |
| `packages` | `"bundle" \| "external"` | Whether to bundle or externalize all packages |

### Example: Minification and Source Maps

```typescript
import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "MyApp",
    identifier: "com.example.myapp",
    version: "1.0.0",
  },
  build: {
    views: {
      mainview: {
        entrypoint: "src/mainview/index.ts",
        minify: true,
        sourcemap: "linked",
        define: {
          "process.env.NODE_ENV": '"production"',
        },
        drop: ["console"],
      },
    },
  },
} satisfies ElectrobunConfig;
```

## URL Schemes (Deep Linking)

Register custom URL schemes for your application:

```typescript
const config: ElectrobunConfig = {
  app: {
    name: "MyApp",
    identifier: "com.example.myapp",
    version: "1.0.0",
    urlSchemes: ["myapp", "myapp-dev"],
  },
  // ...
};
```

**Platform support:**
- macOS: Fully supported (app must be in `/Applications`)
- Windows: Not yet supported
- Linux: Not yet supported

## ASAR Packaging

Package application resources into a single ASAR archive:

```typescript
const config: ElectrobunConfig = {
  build: {
    useAsar: true,
    asarUnpack: ["*.node", "*.dll", "*.dylib", "*.so"],
  },
};
```

Benefits: faster file access, security (code extracted to randomized temp files), fewer files to distribute.

## Watch Configuration

When using `electrobun dev --watch`, extend or refine watched files:

```typescript
export default {
  build: {
    watch: ["scripts", "vendor/my-native-lib"],
    watchIgnore: [
      "assets/licenses.html",
      "**/*.generated.*",
      "data/cache/**",
    ],
  },
} satisfies ElectrobunConfig;
```

## Renderer Configuration

### Platform-specific Renderer Options

#### bundleCEF
- **Type:** `boolean`, **Default:** `false`
- Bundles CEF (Chromium Embedded Framework) with your app (~100MB+ added to bundle).

#### defaultRenderer
- **Type:** `'native' | 'cef'`, **Default:** `'native'`
- Sets the default renderer for all BrowserWindow and BrowserView instances.

```typescript
const config: ElectrobunConfig = {
  build: {
    mac: {
      bundleCEF: true,
      defaultRenderer: 'cef',
    },
    linux: {
      bundleCEF: true,
      defaultRenderer: 'cef',
    },
    win: {
      bundleCEF: true,
      defaultRenderer: 'cef',
    },
  },
};
```

## Custom Bun Version

Override the bundled Bun runtime version:

```typescript
export default {
  build: {
    bunVersion: "1.4.2",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
  },
} satisfies ElectrobunConfig;
```

## Chromium Flags

Pass custom Chromium command-line flags to CEF:

```typescript
const config: ElectrobunConfig = {
  build: {
    mac: {
      bundleCEF: true,
      chromiumFlags: {
        "show-paint-rects": true,          // Switch-only flag
        "user-agent": "MyApp/1.0",         // Flag with value
        "use-mock-keychain": false,        // Skip a default flag
      },
    },
  },
};
```

| Flag | Type | Description |
|------|------|-------------|
| `user-agent` | `string` | Override the default user agent string |
| `show-paint-rects` | `true` | Flash green rectangles over repainted areas |
| `show-composited-layer-borders` | `true` | Show colored borders around GPU-composited layers |

## Runtime Configuration

### exitOnLastWindowClosed
- **Type:** `boolean`, **Default:** `true`
- Set to `false` for tray-only or background apps.

### Custom Runtime Values

Add arbitrary keys accessible at runtime via `BuildConfig`:

```typescript
export default {
  runtime: {
    exitOnLastWindowClosed: true,
    myCustomSetting: "hello",
  },
} satisfies ElectrobunConfig;
```

```typescript
import { BuildConfig } from "electrobun/bun";
const config = await BuildConfig.get();
console.log(config.runtime?.myCustomSetting); // "hello"
```

## Build Lifecycle Hooks

| Hook | When it runs | Use case |
|------|--------------|----------|
| `preBuild` | Before the build starts | Validation, environment setup |
| `postBuild` | After inner app bundle is complete | Modify app bundle contents |
| `postWrap` | After self-extracting bundle created | Add files to wrapper bundle |
| `postPackage` | After all build artifacts created | Custom distribution steps |

### Configuration

```typescript
const config: ElectrobunConfig = {
  scripts: {
    preBuild: "./scripts/pre-build.ts",
    postBuild: "./scripts/post-build.ts",
    postWrap: "./scripts/post-wrap.ts",
    postPackage: "./scripts/post-package.ts",
  },
};
```

### Environment Variables Available to Hooks

| Variable | Description |
|----------|-------------|
| `ELECTROBUN_BUILD_ENV` | `dev`, `canary`, or `stable` |
| `ELECTROBUN_OS` | `macos`, `linux`, or `win` |
| `ELECTROBUN_ARCH` | `x64` or `arm64` |
| `ELECTROBUN_BUILD_DIR` | Path to build output directory |
| `ELECTROBUN_APP_NAME` | Application name with environment suffix |
| `ELECTROBUN_APP_VERSION` | Application version from config |
| `ELECTROBUN_APP_IDENTIFIER` | Bundle identifier from config |
| `ELECTROBUN_ARTIFACT_DIR` | Path to artifacts output directory |
| `ELECTROBUN_WRAPPER_BUNDLE_PATH` | (postWrap only) Path to self-extracting wrapper |

## Full Example (Electrobun Playground)

```typescript
import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Electrobun (Playground)",
    identifier: "dev.electrobun.playground",
    version: "0.0.1",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/index.ts",
      },
      myextension: {
        entrypoint: "src/myextension/preload.ts",
      },
      webviewtag: {
        entrypoint: "src/webviewtag/index.ts",
      },
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
      "src/mainview/index.css": "views/mainview/index.css",
      "src/webviewtag/index.html": "views/webviewtag/index.html",
      "src/webviewtag/electrobun.png": "views/webviewtag/electrobun.png",
      "assets/electrobun-logo-32-template.png": "views/assets/electrobun-logo-32-template.png",
    },
    mac: {
      codesign: true,
      notarize: true,
      bundleCEF: true,
      defaultRenderer: 'cef',
      entitlements: {
        "com.apple.security.device.camera": "Camera access for video features",
        "com.apple.security.device.microphone": "Microphone access for audio features",
      },
      icons: "icon.iconset",
    },
    linux: {
      bundleCEF: true,
      defaultRenderer: 'cef',
    },
    win: {
      bundleCEF: true,
      defaultRenderer: 'cef',
    },
  },
  scripts: {
    postBuild: "./buildScript.ts",
  },
  release: {
    baseUrl: "https://static.electrobun.dev/playground/",
  },
} satisfies ElectrobunConfig;
```
