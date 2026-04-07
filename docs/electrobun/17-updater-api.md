# Updater API

> Source: https://blackboard.sh/electrobun/docs/apis/updater/

## Overview

Electrobun ships with a built-in update mechanism that lets you ship updates to your app as small as 14KB so you can ship often.

## Configuration

Updates require configuration in the `electrobun.config` file:

```typescript
{
  "release": {
    "baseUrl": "https://your-release-url"
  }
}
```

## Import

```typescript
import { Updater } from "electrobun/bun";
```

## Methods

### getLocalInfo()

Retrieves local version information from the bundled `version.json` file.

```typescript
const localInfo = await Electrobun.Updater.getLocalInfo();
```

**Returns:**

```typescript
{
  version: string;
  hash: string;
  baseUrl: string;
  channel: string;
  name: string;
  identifier: string;
}
```

### checkForUpdate()

Fetches the `update.json` file from the configured `baseUrl` for the current channel and platform.

```typescript
const updateInfo = await Electrobun.Updater.checkForUpdate();
```

**Returns:**

```typescript
{
  version: string;
  hash: string;
  updateAvailable: boolean;
  updateReady: boolean;
  error: string;
}
```

### downloadUpdate()

Initiates downloading and applying patch files. Falls back to downloading the full app if a patch trail is unavailable.

```typescript
await Electrobun.Updater.downloadUpdate();
```

### applyUpdate()

Applies a ready update by quitting the current app, replacing it, and relaunching.

```typescript
if (Electrobun.Updater.updateInfo()?.updateReady) {
  await Electrobun.Updater.applyUpdate();
}
```

## Full Update Flow Example

```typescript
import { Updater } from "electrobun/bun";

// Check for updates on app start
const updateInfo = await Updater.checkForUpdate();

if (updateInfo.updateAvailable) {
  console.log(`Update available: v${updateInfo.version}`);

  // Download the update
  await Updater.downloadUpdate();

  // Apply when ready
  if (Updater.updateInfo()?.updateReady) {
    await Updater.applyUpdate(); // Quits, replaces, relaunches
  }
}
```
