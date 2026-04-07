# Bundling & Distribution

> Source: https://blackboard.sh/electrobun/docs/guides/bundling-and-distribution/

This guide continues from the Creating UI section and covers preparing applications for distribution using Electrobun.

## Build Scripts Setup

Add build scripts to `package.json`:

```json
{
  "name": "my-app",
  "devDependencies": {
    "@types/bun": "latest"
  },
  "peerDependencies": {
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "electrobun": "^0.0.1"
  },
  "scripts": {
    "start": "electrobun run",
    "dev": "electrobun dev",
    "dev:watch": "electrobun dev --watch",
    "build:dev": "bun install && electrobun build",
    "build:canary": "electrobun build --env=canary",
    "build:stable": "electrobun build --env=stable"
  }
}
```

Execute builds using:

```bash
bun run build:canary
# or
bun run build:stable
```

## Build Process

Non-development builds automatically:

- Generate an optimized application bundle
- Apply ZSTD compression for efficient packaging
- Create self-extracting bundles
- Produce an `artifacts` folder for distribution

Distribution requires only a static file host (S3, Google Cloud Storage, etc.) -- no server infrastructure needed.

## Configuration

Update `electrobun.config.ts` with your release host:

```typescript
export default {
  app: {
    name: "My App",
    identifier: "dev.my.app",
    version: "0.0.1",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      "main-ui": {
        entrypoint: "src/main-ui/index.ts",
      },
    },
    copy: {
      "src/main-ui/index.html": "views/main-ui/index.html",
    },
  },
  release: {
    baseUrl: "https://storage.googleapis.com/mybucketname/myapp/",
  },
};
```

## Distribution Workflow

Upload artifact folder contents to your release host (S3, R2, GitHub Releases, etc.). The flat file structure with `channel-os-arch` prefixes works universally, including with GitHub Releases which don't support directories.

Subsequent builds automatically download the current version and generate patch files using optimized BSDIFF. Retain historical patches -- users on older versions download successive patches (often as small as 14KB). When patching cannot reach the latest version, the Updater falls back to full build downloads.

## Build Lifecycle Hooks

Electrobun provides execution hooks at various build stages:

- **preBuild**: Environment validation
- **postBuild**: Code transformation
- **postWrap**: Custom file additions
- **postPackage**: Build completion notifications

Details available in [Build Configuration](./22-build-configuration.md#build-lifecycle-hooks).

## Artifacts Folder Structure

The flat artifacts directory uses `{channel}-{os}-{arch}-` prefixes:

```
artifacts/
├── canary-macos-arm64-update.json
├── canary-macos-arm64-MyCoolApp-canary.dmg
├── canary-macos-arm64-MyCoolApp-canary.app.tar.zst
├── canary-macos-arm64-a1b2c3d4.patch
├── canary-win-x64-update.json
├── canary-win-x64-MyCoolApp-Setup-canary.zip
├── canary-win-x64-MyCoolApp-canary.tar.zst
├── canary-win-x64-a1b2c3d4.patch
├── canary-linux-x64-update.json
├── canary-linux-x64-MyCoolAppSetup-canary.tar.gz
├── canary-linux-x64-MyCoolApp-canary.tar.zst
├── canary-linux-x64-a1b2c3d4.patch
└── ...
```

### Naming Conventions

Application names are sanitized by removing spaces ("My Cool App" becomes "MyCoolApp"). Stable builds omit channel suffixes; other channels append their designation.

Windows and Linux installers distribute as archives (`.zip` and `.tar.gz`), with sanitized filenames but user-friendly names preserved inside.

### macOS Artifacts

```
# Canary:
canary-macos-arm64-update.json
canary-macos-arm64-MyCoolApp-canary.dmg
canary-macos-arm64-MyCoolApp-canary.app.tar.zst
canary-macos-arm64-a1b2c3d4.patch

# Stable:
stable-macos-arm64-MyCoolApp.dmg
stable-macos-arm64-MyCoolApp.app.tar.zst
```

### Windows Artifacts

```
# Canary:
canary-win-x64-update.json
canary-win-x64-MyCoolApp-Setup-canary.zip
canary-win-x64-MyCoolApp-canary.tar.zst
canary-win-x64-a1b2c3d4.patch

# Stable:
stable-win-x64-MyCoolApp-Setup.zip
stable-win-x64-MyCoolApp.tar.zst
```

### Linux Artifacts

```
# Canary:
canary-linux-x64-update.json
canary-linux-x64-MyCoolAppSetup-canary.tar.gz
canary-linux-x64-MyCoolApp-canary.tar.zst
canary-linux-x64-a1b2c3d4.patch

# Stable:
stable-linux-x64-MyCoolAppSetup.tar.gz
stable-linux-x64-MyCoolApp.tar.zst
```

## Download URL Construction

URLs follow the pattern `{baseUrl}/{artifact-filename}`:

```
# Examples (baseUrl: "https://releases.example.com/myapp")

# macOS ARM
https://releases.example.com/myapp/canary-macos-arm64-MyCoolApp-canary.dmg

# macOS Intel
https://releases.example.com/myapp/canary-macos-x64-MyCoolApp-canary.dmg

# Windows
https://releases.example.com/myapp/canary-win-x64-MyCoolApp-Setup-canary.zip

# Linux x64
https://releases.example.com/myapp/canary-linux-x64-MyCoolAppSetup-canary.tar.gz

# Linux ARM
https://releases.example.com/myapp/canary-linux-arm64-MyCoolAppSetup-canary.tar.gz
```

## Platform Reference

| Platform | OS Value | Arch Values | Format |
|----------|----------|-------------|--------|
| macOS | `macos` | `arm64`, `x64` | `.dmg` |
| Windows | `win` | `x64` | `.zip` |
| Linux | `linux` | `x64`, `arm64` | `.tar.gz` |

## Patch Files

Patch files incorporate a hash representing the source version (e.g., `canary-macos-arm64-a1b2c3d4.patch`). Maintaining historical patches enables users on older versions to progressively update to the latest build.
