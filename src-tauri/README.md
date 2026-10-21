# Minion Hub native shell

The owner selected Tauri after reviewing the installable web app option on
2026-10-20. The PWA remains available for users who only need a separate window.

The desktop binary loads `https://hub.minion-ai.org` directly. It bundles no
Node runtime, SvelteKit server, database, environment file or credentials.
Supabase login uses the hosted origin's cookies in the persistent OS webview;
it does not copy cookies from the user's browser. Sign in once in this app.

The hosted Hub supplies a draggable titlebar with minimize, maximize/restore
and close controls, including on login pages. The native app menu provides
show, reload, quit and standard editing commands. The tray provides show/quit.
Closing the window exits the application; minimizing keeps the tray available.

`minion://hub/es/crm/customers?q=ana` opens the corresponding hosted route.
Only the `minion` scheme and `hub` authority are accepted. Userinfo and ports
are rejected. Paths, query strings and fragments cannot change the trusted
HTTPS origin. Existing route authentication and RBAC apply to deep links.
The single-instance plugin forwards links into an already running application.
The native drag/drop handler is disabled so HTML5 file drops reach the shared
web chooser, including on Windows WebView2; no filesystem permission is added.

## Develop and build

Install the Tauri platform prerequisites, then run from the Hub checkout:

```bash
bun install --frozen-lockfile
bun run tauri:dev
bun run tauri:build
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Neither command builds or starts a local app server. The remote Hub must have
the matching titlebar change deployed before distributing a desktop binary.
For a different hosted deployment, change `HUB_ORIGIN` in `src/lib.rs`, `build.frontendDist` in
`tauri.conf.json` and the exact matching remote URL in
`capabilities/default.json` together. Keep HTTPS;
never grant filesystem, process, shell or broad core permissions to remote pages.
External HTTPS identity-provider redirects are allowed but receive no native
IPC permissions. Provider sign-in still requires installed-app qualification;
some providers restrict embedded webviews. The OS webview owns auth.

`Cargo.lock` is part of the release input. `rust-ini` is constrained to 0.21.1
because deep-link 2.6.2 constructs the earlier `ParseOption` shape; 0.21.2 and
0.21.3 fail compilation. Requalify both before removing that constraint.

## Download the unsigned preview

The owner chose unsigned installers on 2026-10-20. The current release is
[desktop-v0.0.1](https://github.com/NikolasP98/minion_hub/releases/tag/desktop-v0.0.1),
with Linux x64 AppImage/DEB, Windows x64 EXE and macOS Apple Silicon/Intel DMGs.
Check downloaded bytes against the release's `SHA256SUMS`.

These builds are unsigned and macOS builds are not notarized. Windows SmartScreen
and macOS Gatekeeper may warn or prevent launch. Native tests and packaging pass
on all four targets; installed sign-in, restart persistence, controls, deep links
and file drops still need qualification on each OS. This release is a preview.

For Linux AppImage, make the downloaded file executable and open it:

```bash
chmod +x Minion-Hub_0.0.1_linux-x64.AppImage
./Minion-Hub_0.0.1_linux-x64.AppImage
```

Linux packages use `linux/main.desktop` so protocol launches pass their URI as
an argument (`%u`). The pinned AppImage bundler also uses this Debian template.
The Linux build job inspects the packaged DEB launcher before collecting assets.
AppImage users need desktop integration through their AppImage launcher for OS
protocol registration; running a portable image alone does not install it.

## Create another preview release

`.github/workflows/desktop-release.yml` builds the four targets from `master`
using committed `Cargo.lock`, all with `--no-sign`. Release assembly verifies the
complete five-installer matrix, version, exact source SHA and file digests. It
writes honest unsigned-preview notes, direct install links, a manifest and
`SHA256SUMS`. Signing accounts, certificates and repository secrets are not
release prerequisites.

Run **Desktop unsigned preview release** on `master` with a new stable desktop
version `X.Y.Z`. Set `publish=true` to publish a prerelease immediately, or leave
it false to assemble a draft. The tag is `desktop-vX.Y.Z`, separate from the
web changelog's `hub-v*` tags. Existing releases are never replaced.

Pull requests run `.github/workflows/desktop-qualification.yml` and retain
unsigned Actions artifacts. The first preview reused the successful run
39531728582 after verifying its full Git tree exactly matches merged source
`26e82cfc90f8279875dfa64b89e9a50a6f1323fe`; its release manifest records both
identities and the build run. Installer bytes were unchanged after CI.

For local release-contract checks, run:

```bash
node --test scripts/desktop/*.test.mjs
```

API references: [window customization](https://v2.tauri.app/learn/window-customization/),
[system tray](https://v2.tauri.app/learn/system-tray/),
[deep linking](https://v2.tauri.app/plugin/deep-linking/).
