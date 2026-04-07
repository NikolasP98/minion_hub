# Architecture Overview

> Source: https://blackboard.sh/electrobun/docs/guides/architecture/overview/

## High Level App Architecture

An Electrobun app is fundamentally a Bun application. A minimal launcher (typically a Zig binary) executes the Bun app. Since native GUIs require a blocking event loop on the main thread, the primary Bun thread creates a webworker containing your code and uses Bun's FFI to initialize the native GUI event loop. Your Bun code running in the worker can leverage Electrobun's APIs, which call Electrobun's native wrapper code via Bun's FFI to open windows, create system trays, relay events, and enable RPC.

## Application Bundles

### MacOS

#### Your Installed App

On macOS, an application bundle is a folder with a `.app` file extension. Key subfolders include:

- `/Contents/MacOS` -- Electrobun places several binaries here. Additional bundled binaries on Mac requiring code-signing must be placed here.
- `/Contents/MacOS/bspatch` -- An optimized Zig implementation of bspatch for generating and applying diffs during updates.
- `/Contents/MacOS/bun` -- The Bun runtime.
- `/Contents/MacOS/launcher` -- An optimized Zig binary that typically calls `bun index.js` with the included runtime to run your compiled Bun entrypoint file.
- `/Contents/MacOS/libNativeWrapper.dylib` -- A library containing Electrobun's native code layer for the platform. On macOS, this consists of Objective-C/C++ code for interfacing with macOS APIs like NSWindow and WKWebKit.
- `/Contents/MacOS/Resources` -- Electrobun compiles your application's custom code here.
- `/Contents/MacOS/Resources/AppIcon.icns` -- Your application icons.
- `/Contents/MacOS/Resources/version.json` -- Local version information that `Electrobun.Updater` reads.
- `/Contents/MacOS/Resources/app/bun/` -- Folder containing the bundled JavaScript code for the main Bun process.
- `/Contents/MacOS/Resources/app/views` -- Location where views defined in `electrobun.config.ts` are transpiled. BrowserViews can use the `views://` URL schema to load bundled static content.

#### IPC

Electrobun employs several mechanisms for communication between Bun and browser contexts. It primarily uses postMessage and FFI, but also utilizes more efficient encrypted web sockets for IPC.

#### Self-Extracting Bundle

To minimize app size, Electrobun bundles your application into a self-extracting ZSTD bundle. The entire app bundle is tarred, compressed with zlib, and wrapped in a second application bundle for distribution.

> **Info:** The current Electrobun Playground app is 50.4MB in size (most of this is the bun runtime), but when compressed and distributed as the self-extracting bundle it's only 13.1MB which is almost 5 times smaller.

The self-extracting bundle structure:

- `/Contents/MacOS/launcher` -- A Zig binary distinct from the regular launcher that decompresses your app bundle using zlib.
- `/Contents/Resources/AppIcons.icns` -- App icons stored so the self-extractor resembles your extracted bundled app.
- `/Contents/Resources/23fajlkj2.tar.zst` -- Your actual app bundled, tarred, and compressed with the name set to the hash.

Users can install the self-extracting bundle in the `/Applications/` folder or run it from any directory. Upon opening, it transparently self-extracts and replaces itself with the full application, then launches it. The extraction process only occurs on first install and is entirely local and self-contained.

#### DMG

Electrobun automatically generates a DMG containing the self-extracting bundle.

## Code Signing and Notarization

Electrobun automatically code signs and notarizes your application.

### MacOS

Prerequisites include registering an Apple Developer account, creating an app ID, and downloading your code signing certificate. Set `codesigning` and `notarization` flags to `true` in your `electrobun.config` file and make credentials available in your environment. No private keys need to be in your code repository.

Electrobun code signs and notarizes both your app bundle and the self-extracting bundle, ensuring end-users can verify the application's legitimacy and that Apple has scanned it.

While code signing is fast, notarization requires uploading a zip file to Apple's servers for scanning and verification, typically taking 1-2 minutes. The notarization is then stapled to your app bundle.

When debugging non-dev builds, disable code signing and/or notarization in your `electrobun.config` to accelerate the build process. Notarization issues display in the terminal for resolution, usually involving setting application entitlements to declare your app's usage to Apple and end-users.

## Updating

Electrobun provides a built-in update mechanism optimizing updates for file-size and efficiency.

> **Info:** Ship updates to your users as small as 14KB. This lets you ship often without paying huge storage and network fees.

No server is required -- only a static file host like S3, optionally behind a CDN like CloudFront. Most apps remain within AWS's free tier even with frequent updates.

### How does it work

Using the Electrobun Updater API, you can check for updates and automatically download and install them:

1. Compare the local `version.json` hash against the hosted `update.json` hash of the latest version.
2. If different, download the tiny patch file matching your hash (generated with BSDIFF) and apply it.
3. Generate a hash of the patched bundle. If it matches the latest hash, replace the running application and relaunch.
4. If the hash doesn't match, search for another patch file and continue patching until it does.
5. If the algorithm cannot patch to the latest version, download a zlib-compressed bundle from your static host.

> **Info:** When building non-dev releases, the Electrobun CLI automatically generates patches from the current hosted version to the newly built version. You control how many patches remain available on your static host.

## CLI and Development Builds

The Electrobun CLI is automatically installed locally to your project when you run `bun install electrobun`. Add npm scripts and an `electrobun.config` file to build your app.

### Development Builds

`dev` builds use a special development launcher binary that routes Bun, Zig, and native output to your terminal, unlike the optimized launcher binary used in production. Dev builds aren't meant for distribution, so the CLI doesn't generate artifacts.

### Distribution

When building `canary` and `stable` releases, Electrobun generates an `artifacts` folder containing everything needed for uploading to a static host for distribution and updates.
