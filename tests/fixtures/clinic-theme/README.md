# Clinic theme verification

This isolated preview compiles Hub's real appearance page, theme state/runtime,
shared Button/Card/Input/Badge components, Chart, and native Dialog. The only
theme behavior stubbed is server preference synchronization; the real local
storage path remains active. Navigation, page data, and public environment are
stubbed using the existing mobile-composition fixtures. All displayed data is
synthetic. This fixture makes no production API calls.

For selecting the presets and understanding the independent accent preference,
see [Clinic themes in the installed token package](../../../node_modules/@minion-stack/design-tokens/README.md#clinic-themes).

```bash
MINION_CLINIC_OUT=/tmp/minion-clinic-preview node tests/fixtures/clinic-theme/build.mjs
python3 -m http.server 18913 --bind 127.0.0.1 --directory /tmp/minion-clinic-preview
```

In another terminal, use the dedicated background browser:

```bash
BU_NAME=minion-clinic-theme BU_CDP_URL=http://127.0.0.1:9223 \
  browser-harness < tests/fixtures/clinic-theme/verify.py
```

The verifier exercises both theme modes, all contract properties enumerated in the generated `tokens.json`,
local preference persistence, native dialogs and keyboard focus, mobile layout,
and the actual appearance picker. Both picker cards are selected visibly at
1440px, checked for overflow, and verified after reload; the mobile picker is
also exercised at 390px. Desktop picker screenshots use the
`picker-light-desktop.png` and `picker-dark-desktop.png` names.
Screenshots and a JSON result are written to
the ignored `test-results/clinic-theme/` directory. Browser evidence covers the
compiled components, not authenticated routing, server persistence, or deployment.
