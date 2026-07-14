<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$lib/paraglide/messages';
  import { userState } from '$lib/state/features/user.svelte';
  import ProfileCard from '$lib/components/users/ProfileCard.svelte';
  import { PageHeader } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';

  let { data }: { data: PageData } = $props();

  const u = $derived(userState.user);
</script>

<PageShell archetype="form" scroll="page" labelledBy="account-profile-title">
  <PageHeader
    titleId="account-profile-title"
    title={m.account_nav_profile()}
    subtitle={m.account_nav_header()}
  />
  <PageBody width="reading">
    <ProfileCard
      userId={data.userId}
      displayName={u?.displayName ?? null}
      email={u?.email ?? null}
      avatarUrl={u?.avatarUrl ?? null}
      role={userState.role}
      createdAt={u?.createdAt ?? null}
    />
  </PageBody>
</PageShell>
