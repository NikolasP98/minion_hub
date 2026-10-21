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
