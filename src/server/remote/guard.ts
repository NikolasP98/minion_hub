/**
 * Auth helpers for SvelteKit remote functions (`*.remote.ts`).
 *
 * Remote function handlers run on the server but receive no `locals` argument —
 * they pull the active request via `getRequestEvent()` from `$app/server`. These
 * thin wrappers reuse the same authorize helpers the `+server.ts` routes use, so
 * remote functions enforce identical auth (401/403) semantics.
 *
 * Server-only (lives under `$server`); only ever imported inside remote handler
 * bodies, which the SvelteKit compiler strips from the client bundle.
 */
import { getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { requireAuth, requireAdmin, requireTenantCtx } from '$server/auth/authorize';
import { getTenantCtx, getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import type { TenantContext } from '$server/services/base';

type AuthUser = NonNullable<App.Locals['user']>;

/** The current authenticated user, or throw 401. */
export function currentUser(): AuthUser {
  return requireAuth(getRequestEvent().locals);
}

/** The current authenticated admin, or throw 401/403. */
export function currentAdmin(): AuthUser {
  return requireAdmin(getRequestEvent().locals);
}

/** The current tenant context (db + tenantId), or throw 401. */
export function currentCtx(): TenantContext {
  return requireTenantCtx(getRequestEvent().locals);
}

/**
 * Tenant context with first-organization fallback (no auto-create); throws 401
 * if no organization exists. Mirrors the `getTenantCtx` pattern used by routes
 * like marketplace/install.
 */
export async function currentTenantCtx(): Promise<TenantContext> {
  const ctx = await getTenantCtx(getRequestEvent().locals);
  if (!ctx) error(401, 'No tenant configured');
  return ctx;
}

/**
 * Tenant context, auto-provisioning a default org if none exists. Mirrors the
 * `getOrCreateTenantCtx` fallback the builder/* and similar routes use for
 * local-dev ergonomics.
 */
export function currentOrCreateCtx(): Promise<TenantContext> {
  return getOrCreateTenantCtx(getRequestEvent().locals);
}

/** Raw request locals — for the rare case a handler needs more than the above. */
export function currentLocals(): App.Locals {
  return getRequestEvent().locals;
}
