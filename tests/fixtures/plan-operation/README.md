# HC-035 durable plan recovery fixture

This credential-free fixture mounts the actual production `PlanOpenForm` in three durable states:
an unknown create, an acknowledged plan awaiting continuation, and a sell continuation that requires
explicit cart replacement. It writes bounded synthetic records only to its isolated loopback origin.

Build into a fresh private directory:

```bash
node tests/fixtures/plan-operation/build.mjs
```

Serve the printed output on an owned loopback port. In `#restore-state`, choose **Check account** to
expose **Restore pending sale**, then choose that action to inspect the shared confirmation dialog.
Do not confirm the final fixture dialog: its callback deliberately remains blocked because the
standalone fixture has no authenticated account or catalog projection.

`fixture-manifest.json` records the fixture version, build time, repository HEAD, Node version and
SHA-256 identities of the fixture inputs, mounted production sources and copied fonts. The fixture
proves actual component layout, accessible actions, locked drafts and explicit replacement
confirmation. It does not prove authenticated routes, PostgreSQL state or production network
behavior.
