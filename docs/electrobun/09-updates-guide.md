# Updates Guide

> Source: https://blackboard.sh/electrobun/docs/guides/updates/

## Introduction

Electrobun provides an integrated update system that requires only a static file host for distribution. The framework includes:

- **Update API** to check for, download, and apply updates
- **CLI tools** for building bundles, codesigning, and generating artifacts
- **BSDIFF implementation** in Zig with SIMD optimization, enabling updates as small as 14KB

## Hosting on GitHub Releases

GitHub Releases offers a straightforward hosting option, particularly suited for open source projects. The system uses a flat, prefix-based naming convention (e.g., `stable-macos-arm64-update.json`) compatible with hosts lacking folder structure support.

### Configuration

Configure your `baseUrl` in `electrobun.config` to reference GitHub Releases:

```typescript
// electrobun.config.ts
export default {
  // ...
  release: {
    baseUrl: "https://github.com/YOUR_ORG/YOUR_REPO/releases/latest/download",
  },
};
```

### Example GitHub Action

This workflow builds and publishes releases when tags are pushed:

```yaml
name: Build and Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build-macos-arm64:
    runs-on: macos-14  # Apple Silicon runner

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Determine build environment
        id: build-env
        run: |
          if [[ "${{ github.ref_name }}" == *"-canary"* ]]; then
            echo "env=canary" >> $GITHUB_OUTPUT
          else
            echo "env=stable" >> $GITHUB_OUTPUT
          fi

      - name: Build app
        env:
          ELECTROBUN_DEVELOPER_ID: ${{ secrets.ELECTROBUN_DEVELOPER_ID }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: |
          if [ "${{ steps.build-env.outputs.env }}" = "canary" ]; then
            bun run build:canary
          else
            bun run build:stable
          fi

      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: artifacts/*
          draft: false
          prerelease: ${{ steps.build-env.outputs.env == 'canary' }}
          generate_release_notes: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The `generate_release_notes: true` option leverages GitHub's automatic release notes feature, highlighting merged PRs and contributors since the previous release.

## Limitations

### Single Patch File

Electrobun generates only one patch file per build -- from the immediately preceding version to the current version. Consequently:

- Users updating from the previous version receive minimal delta patches (frequently just kilobytes)
- Users behind multiple versions automatically revert to downloading the complete `.tar.zst` bundle

This approach balances simplicity in the build process with delta update benefits for regular users.

### Canary Builds on GitHub Releases

GitHub's `/releases/latest/download` endpoint resolves exclusively to non-prerelease builds, resulting in:

- **Stable builds**: Auto-updates function properly via `/releases/latest/download`
- **Canary builds**: Auto-updates fail because the `latest` URL ignores prerelease versions

For auto-updating canary builds, consider static file hosts like Cloudflare R2 or AWS S3 where URL structures remain under your control.
