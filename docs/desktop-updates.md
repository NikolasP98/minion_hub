# Minion Hub desktop updates

The desktop shell loads the hosted Hub. Web deployments do not require a new
desktop installer. Native shell changes use GitHub Releases and Tauri's updater.

## Behavior

At startup, the bundled update window checks a small static version file. A newer
desktop version downloads, verifies and installs before Hub opens. The user can
continue during checking or downloading; that cancels the install intent. Once
installation begins, the app restarts when it completes.

While Hub is active, the native process checks every six hours plus up to fifteen
minutes of jitter. It announces each new version once per process. The user saves
their work and chooses **Install and restart**, or waits until the next startup.
The app and tray menus also provide **Check for updates…**.

Metadata failures at startup open Hub. Download or installation failures show
Retry/Continue. An unavailable update server never authorizes an unchecked install.
AppImage, Windows NSIS and macOS bundles support automatic installation. System
Debian packages show a download notice and use the package manager; the app never
invokes an administrator password helper.

Version 0.0.1 has no updater. Users install the first updater-enabled release once
from the repository's Releases page. Subsequent updates download binaries, not
source archives. Updates currently replace the full native package; binary delta
patches are outside this implementation.

## Hosting and checks

The fixed endpoint is
`https://github.com/NikolasP98/minion_hub/releases/download/desktop-updates/latest.json`.
Versioned packages remain under `desktop-vX.Y.Z`. The channel is a separate
prerelease because GitHub's `/releases/latest` does not select preview releases.

One startup request and roughly four background requests per continuously active
app per day contact GitHub, without an API token or user identity. ETags reuse
metadata on HTTP 304 during the process lifetime. Startup makes a fresh request;
the ETag cache is not persisted. Metadata has a five-second timeout and a 64 KiB
limit. Packages have a ten-minute timeout and a 256 MiB limit. Only fixed HTTPS
GitHub release paths are admitted, and redirects must remain HTTPS.

No database, app API, Vercel function, updater subscription or new hosting service
is needed. GitHub documents no release download bandwidth limit. Build/Actions
usage remains subject to the repository's existing plan. Conditional requests
reduce bytes, not request count.

## Integrity key

OS publisher signing remains optional. No Apple Developer, notarization, Azure
Authenticode or GPG account is required by this pipeline. Automatic updates use a
separate free minisign/Ed25519 key. Tauri requires it to verify packages.

The public key is in `src-tauri/tauri.conf.json`. The durable private key is the
repository secret `DESKTOP_UPDATER_PRIVATE_KEY`. The owner-local backup is
`~/.local/share/minion/desktop-updater.key`, mode `0600`; preserve it in a private
backup. Never commit or print it. Losing all access to the key prevents updates
to existing installations and requires a new manual bootstrap.

PR jobs generate disposable keys outside their upload directories. They cannot
access the production secret, and their artifacts cannot pass release assembly
against the production public key. `requireSignedVersion` binds each payload to
its signed version. The default version comparator rejects equal/older versions.
Release assembly verifies payload signatures, trusted comments, hashes and all
four targets before creating a feed.

The hosted Hub has no updater permissions. Only the bundled `updater` window can
invoke the narrow status/check/install/continue/download commands. JavaScript
cannot supply an endpoint, package URL, public key or installer arguments.

## Build and publish

Merge the qualified desktop PR through the owner's normal approval process.
Run **Desktop release with automatic updates** on `master`, with a new stable
version. Its default creates a draft containing five installers, four updater
targets, signatures, checksums and provenance. No feed changes occur for drafts.

After reviewing the draft and installed update qualification, the owner runs
**Publish qualified desktop draft** with the same version. It checks that the
release commit belongs to `master`, downloads and verifies its assets, publishes
the preview and advances `desktop-updates/latest.json`. This avoids rebuilding
installers merely to publish an already qualified draft. Alternatively, the
release workflow's explicit `publish` input performs publication after building.

Publication is serialized. The feed only advances to a newer numeric semantic
version; repeating an identical feed is harmless. A feed upload failure can leave
a short interval without metadata. Clients continue using their existing app;
retry the publish workflow after correcting the failure. Never replace versioned
installer assets. Roll forward with a new version to revert application behavior.

## Local validation

```sh
bun install --frozen-lockfile --ignore-scripts
bun run desktop:ui
node --test scripts/desktop/*.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
bun run lint:design
bun run lint:tokens
```

For actual-component UI qualification, run
`bunx vite --config desktop/vite.config.ts` and open
`http://127.0.0.1:5201/fixture.html` in the prescribed headless browser harness.
The development-only fixture mocks Tauri IPC. It is not an entry in the bundled
native assets, and it does not prove OS installation or relaunch behavior.

On Windows, run `./scripts/desktop/test-windows.ps1` with `DESKTOP_TARGET` set to
`x86_64-pc-windows-msvc` instead of plain `cargo test`. It embeds the normal Common
Controls v6 activation manifest into Cargo's test executable using the installed
Windows SDK `mt.exe`, then runs all native tests. The app binary receives its
manifest from Tauri. This XML resource is unrelated to publisher signing.

## Rust build choices

The release profile retains `opt-level = "s"`, stripping, one codegen unit,
abort-on-panic and full LTO. The desktop library emits only `rlib`; unused mobile
`staticlib`/`cdylib` outputs are removed. The updater and metadata client share
ring/rustls instead of compiling a second crypto provider. CI restores Rust
dependency caches. Trusted same-repository PRs save their own scoped dependency
caches even after a failed test; releases use `master` caches. GitHub's branch
isolation prevents a release from restoring a child PR's cache.

The isolated Linux baseline emitted a 221,744,274-byte static archive and a
325,256-byte shared library that are not needed for desktop distribution. Their
removal reduces generated build outputs. Cold baseline and dependency-rebuilding
probe timings are not comparable; no installer-size, startup-time or runtime CPU
improvement is claimed from these measurements.

## Sources

- [Tauri updater](https://v2.tauri.app/plugin/updater/)
- [Signed-version binding in Tauri CLI 2.12.0](https://v2.tauri.app/release/@tauri-apps/cli/v2.12.0/)
- [Updater 2.14.0 Rust API](https://docs.rs/tauri-plugin-updater/2.14.0/tauri_plugin_updater/)
- [GitHub release bandwidth policy](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
- [Tauri Windows mock-test loader issue](https://github.com/tauri-apps/tauri/issues/13419)
- [GitHub cache access boundaries](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache)
