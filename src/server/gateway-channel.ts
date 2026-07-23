/**
 * The caller's selected BUILD CHANNEL, ambient for the current request.
 *
 * Spec §D4 says a human picks the channel and the system picks the instance —
 * which only holds if the server knows which channel the human picked. The
 * browser's pick lives in sessionStorage (§D3), so it is invisible server-side;
 * the client mirrors it into a session cookie and this module carries it down
 * to `resolveCredentialsForUser` without threading a parameter through every
 * one of the dozens of `gatewayCallAsUser` call sites.
 *
 * `AsyncLocalStorage` (already used by `$server/db/pg-client`) is what makes
 * that safe under concurrent requests — a module-level variable would leak one
 * user's channel into another's request.
 *
 * The default is `'prd'` and there is no path that defaults to `'dev'`: an
 * absent, malformed, or unknown cookie reads as `'prd'`, and asking for a
 * channel the org has no row for fails closed in `listChannelCandidates`
 * rather than falling back to the other channel.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { GatewayChannel } from './services/gateway.pg.service';

/** Mirrors the client's `minion-dash-build-channel` sessionStorage key. Written
 *  by the browser (no Max-Age ⇒ dies with the browser session, matching the
 *  sessionStorage-only rule), read here. Not a security boundary: it selects
 *  among channels the org is already authorized for, and that authorization is
 *  re-checked server-side against `gateway.org_id`. */
export const BUILD_CHANNEL_COOKIE = 'minion-build-channel';

const store = new AsyncLocalStorage<GatewayChannel>();

/** The channel this request selected, or `'prd'`. Never `'dev'` by accident. */
export function currentBuildChannel(): GatewayChannel {
  return store.getStore() ?? 'prd';
}

export function runWithBuildChannel<T>(channel: GatewayChannel, fn: () => T): T {
  return store.run(channel, fn);
}
