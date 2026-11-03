# Clinic theme verification

This isolated preview compiles Hub's real appearance page, theme state/runtime,
shared Button/Card/Input/Badge components, Chart, and native Dialog. The only
theme behavior stubbed is server preference synchronization; the real local
storage path remains active. Navigation is stubbed. All displayed data is
synthetic. This fixture makes no production API calls.

```bash
MINION_CLINIC_OUT=/tmp/minion-clinic-preview node tests/fixtures/clinic-theme/build.mjs
python3 -m http.server 18913 --bind 127.0.0.1 --directory /tmp/minion-clinic-preview
```

In another terminal, use the dedicated background browser:

```bash
BU_NAME=minion-clinic-theme BU_CDP_URL=http://127.0.0.1:9223 \
  browser-harness < tests/fixtures/clinic-theme/verify.py
```

The verifier exercises both theme modes, all 169 resolved contract properties,
local preference persistence, native dialogs and keyboard focus, mobile layout,
and the actual appearance picker. Screenshots and a JSON result are written to
the ignored `test-results/clinic-theme/` directory. Browser evidence covers the
compiled components, not authenticated routing, server persistence, or deployment.
