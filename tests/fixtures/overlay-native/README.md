# Native overlay qualification fixture

This bundles the real SecretEditModal, ImageLightbox and Dialog with synthetic callbacks and short English labels. It has no app authentication, server routes, credentials or business mutations. Production bundling avoids duplicate raw/optimized Svelte dev runtimes.

From `minion_hub/`:

```sh
node tests/fixtures/overlay-native/build.mjs
python -m http.server 5294 --bind 127.0.0.1 --directory /tmp/minion-overlay-native-fixture
```

Keep that local server foreground/tracked. In a separate tool invocation, after acquiring exclusive browser ownership under the browser-harness instructions:

```sh
BU_NAME=minion-overlay-qualification BU_CDP_URL=http://127.0.0.1:9223 browser-harness <<'PY'
exec(open('tests/fixtures/overlay-native/verify.py').read())
PY
```

Outputs: `/tmp/minion-overlay-evidence/results.json` and four screenshots. Environment overrides: `MINION_OVERLAY_FIXTURE_OUT` for build output, `MINION_OVERLAY_FIXTURE_URL` for the served fixture, `MINION_OVERLAY_EVIDENCE` for evidence output. Keep port and URL consistent; stop only this owned fixture server after checks.

The real native-browser checks cover initial focus, inert background traversal, rapid reopening, saving/duplicate/dismissal gates, failed-save retry, successful result, focus return and mobile image bounds. They do not certify all routes, translations, browser engines or assistive technology. The fixture label adapter intentionally isolates locale loading; localization content is checked separately by tooltip tests and future route qualification.
