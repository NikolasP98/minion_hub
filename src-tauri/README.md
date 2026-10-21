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

Code signing and platform installer distribution remain release operations;
this change does not create signing credentials or publish installers.

API references: [window customization](https://v2.tauri.app/learn/window-customization/),
[system tray](https://v2.tauri.app/learn/system-tray/),
[deep linking](https://v2.tauri.app/plugin/deep-linking/).

## Signed installers in GitHub Releases

The owner requires signed installers. `.github/workflows/desktop-release.yml`
accepts a stable version `X.Y.Z` on `master` only. It builds Linux x64 `.deb`
and `.AppImage`, Windows x64 NSIS `.exe`, and separate macOS Apple Silicon/Intel
`.dmg` installers. Every build uses committed `Cargo.lock` and the dispatch's
exact source SHA. No signing credential is passed to pull-request jobs.

The release job assembles all five installers, verifies their build receipts
and digests, and signs both Linux installers and `SHA256SUMS` with OpenPGP.
macOS requires Developer ID signatures, notarization and stapled tickets.
Windows requires trusted, timestamped Authenticode signatures from the expected
publisher on both the application and installer. A missing credential or failed
verification stops the job; it cannot fall back to an unsigned release.

The result is a **draft** release tagged `desktop-vX.Y.Z` in
[NikolasP98/minion_hub Releases](https://github.com/NikolasP98/minion_hub/releases).
Its notes contain direct installation links, checksums, public signing key and
source identity. These desktop tags are separate from the generated web
changelog's `hub-v*` tags. The workflow never publishes the draft.

Pull requests run `.github/workflows/desktop-qualification.yml`. These unsigned
builds are short-lived Actions artifacts labeled `UNSIGNED-qualification-*`.
They prove platform compilation and packaging only. Release assembly rejects
their receipts. They are never copied into GitHub Releases.

### Configure signing

Create the Hub repository environment `desktop-signing`, restrict its deployment
branches to `master`, and require an owner review before credentials are used.
Add these environment secrets through GitHub Settings; never paste private keys
or passwords into a PR, source file or chat.

| Secret                                       | Required value                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `APPLE_CERTIFICATE`                          | Base64-encoded Developer ID Application `.p12`, including its private key      |
| `APPLE_CERTIFICATE_PASSWORD`                 | Nonempty `.p12` export password                                                |
| `APPLE_SIGNING_IDENTITY`                     | Full `Developer ID Application: ...` identity                                  |
| `APPLE_TEAM_ID`                              | Ten-character Apple developer team identifier                                  |
| `APPLE_API_ISSUER`                           | App Store Connect API issuer identifier                                        |
| `APPLE_API_KEY`                              | App Store Connect API key identifier                                           |
| `APPLE_API_PRIVATE_KEY`                      | Raw API `.p8` file contents for notarization                                   |
| `AZURE_CLIENT_ID`                            | App registration authorized to use the signing profile                         |
| `AZURE_CLIENT_SECRET`                        | That registration's client secret                                              |
| `AZURE_TENANT_ID`                            | Azure tenant identifier                                                        |
| `AZURE_SIGNING_ENDPOINT`                     | Regional endpoint, for example `https://eus.codesigning.azure.net`             |
| `AZURE_ARTIFACT_SIGNING_ACCOUNT`             | Artifact Signing account name                                                  |
| `AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE` | Public-trust certificate profile name                                          |
| `WINDOWS_SIGNER_SUBJECT`                     | Exact expected certificate subject, as returned by `Get-AuthenticodeSignature` |
| `DESKTOP_GPG_PRIVATE_KEY`                    | ASCII-armored private release-signing key                                      |
| `DESKTOP_GPG_PASSPHRASE`                     | Nonempty key passphrase                                                        |
| `DESKTOP_GPG_FINGERPRINT`                    | Full uppercase 40-hex primary-key fingerprint                                  |

Windows uses `artifact-signing-cli` 0.12.0 through Tauri's `signCommand` so the
embedded executable is signed before installer packaging. Configure an Azure
Artifact Signing public-trust account/profile and grant its signing role to the
registration. This workflow does not use exportable Windows PFX credentials.
Signing verifies publisher identity; it does not promise that a new publisher
already has SmartScreen reputation.

The macOS job creates a temporary keychain and API key file, signs/notarizes the
app and DMG, validates tickets, then deletes its signing files/keychain. Linux
signing uses an isolated temporary GPG home and checks the expected fingerprint.
Confirm the public fingerprint through an independent trusted channel before
verifying a release; an included public key alone does not establish identity.

Official setup references: [Apple signing and notarization](https://v2.tauri.app/distribute/sign/macos/),
[Windows Artifact Signing](https://v2.tauri.app/distribute/sign/windows/#azure-artifact-signing).

### Qualification and publication sequence

1. Complete PR review and merge the Hub candidate through the owner gate.
2. Deploy the hosted Hub's matching titlebar code and record its deployed source
   identity. The hosted `_app/version.json` value is not a Git SHA by default.
3. Configure the signing environment and credentials above.
4. Run **Desktop signed release draft** on `master` with a new stable version.
5. Download the draft installers. On each supported OS, qualify installation,
   provider sign-in, persistent sign-in after restart, window controls, native
   menus/tray, `minion://hub/...` routing, single-instance forwarding and file
   drops into the existing chooser. Record OS versions and installer hashes.
6. After owner approval, publish the reviewed draft in the Hub repository's
   Releases page. Its existing notes become the public install links.

Steps 2, 3 and 5 remain release gates. The workflow does not claim to establish
installed runtime behavior. No installers have been published by this change.
For local release-contract checks, run:

```bash
node --test scripts/desktop/*.test.mjs
```

The tests include actual GPG signing and verification with a temporary fixture
key, altered-file rejection, wrong-key rejection, complete-matrix checks and
unsigned-artifact rejection. They do not substitute for Apple/Windows signing.

Linux packages use `linux/main.desktop` so protocol launches pass their URI as
an argument (`%u`). The pinned AppImage bundler also uses this Debian template.
The Linux build job inspects the packaged DEB launcher before collecting assets.
AppImage users need desktop integration through their AppImage launcher for OS
protocol registration; running a portable image alone does not install it.
