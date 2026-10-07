# Overlay dialog contract fixture (HC-028)

Bundles the real `HostsOverlay`, `DeleteConfirmModal`, `RegistryAgentSheet`,
`SkillCreateWizard`, `ExportDialog`, `DeleteChapterModal` and `ConditionModal`
on top of the shared `Dialog` with synthetic props, English messages and the
vitest `$app`/`$env` stubs. No app server, authentication or writes.

From `minion_hub/`:

```sh
node tests/fixtures/overlay-dialog/build.mjs     # → /tmp/minion-overlay-dialog-fixture
node tests/fixtures/overlay-dialog/verify.mjs    # isolated headless Chromium (Playwright)
```

`verify.mjs` serves the build on a loopback port and, per overlay, asserts
`dialog:modal`, inert background (`focus()` no-op, 12×Tab/12×Shift+Tab never
reach a background control), body scroll lock, Escape pressed inside the
innermost control closes, focus returns to the trigger, scroll lock released,
and outside-click dismissal. Evidence: `hc028-native-proof.json` + one
screenshot per overlay in `MINION_OVERLAY_DIALOG_EVIDENCE`
(default `/tmp/minion-overlay-dialog-evidence`).

The happy-dom twin (`*.mounted.test.ts`) covers the same wiring plus the
pre-migration red run; happy-dom's `showModal()` is attribute-only, so
`:modal`/inert/Tab-trap are only provable here.
