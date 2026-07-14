<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$lib/paraglide/messages';
  import UsernameCard from '$lib/components/users/UsernameCard.svelte';
  import PasswordCard from '$lib/components/users/PasswordCard.svelte';
  import { PageHeader } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';

  let { data }: { data: PageData } = $props();
</script>

<PageShell archetype="form" scroll="page" labelledBy="account-security-title">
  <PageHeader
    titleId="account-security-title"
    title={m.account_nav_security()}
    subtitle={m.account_nav_header()}
  />
  <PageBody width="reading">
    <div class="account-card-stack">
      <UsernameCard username={data.username} />
      <PasswordCard hasPassword={data.hasPassword} />
    </div>
  </PageBody>
</PageShell>

<style>
  .account-card-stack {
    display: grid;
    gap: var(--space-4, 16px);
  }
</style>
