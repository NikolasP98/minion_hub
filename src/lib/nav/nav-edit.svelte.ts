import { can } from '$lib/state/features/permissions.svelte';
import { invalidate } from '$lib/navigation';
import { toastAsync } from '$lib/state/ui/toast.svelte';
import * as m from '$lib/paraglide/messages';
import {
  aliasableTargets,
  reservedSectionSlugs,
  validateNavConfig,
  type NavConfig,
  type NavConfigIssue,
} from './custom-sections';
import { navConfig, navOptimistic } from './nav-config.svelte';

/** In-memory, per tab: what "Copy" picked up. */
export const navClipboard = $state<{
  item: { target: string; label: string; icon?: string } | null;
}>({ item: null });

export const canEditNav = (): boolean => can('settings:manage');
export const canEditAccess = (): boolean => can('users:manage');

export const navValidationCtx = () => ({
  reserved: reservedSectionSlugs(),
  targets: new Set(aliasableTargets().map((t) => t.pattern)),
});

/** A save the server (or the client validator) refused; `issues` map back to dialog fields. */
export class NavSaveError extends Error {
  constructor(
    message: string,
    readonly issues: NavConfigIssue[],
    /** Already surfaced by saveNavConfig's toast (server refusal) — callers must not toast again. */
    readonly toasted = false,
  ) {
    super(message);
  }
}

/** Issues `next` adds on top of what `base` already reports (old rows never block a new edit). */
export function newIssues(base: NavConfig, next: NavConfig): NavConfigIssue[] {
  const ctx = navValidationCtx();
  const key = (i: NavConfigIssue) => `${i.code}|${i.path.join('.')}`;
  const had = new Set(validateNavConfig(base, ctx).map(key));
  return validateNavConfig(next, ctx).filter((i) => !had.has(key(i)));
}

async function fetchFull(): Promise<NavConfig> {
  const res = await fetch('/api/nav/config');
  if (!res.ok) throw new Error(m.common_error());
  return (await res.json()) as NavConfig;
}

/**
 * Apply `op` and save. The op runs on the member's view FIRST (optimistic: the sidebar
 * updates at once), then on the stored document (the member's view can omit entries their
 * own page rules deny — saving it would delete them). Failure rolls the view back.
 * Throws `NavSaveError` for validation problems so dialogs can show them inline.
 */
export async function saveNavConfig(op: (c: NavConfig) => NavConfig): Promise<void> {
  const view = navConfig();
  const guess = op(view);
  const issues = newIssues(view, guess);
  if (issues.length) throw new NavSaveError(issues[0].message, issues);
  navOptimistic.config = guess;
  try {
    await toastAsync(
      (async () => {
        const next = op(await fetchFull());
        const res = await fetch('/api/nav/config', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(next),
        });
        if (res.status === 400) {
          const body = (await res.json().catch(() => ({}))) as { issues?: NavConfigIssue[] };
          const list = body.issues ?? [];
          throw new NavSaveError(list[0]?.message ?? m.common_error(), list, true);
        }
        if (!res.ok) throw new Error(m.common_error());
        await Promise.all([invalidate('app:nav-config'), invalidate('app:permissions')]);
      })(),
      {
        loading: m.nav_saving(),
        getOutcome: () => ({ type: 'success', title: m.nav_saved() }),
        onError: (e) => ({ title: e instanceof Error ? e.message : m.common_error() }),
      },
    );
  } finally {
    navOptimistic.config = null;
  }
}
