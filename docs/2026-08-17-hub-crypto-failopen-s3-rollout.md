# Hub rollout record — crypto fail-open fix (S3)

Spec: `2026-08-17-pkg-dev-crypto-failopen-spec` (minion-meta, approved, pass 2).
This repo owns **S3 — "Consumers land it before they bump"**. S1 + S2 live in
minion-meta's `packages/db`.

## What landed here

| Change                                                                                           | File                                          | Spec clause                          |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------ |
| Boot-time key policy: `cryptoKeyMode()` / `assertCryptoKeyConfigured()`                          | `src/server/auth/crypto-key.ts`               | S3 step 3                            |
| Re-export on the path callers already import                                                     | `src/server/auth/crypto.ts`                   | S3 step 3                            |
| One server-side call at boot, skipped while `building`                                           | `src/hooks.server.ts`                         | S3 step 3                            |
| `ENCRYPTION_KEY` documented as required; `MINION_ALLOW_DEV_CRYPTO_KEY` documented local-dev-only | `.env.example`                                | S3 steps 1–2                         |
| CI runs on an explicit throwaway key, not the opt-in                                             | `.github/workflows/ci.yml`                    | S3 step 2                            |
| Tests never fall through to the dev key                                                          | `src/server/test-utils/setup.ts`              | S1 precedent (`pg/crypto.test.ts:5`) |
| Env matrix (both DoD paths) + anti-recurrence guards                                             | `src/server/auth/crypto-key{,.guard}.test.ts` | S1 DoD, S2 guard                     |

Zero `.svelte` files, zero schema files, zero DDL — per spec §3/§5.

## Red-state evidence

The fail-open, reproduced against the **currently vendored** `@minion-stack/db`
(`deps/minion-stack-db-0.9.4-ui-coherence-7942d0d8.tgz`):

```
$ env -u ENCRYPTION_KEY -u MINION_ALLOW_DEV_CRYPTO_KEY node --input-type=module \
    -e "import {sealSecret,openSecret} from '@minion-stack/db/crypto'; \
        const s=sealSecret('hunter2'); console.log(s.ciphertext.slice(0,16), openSecret(s.ciphertext,s.iv))"
96c74ed4e1948aae hunter2
```

No key configured, no opt-in, no warning — sealed and reopened under the
source-visible key. After this change the hub refuses to boot in that state:

```
$ env -u ENCRYPTION_KEY -u MINION_ALLOW_DEV_CRYPTO_KEY  -> REFUSES: ENCRYPTION_KEY is not set. Refusing to seal or open secrets…
$ env -u ENCRYPTION_KEY MINION_ALLOW_DEV_CRYPTO_KEY=1   -> boots, mode dev-fallback, one console.warn
$ env -u ENCRYPTION_KEY MINION_ALLOW_DEV_CRYPTO_KEY=false-> REFUSES (strict allowlist, not truthiness)
$ env -u ENCRYPTION_KEY MINION_ALLOW_DEV_CRYPTO_KEY=1 NODE_ENV=production
                                                        -> REFUSES: ENCRYPTION_KEY environment variable must be set in production
$ ENCRYPTION_KEY=realkey                                -> boots, mode configured, silent
```

The anti-recurrence guards were proved to fail: appending
`scryptSync('minion-hub-dev-key','minion-hub-salt',32)` plus a second
`assertCryptoKeyConfigured()` call to `src/server/auth/crypto.ts` reds all three
file-level guards (`never hardcodes…`, `never derives…`, `calls … exactly once`);
reverted.

Those guards scan **shipped** (non-test) TypeScript only, and skip the function's
own declaration when counting call sites. Test files legitimately name the dev-key
literal — `crypto-key.test.ts` asserts the refusal message never echoes it — and a
test seals nothing at rest. So the exclusions cannot rot into no-ops, each matcher
is unit-tested on synthetic snippets and the scan set is asserted to still contain
`hooks.server.ts`, `crypto.ts` and `crypto-key.ts`.

### Boot proof against the built server

`bun run desktop:build` (adapter-node), then `node build/index.js` with `.env`'s
crypto lines removed — the spec's own DoD form:

| Environment                              | Result                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| neither var set                          | **does not boot** — `Error: ENCRYPTION_KEY is not set. Refusing to seal or open secrets with the built-in, source-visible…` |
| `ENCRYPTION_KEY=$(openssl rand -hex 32)` | boots; **zero** `[crypto]` warnings                                                                                         |
| `MINION_ALLOW_DEV_CRYPTO_KEY=1`, no key  | boots; **exactly one** `[crypto] ENCRYPTION_KEY is not set…` line                                                           |

`bun run build` (Vercel adapter) succeeds with neither var set — the assertion is
skipped while `building`, so a runtime-configuration check cannot fail packaging.

## What did NOT land, and why — read before deploying

### 1. The dependency bump is deliberately NOT in this change

S3 step 4 bumps `@minion-stack/db`. It is held because:

- **The fail-closed package is not published.** S1+S2 are merged to minion-meta
  `dev` (PR #97, 2026-08-20) but npm's latest `@minion-stack/db@0.10.0` still
  ships the fail-open `key()`. Verified by unpacking 0.10.0.
- This repo consumes the package as a **vendored tarball**
  (`file:deps/minion-stack-db-0.9.4-ui-coherence-7942d0d8.tgz`). Hand-building a
  tarball from mixed sources would put an unreproducible artifact in the lockfile
  of a security fix — and meta `dev`'s `packages/db` has since drifted in
  `pg/schema/{agent-memories,channels,messages}` and `schema/personal-agents`,
  which this spec's "zero schema files" rule excludes.
- S3 states plainly that the bump PR "must not be opened until the environment
  work below is done and verified". That work (§2 below) needs credentials this
  workspace does not have.

**Consequence, stated honestly:** the boot assertion narrows the hole but does
not close it. Any seal/open that does _not_ go through the SvelteKit server boot
path — `bun scripts/*.ts`, cron entrypoints, migrations — still reaches the
package's fail-open `key()`. Full closure requires the bump.
`TODO(handoff)` recorded in `src/server/auth/crypto-key.ts`.

### 2. ⚠️ A1 — the environment inventory is NOT verified

S3 step 1 wants every environment classified before secrets change. This
workspace has **no Vercel access** (`vercel whoami` → logged out), so:

| Environment                                    | `ENCRYPTION_KEY` set?                             | Basis                                                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel **production**                          | Almost certainly yes — **inferred, not verified** | Prod seals the gateway signing JWK and OAuth identity secrets today; `NODE_ENV=production` there means the _existing_ guard would already throw if it were missing, so those features could not work.                                                                      |
| Vercel **preview**                             | **Unknown**                                       | Not checkable from here. If previews run `NODE_ENV=production` they are already on the throwing path; if the key is missing there, the boot assertion turns today's crypto-path 500s into a failed boot.                                                                   |
| CI (GitHub Actions)                            | Yes, as of this change                            | Set explicitly in `.github/workflows/ci.yml`.                                                                                                                                                                                                                              |
| Local dev / `cp .env.example .env`             | No key; opt-in on                                 | `.env.example` ships `MINION_ALLOW_DEV_CRYPTO_KEY=1`, sanctioned by S3 step 2 for a local example file. Inert in production: the opt-in is refused under `NODE_ENV=production` before it is read, which also covers `vercel-build`'s copy of it into `.env` at build time. |
| Self-hosted / Docker / Tauri (`desktop:serve`) | **Unknown**                                       | No manifest in this repo sets it.                                                                                                                                                                                                                                          |

**Owed by a credential holder before the bump:** confirm `ENCRYPTION_KEY` in both
Vercel scopes for hub _and_ minion_site, using the **same value per shared-DB
group** — the two apps share a database and cannot read each other's rows under
different keys (S3 step 1).

### 3. ⚠️ A3 — the at-rest audit was NOT run

S2's audit (how many rows are already sealed under the dev key) needs database
credentials this workspace does not have. It is **not zero, it is unknown.**
Columns to count when it is run: `servers.token`/`token_iv`,
`gateway_signing_keys.private_ciphertext`/`private_iv`,
`user_identities.secret_ciphertext`/`secret_iv`, and anything else matching the
`*_iv` companion-column convention.

If that audit finds dev-key ciphertext in a database the hub reads, S3 step 5
applies: do **not** set a real `ENCRYPTION_KEY` there and do not deploy the
bumped consumer; the only compatible temporary mode is `ENCRYPTION_KEY` unset
plus `MINION_ALLOW_DEV_CRYPTO_KEY=1`. Key rotation is out of scope (§5) and needs
its own proposal.

## Remaining checklist (hand-off)

1. [ ] Publish minion-meta `@minion-stack/db` with S1+S2 (merge `dev` → main).
2. [ ] Verify `ENCRYPTION_KEY` in Vercel preview + production for hub and site.
3. [ ] Run the A3 at-rest audit; record counts.
4. [ ] Bump the vendored `@minion-stack/db` here + lockfile; replace the policy in
       `src/server/auth/crypto-key.ts` with a re-export of the package's own
       `cryptoKeyMode` / `assertCryptoKeyConfigured`.
5. [ ] Same for `minion_site`.
6. [ ] Deploy a preview first and grep its logs for `[crypto] ENCRYPTION_KEY is not
 set` — a hit means that environment is still on the dev key.
