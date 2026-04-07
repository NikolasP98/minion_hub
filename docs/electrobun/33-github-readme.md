# Electrobun - GitHub README

> Source: https://github.com/blackboardsh/electrobun

## Overview

Electrobun is a framework for building ultra fast, tiny, and cross-platform desktop applications written in TypeScript. It uses Bun for the main process and bundling, with native bindings written in Zig.

## Getting Started

```bash
npx electrobun init
```

## Core Project Goals

- Write TypeScript for main process and webviews seamlessly
- Process isolation between main and webview with typed RPC
- Self-extracting bundles approximately 12MB (using system webview)
- Minimal app updates as small as 14KB via binary diffs
- Complete integrated workflow: code in 5 minutes, distribute in 10

## Notable Applications Built with Electrobun

The framework powers 40+ applications including:
- **Audio TTS** - text-to-speech with voice cloning
- **Co(lab)** - hybrid web browser and code editor
- **Deskdown** - converts web addresses to desktop apps
- **Guerilla Glass** - cross-platform creator studio
- **PLEXI** - terminal multiplexer for AI-driven workflows
- **VibesOS** - Claude Code GUI for app development

## Development Requirements

**macOS:** Xcode command line tools, CMake
**Windows:** Visual Studio Build Tools, CMake
**Linux:** build-essential, CMake, GTK/WebKit2 development packages

## Build Commands

From the `/package` directory:
- `bun dev` - Standard development build
- `bun dev:clean` - Complete fresh rebuild
- `bun build:release` - Production release build

## Platform Support

| OS | Status |
|---|---|
| macOS 14+ | Official |
| Windows 11+ | Official |
| Ubuntu 22.04+ | Official |
| Other Linux | Community |

## Language Composition

- TypeScript: 48.2%
- C++: 30.4%
- Objective-C++: 11.3%
- HTML: 3.7%
- Zig: 2.8%

## Links

- **Documentation:** https://blackboard.sh/electrobun/docs/
- **GitHub:** https://github.com/blackboardsh/electrobun
- **Discord:** https://discord.gg/ueKE4tjaCE
