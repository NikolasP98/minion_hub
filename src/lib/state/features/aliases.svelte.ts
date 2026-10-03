import { browser } from '$app/environment';
import { page } from '$app/state';
import { onDestroy, untrack } from 'svelte';
import * as Sentry from '@sentry/sveltekit';
import { createMentionDirectory } from './mention-directory-resource';
import { directoryOwner, EMPTY_DIRECTORY } from './mention-directory-wire';

let revision = $state(0);
let invalidation = $state(0);
let consumers = 0;
let directory: ReturnType<typeof createMentionDirectory> | null = null;
// Preserve only timing across last-consumer teardown; never retain an identity,
// directory, request or listener. Remounting must not evade failure throttles.
const failureWindow = { retryAt: 0, lastReported: -Infinity };

function owner() {
  return directoryOwner(page.data.user?.supabaseId, page.data.activeOrgId);
}

function refresh() {
  if (consumers > 0) void directory?.ensure(owner());
}

/** Install during component initialization. Shared resources exist only in the browser. */
export function useAliasDirectory(): void {
  if (!browser) return;
  if (!directory) {
    directory = createMentionDirectory({
      failureWindow,
      fetch: (signal) => fetch('/api/users/aliases', { signal, cache: 'no-store' }),
      currentOwner: owner,
      changed: () => {
        revision++;
      },
      report: (reason) => {
        Sentry.captureException(new Error('Mention directory unavailable'), {
          tags: { area: 'mention-directory', reason },
          fingerprint: ['mention-directory', reason],
        });
      },
    });
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
  }
  const retained = directory;
  consumers++;
  $effect(() => {
    const captured = owner();
    void invalidation;
    // Observe identity and explicit mutation invalidation, never read-result state.
    untrack(() => {
      void retained.ensure(captured);
    });
  });
  onDestroy(() => {
    consumers--;
    if (consumers === 0) {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      retained.dispose();
      directory = null;
    }
  });
}

export function getAliases(): ReadonlyMap<string, string> {
  if (!browser) return EMPTY_DIRECTORY;
  void revision;
  return directory?.read(owner()) ?? EMPTY_DIRECTORY;
}

/** Confirmed mutation invalidation wakes mounted readers; it never creates a background cache. */
export function invalidateAliases(): void {
  if (!browser) return;
  failureWindow.retryAt = 0;
  directory?.invalidate();
  invalidation++;
}
