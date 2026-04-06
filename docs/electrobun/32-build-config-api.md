# BuildConfig API

> Source: https://blackboard.sh/electrobun/docs/apis/build-config/

## Overview

The `BuildConfig` API gives your Bun process access to configuration values that were set at build time in your `electrobun.config.ts`.

## Key Use Cases

- Determining which renderers are available in the current build
- Checking the default renderer configuration
- Implementing conditional logic based on build settings
- Debugging and logging build information

## API Methods

### BuildConfig.get()

Asynchronous method that loads and returns the build configuration with result caching after the first call.

**Returns:** `Promise<BuildConfigType>`

### BuildConfig.getCached()

Returns cached build configuration synchronously, or `null` if not yet loaded.

**Returns:** `BuildConfigType | null`

## BuildConfigType Properties

| Property | Type | Description |
|----------|------|-------------|
| `defaultRenderer` | `'native' \| 'cef'` | Default renderer for BrowserWindow/BrowserView |
| `availableRenderers` | `('native' \| 'cef')[]` | List of available renderers in this build |
| `cefVersion` | `string \| undefined` | CEF version string (present only when CEF is bundled) |
| `bunVersion` | `string \| undefined` | Bun runtime version used in build |
| `runtime` | `object` | Runtime configuration from `electrobun.config.ts` |

## Usage Example

```javascript
import { BuildConfig } from "electrobun/bun";

const config = await BuildConfig.get();

console.log("Default renderer:", config.defaultRenderer);
console.log("Available renderers:", config.availableRenderers);

if (config.availableRenderers.includes('cef')) {
  console.log("CEF is bundled with this app");
}
```

## Implementation Details

During the build process, the CLI reads `electrobun.config.ts` and generates a `build.json` file. The API reads and caches this file, providing access to renderer settings and the entire `runtime` section from configuration.
