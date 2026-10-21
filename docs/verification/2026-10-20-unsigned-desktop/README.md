# Unsigned desktop preview

The owner withdrew the signed-installer requirement on 2026-10-20 and explicitly
requested downloadable installers immediately. That instruction supersedes the
earlier signing gates in the app-backlog receipt. The first preview is published:
[desktop-v0.0.1](https://github.com/NikolasP98/minion_hub/releases/tag/desktop-v0.0.1).

## Published artifact evidence

- GitHub release ID: `419156659`; published at `2026-10-21T04:22:48Z`.
- Five unsigned installers: Linux x64 DEB/AppImage, Windows x64 NSIS EXE,
  macOS Apple Silicon/Intel DMGs. Two additional assets: `SHA256SUMS` and
  `desktop-manifest.json`.
- Build run: [39531728582](https://github.com/NikolasP98/minion_hub/actions/runs/39531728582),
  all native tests and packaging jobs passed. Build source:
  `d2a5d552f800e33c4209a478080a0bb6ac3e799e`.
- Approved release/tag commit: `26e82cfc90f8279875dfa64b89e9a50a6f1323fe`.
  Both commits have the exact full Git tree
  `5903f62d63b995702a757e5d1e05e44a1de74d8b`. Installer bytes were not modified.
- Every uploaded asset's GitHub SHA-256 digest matched its verified local bytes
  before publishing. The public, unauthenticated `SHA256SUMS` download matched
  the uploaded manifest after publication.
- The release notes explicitly identify unsigned/unnotarized builds, platform
  warnings and installed runtime qualification still pending.

## Release-policy changes

The release workflow and build scripts use `--no-sign` on every platform.
Apple/Azure/OpenPGP credentials and the `desktop-signing` environment are removed
from release preparation. The GPG signing script/test and signed-receipt gate
are removed. Source identity, digest, version, completeness and existing-release
checks remain. Operator dispatch can publish an explicitly labeled prerelease
or create a draft; publication is not triggered by ordinary pushes or PRs.

The changed release-contract tests fail under the previous signed-only gate,
then pass after unsigned assembly is enabled. They cover complete assets,
accurate release notes, modified files, wrong revisions and false signature
claims. Both workflow files pass actionlint, and shell scripts pass syntax checks.
Author Standards review checks PR/read-only versus manual master/release-write
boundaries and exact artifact provenance. Author Spec review checks the owner's
unsigned release decision, removal of credential requirements and public links.

## Remaining runtime qualification

Installed OS-webview sign-in, restart persistence, native window/menu/tray
behavior, deep-link registration and file drops remain unproven on all installed
platforms. The native source `TODO(handoff)` and minion-meta proposal
`2026-10-19-hub-tauri-native-shell` track that work. Those are preview limitations,
not signing requirements. Signing is not a current release gate.
