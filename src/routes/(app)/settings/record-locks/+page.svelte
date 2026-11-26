<script lang="ts">
  import type { PageData } from './$types';
  import { Lock } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { iconSizes, PageHeader } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import LockPolicySection from '$lib/components/settings/record-locks/LockPolicySection.svelte';
  import ExternalLocksSection from '$lib/components/settings/record-locks/ExternalLocksSection.svelte';
  import LockAuditSection from '$lib/components/settings/record-locks/LockAuditSection.svelte';

  let { data }: { data: PageData } = $props();
</script>

<!-- TODO(handoff): (spec 140 S2) the a11y page sweep (`bun run a11y`) was not run for this new page; the ledger treats a
     missing page as zero violations, so CI may report axe findings (color-contrast on muted text is the likely one). -->
<svelte:head><title>{m.record_locks_title()} — {m.nav_settings()}</title></svelte:head>

<PageShell archetype="form" scroll="page" labelledBy="settings-record-locks-title">
  <PageHeader
    documentTitle={false}
    titleId="settings-record-locks-title"
    title={m.record_locks_title()}
    subtitle={m.record_locks_subtitle()}
  >
    {#snippet leading()}<Lock size={iconSizes.md} class="shrink-0 text-accent" />{/snippet}
  </PageHeader>
  <PageBody width="content">
    <LockPolicySection policy={data.policy} isOwner={data.isOwner} />
    <ExternalLocksSection
      locks={data.externalLocks}
      isOwner={data.isOwner}
      hasLocksKey={data.hasLocksKey}
    />
    <LockAuditSection events={data.events} pageSize={data.eventsLimit} />
  </PageBody>
</PageShell>
