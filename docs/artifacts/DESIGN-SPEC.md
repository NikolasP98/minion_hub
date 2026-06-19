# Artifact Design Spec

An **artifact** is a sandboxed visual surface owned by an agent, embedded in the
hub via an iframe + the plugin-ui bridge. Every artifact MUST follow this spec
so all agents' artifacts feel consistent.

## Runtime contract
- The artifact is a self-contained bundle served by the hub at
  `/artifacts/<id>/ui/<path>`. Entry: `index.html`.
- It speaks the `@nikolasp98/plugin-ui-bridge` postMessage protocol:
  1. On load, read the host origin from `location.hash` (`#hostOrigin=<encoded>`).
  2. `postMessage({ type: 'plugin:ready', protocolVersion: 1 }, hostOrigin)`.
  3. On `host:hello` → apply `tokens` (set each as a CSS custom property on
     `:root`) and toggle the `dark` class from `theme`.
  4. Fetch data via one RPC: `plugin:rpc-request` with
     `method: 'hub.artifact.context.get'`, no params. The host replies
     `host:rpc-response { id, ok, payload }`.
- The artifact MUST validate `event.origin === hostOrigin` on every inbound message.
- The artifact MUST NOT call any other RPC method and MUST NOT open network
  connections of its own in phase 1 (static kind).

## Visual contract
- **Theme:** colors/spacing/radius come ONLY from the delivered tokens
  (`--color-*`, `--radius`, etc., originating from `@minion-stack/design-tokens`).
  Never hardcode hex colors.
- **Layout:** a single column, max-width 100%, padding `1rem`. A header row
  (agent name + role) at top; sections below.
- **Sections (the four framings):** an artifact should answer, where it has data:
  *What I do* (purpose/description), *How I'm doing* (live status), *What I've
  done* (activity totals), *How I work* (trigger/cadence). Use `<section>` with
  an `<h2>` label per framing.
- **States:** render an explicit **loading** state until `host:hello` + context
  arrive, and an **error** state if the context RPC fails.
- **Sizing:** fill the host container width; the host owns height (fill mode).

## Out of scope (later)
Live (WS/WebRTC) artifacts, charts beyond simple token-styled stat cards, and
user-authored artifacts (the builder agent).
