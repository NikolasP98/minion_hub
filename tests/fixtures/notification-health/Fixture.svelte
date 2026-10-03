<script lang="ts">
  import { onDestroy, untrack, type ComponentProps } from 'svelte';
  import { Button } from '$lib/components/ui';
  import type {
    NotificationHealthSeed,
    NotificationHealthState,
    NotificationWorkerHealth,
  } from '$lib/notifications/worker-health';
  import Page from '../../../src/routes/(app)/settings/notifications/+page.svelte';

  type PageData = ComponentProps<typeof Page>['data'];
  type FixtureState = Extract<
    NotificationHealthState,
    'absent' | 'projection_unavailable' | 'runnable'
  >;
  type NextRead = 'success' | 'fail' | 'delay';

  const originalFetch = globalThis.fetch;
  let workspace = $state<'a' | 'b'>('a');
  let fixtureState = $state<FixtureState>('projection_unavailable');
  let nextRead = $state<NextRead>('success');
  let requests = $state(0);
  let delayedPending = $state(false);
  let resolveDelayed: (() => void) | null = null;

  function actorId(value = workspace): string {
    return `synthetic-actor-${value}`;
  }

  function orgId(value = workspace): string {
    return `synthetic-org-${value}`;
  }

  function health(
    state: FixtureState,
    owner: 'a' | 'b',
    pendingOverride?: number,
  ): NotificationWorkerHealth {
    const pending =
      pendingOverride ?? (state === 'projection_unavailable' ? 5000 : owner === 'a' ? 7 : 3);
    const qualified = state === 'runnable';
    return {
      checkedAt: owner === 'a' ? '2026-10-03T12:00:00.000Z' : '2026-10-03T12:05:00.000Z',
      state,
      worker: {
        heartbeat: qualified
          ? { ageMs: 1_500, futureTimestamp: false }
          : { ageMs: null, futureTimestamp: false },
        identity: qualified
          ? {
              buildSha: 'a'.repeat(40),
              catalogRevision: '2026-10-03.v1',
              catalogSha256: 'b'.repeat(64),
              projectorRevision: 'projector.v1',
              projectorSha256: 'c'.repeat(64),
            }
          : null,
        admission:
          state === 'projection_unavailable'
            ? {
                checked: { ageMs: 4_000, futureTimestamp: false },
                code: 'projection_unavailable',
                buildSha: 'd'.repeat(40),
                artifactSha256: 'e'.repeat(64),
                catalogRevision: '2026-10-03.v1',
                catalogSha256: 'b'.repeat(64),
                projectorRevision: null,
                projectorSha256: null,
              }
            : null,
      },
      organization: {
        lastCompleted: { ageMs: 45_000, futureTimestamp: false },
        lastSuccess: { ageMs: 60_000, futureTimestamp: false },
        failureStreak: 0,
        lastFailureCode: null,
        lastResult: 'completed',
      },
      queue: {
        pending: {
          count: pending,
          lowerBound: pending === 5000,
          oldest: { ageMs: 3_600_000, futureTimestamp: false },
        },
        processing: {
          count: qualified ? 2 : 0,
          lowerBound: false,
          oldest: qualified
            ? { ageMs: 25_000, futureTimestamp: false }
            : { ageMs: null, futureTimestamp: false },
        },
        unsupportedCatalogPending: state === 'projection_unavailable',
      },
    };
  }

  function makeData(owner: 'a' | 'b', seed: NotificationHealthSeed): PageData {
    return {
      env: { backend: 'prd', local: false },
      user: {
        id: actorId(owner),
        supabaseId: actorId(owner),
        email: `${owner}@fixture.invalid`,
        displayName: `Fixture ${owner.toUpperCase()}`,
        role: 'user',
      },
      permissions: { permissions: [], roles: [] },
      workspaces: [],
      organizations: [
        {
          id: orgId(owner),
          name: `Fixture workspace ${owner.toUpperCase()}`,
          slug: `fixture-${owner}`,
          kind: 'business',
          role: 'owner',
        },
      ],
      activeOrgId: orgId(owner),
      activeOrgKind: 'business',
      personalAgent: { agent: null },
      hosts: {
        servers: [],
        authoritative: true,
        orgAssignedHostId: null,
        channels: [],
        defaultChannel: null,
      },
      preferences: { preferences: {} },
      brainAgentIds: [],
      tableConfig: {},
      healthSeed: seed,
      tables: [{ table: 'support_issues', dateFields: [] }],
      rules: [
        {
          id: 'synthetic-enabled-rule',
          orgId: orgId(owner),
          name: 'Urgent request notice',
          enabled: true,
          triggerTable: 'support_issues',
          triggerEvent: 'insert',
          dateField: null,
          dateOffsetMins: null,
          channel: 'email',
          accountId: null,
          condition: [],
          recipients: [],
          template: 'A request needs review.',
          lastRunAt: new Date('2026-10-03T11:55:00.000Z'),
          createdAt: new Date('2026-10-03T11:00:00.000Z'),
          updatedAt: new Date('2026-10-03T11:30:00.000Z'),
        },
      ],
    };
  }

  let data = $state(
    makeData('a', {
      actorId: actorId('a'),
      orgId: orgId('a'),
      status: 'ready',
      value: health('projection_unavailable', 'a'),
    }),
  );

  function response(value: NotificationWorkerHealth): Response {
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  globalThis.fetch = async (input) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname !== '/api/notifications/health') {
      throw new Error('This fixture permits only the notification health read transport.');
    }
    const captured = untrack(() => {
      requests += 1;
      const read = nextRead;
      nextRead = 'success';
      const owner = workspace;
      const state = fixtureState;
      return { read, owner, state };
    });
    if (captured.read === 'fail') {
      return new Response('{"code":"notification_health_unavailable"}', { status: 503 });
    }
    if (captured.read === 'delay') {
      return new Promise<Response>((resolve) => {
        untrack(() => {
          delayedPending = true;
          resolveDelayed = () => {
            delayedPending = false;
            resolveDelayed = null;
            resolve(response(health('runnable', captured.owner, 99)));
          };
        });
      });
    }
    return response(health(captured.state, captured.owner));
  };

  function showState(state: FixtureState): void {
    fixtureState = state;
    const owner = workspace;
    data = makeData(owner, {
      actorId: actorId(owner),
      orgId: orgId(owner),
      status: 'ready',
      value: health(state, owner),
    });
  }

  function switchWorkspace(): void {
    workspace = workspace === 'a' ? 'b' : 'a';
    const owner = workspace;
    data = makeData(owner, {
      actorId: actorId(owner),
      orgId: orgId(owner),
      status: 'unavailable',
    });
  }

  function resolveOldRead(): void {
    resolveDelayed?.();
  }

  onDestroy(() => {
    globalThis.fetch = originalFetch;
    resolveDelayed?.();
  });
</script>

<main>
  <header>
    <p class="eyebrow">Actual settings page evidence · synthetic PageData and transport</p>
    <p class="fixture-title">Notification worker health evidence</p>
    <p>
      Production settings page, controller, health panel, localization and shared primitives. This
      isolated fixture has no authenticated session, database read, notification worker or provider
      effect.
    </p>
    <div class="controls" aria-label="Fixture health states">
      <Button
        variant={fixtureState === 'absent' ? 'primary' : 'secondary'}
        onclick={() => showState('absent')}>Show absent</Button
      >
      <Button
        variant={fixtureState === 'projection_unavailable' ? 'primary' : 'secondary'}
        onclick={() => showState('projection_unavailable')}>Show projection unavailable</Button
      >
      <Button
        variant={fixtureState === 'runnable' ? 'primary' : 'secondary'}
        onclick={() => showState('runnable')}>Show runnable</Button
      >
    </div>
    <div class="controls" aria-label="Fixture transport and owner controls">
      <Button variant="outline" onclick={() => (nextRead = 'fail')}>Fail next read</Button>
      <Button variant="outline" onclick={() => (nextRead = 'delay')}>Delay next read</Button>
      <Button variant="outline" onclick={switchWorkspace}>Switch workspace</Button>
      <Button variant="outline" disabled={!delayedPending} onclick={resolveOldRead}
        >Resolve delayed old read</Button
      >
    </div>
    <p class="fixture-status" aria-live="polite">
      Workspace {workspace.toUpperCase()} · {requests} reads · next {nextRead} ·
      {delayedPending ? 'old read pending' : 'no delayed read'}
    </p>
  </header>

  <section aria-label="Actual notification settings page">
    <Page {data} />
  </section>
</main>

<style>
  main {
    min-height: 100dvh;
    max-width: var(--page-max);
    margin-inline: auto;
    padding: var(--space-4);
    color: var(--color-text-primary);
  }
  header {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .fixture-title {
    margin: var(--space-0);
    color: var(--color-text-primary);
    font-size: var(--font-size-heading);
    font-weight: var(--font-weight-semibold);
  }
  p,
  .fixture-status {
    color: var(--color-text-secondary);
  }
  .eyebrow {
    color: var(--color-accent);
    font-size: var(--font-size-caption);
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  section {
    min-width: 0;
  }
  @media (max-width: 767.98px), (pointer: coarse) {
    .controls :global(button) {
      min-height: var(--control-height-touch);
    }
  }
</style>
