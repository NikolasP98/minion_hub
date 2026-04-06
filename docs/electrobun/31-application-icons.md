# Application Icons

> Source: https://blackboard.sh/electrobun/docs/apis/application-icons/

## Introduction

This section explains how to set up application icons across different platforms. These icons appear in the app switcher and file system locations like the Desktop or Applications folder.

## macOS

The default icon folder location is `icon.iconset` at your repository root.

Recommended icon sizes and naming convention:

```
icon_16x16.png
[email protected]
icon_32x32.png
[email protected]
icon_128x128.png
[email protected]
icon_256x256.png
[email protected]
icon_512x512.png
[email protected]
```

A custom path can be specified in the `electrobun.config` file.

## Windows

Configure the `build.win.icon` option in `electrobun.config` to point to an `.ico` or `.png` file. PNG files automatically convert to ICO format during the build process.

The icon embeds into the launcher executable, Bun runtime executable, and installer, appearing in the taskbar, desktop shortcuts, and File Explorer.

For `.ico` files, include sizes: 16x16, 32x32, 48x48, and 256x256. PNG files should be at least 256x256 pixels.

```typescript
const config: ElectrobunConfig = {
  build: {
    win: {
      icon: "assets/icon.ico",
      // or use a PNG from your macOS iconset:
      // icon: "icon.iconset/icon_256x256.png",
    },
  },
};
```

## Linux

Set the `build.linux.icon` option in `electrobun.config` to a `.png` file path. Minimum size requirement is 256x256 pixels.

```typescript
const config: ElectrobunConfig = {
  build: {
    linux: {
      icon: "assets/icon.png",
      // or use a PNG from your macOS iconset:
      // icon: "icon.iconset/icon_256x256.png",
    },
  },
};
```

> **Tip:** Reuse PNGs from the macOS `icon.iconset` folder for Windows and Linux builds to avoid maintaining separate icon files per platform.
