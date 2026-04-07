# CLI Commands & Arguments

> Source: https://blackboard.sh/electrobun/docs/apis/cli/cli-args/

## Installation

The CLI tool is included when you install Electrobun via `bun install electrobun`, making the `electrobun` command available through npm scripts or `bunx`/`npx`.

## Available Commands

### electrobun init

Initializes new Electrobun projects with starter templates.

```bash
electrobun init
electrobun init [template-name]
```

**Available Templates:**
- `hello-world` - Basic single-window application
- `photo-booth` - Camera app with photo capture
- `interactive-playground` - Interactive Electrobun APIs showcase
- `multitab-browser` - Multi-tabbed web browser

**Examples:**

```bash
bunx electrobun init
bunx electrobun init photo-booth
bunx electrobun init multitab-browser
```

### electrobun build

Builds applications according to `electrobun.config.ts` configuration.

```bash
electrobun build [options]
```

| Option | Description | Values | Default |
|--------|-------------|--------|---------|
| `--env` | Build environment | `dev`, `canary`, `stable` | `dev` |

```bash
electrobun build
electrobun build --env=dev
electrobun build --env=canary
electrobun build --env=stable
```

> **Note:** Builds target the current host platform/architecture only.

### electrobun run

Launches an already-built dev bundle without rebuilding.

```bash
electrobun run
```

### electrobun dev

Builds in dev mode and launches the application.

```bash
electrobun dev [options]
```

| Option | Description |
|--------|-------------|
| `--watch` | Watch source files and automatically rebuild + relaunch |

```bash
electrobun dev
electrobun dev --watch
```

**Watch Mode Details:**

Automatically monitors:
- Directory containing `build.bun.entrypoint`
- Directories with view entrypoints
- Paths from `build.copy`
- Paths in `build.watch`

Changes trigger app termination, fresh build, and relaunch. Debounced at 300ms. Build failures log errors without stopping the watcher. Press Ctrl+C to exit.

Use `build.watchIgnore` to exclude files from triggering rebuilds.

## Build Environments

### Development (`dev`)
- Outputs logs/errors to terminal
- No code signing/notarization
- Creates build in `build/` folder
- No artifacts generated

### Canary
- Pre-release/beta builds
- Optional code signing/notarization
- Generates distribution artifacts
- Creates update manifests

### Stable
- Production-ready builds
- Full code signing/notarization (if configured)
- Optimized, compressed artifacts
- Ready for end-user distribution

## Build Script Examples

**Basic Setup:**

```json
{
  "scripts": {
    "start": "electrobun run",
    "dev": "electrobun dev",
    "dev:watch": "electrobun dev --watch",
    "build:canary": "electrobun build --env=canary",
    "build:stable": "electrobun build --env=stable"
  }
}
```

For multi-platform distribution, run the same build command on each platform's CI runner.
