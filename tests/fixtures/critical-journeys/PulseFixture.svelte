<script lang="ts">
  import { onMount, type ComponentProps } from 'svelte';
  import Shell from '../mobile-composition/Shell.svelte';
  import PulsePage from '../../../src/routes/(app)/pulse/+page.svelte';
  import NotificationsPage from '../../../src/routes/(app)/notifications/+page.svelte';
  import NotificationsPopup from '$lib/components/layout/NotificationsPopup.svelte';
  import { Button } from '$lib/components/ui';
  import { provideActions } from '$lib/services/actions/context';
  import { createActionRuntime } from '$lib/services/actions/runtime.svelte';
  import { setLanguageTag } from '$lib/paraglide/runtime';
  import { pulse } from '$lib/state/features/pulse.svelte';
  import { proposal, bindProjection, bindScopeSwitch, bindClientState } from './pulse-transport';
  const query = new URLSearchParams(location.search);
  const surface = query.get('surface') ?? 'notifications';
  setLanguageTag(query.get('lang') === 'es' ? 'es' : 'en');
  const actions = provideActions(createActionRuntime());
  bindScopeSwitch(() => actions.setScope('pulse-other:other-org:view-denied'));
  bindClientState(() => ({
    pendingCount: pulse.pendingCount,
    itemCount: pulse.items.length,
    receiptState: pulse.receipt(proposal().id)?.dispatch?.state ?? null,
    error: pulse.error,
    busy: pulse.busy,
  }));
  let popup = $state(true);
  let revision = $state(1);
  let pending = $state(!query.has('other-owner'));
  const notificationsData = $derived({
    requests: [],
    inboxItems: [],
    pulseProposals: pending ? [proposal(revision)] : [],
  } as unknown as ComponentProps<typeof NotificationsPage>['data']);
  const pulseData = $derived({ proposals: pending ? [proposal(revision)] : [], recent: [] });
  bindProjection(() => {
    const current = proposal();
    revision = current.revision;
    pending = current.status === 'pending';
  });
  onMount(() => {
    void pulse.refresh();
    return () => actions.dispose();
  });
</script>

<Shell>
  {#if surface === 'page'}<PulsePage data={pulseData} />
  {:else if surface === 'popup'}
    <NotificationsPopup bind:open={popup}
      >{#snippet trigger()}<Button onclick={() => (popup = true)}>Notifications fixture</Button
        >{/snippet}</NotificationsPopup
    >
  {:else}<NotificationsPage data={notificationsData} />{/if}
</Shell>
