<script lang="ts">
  import type { PageData } from './$types';
  import { userState } from '$lib/state/features/user.svelte';
  import ProfileCard from '$lib/components/users/ProfileCard.svelte';
  import ConnectedIdentities from '$lib/components/users/ConnectedIdentities.svelte';
  import ChannelLinking from '$lib/components/users/ChannelLinking.svelte';

  let { data }: { data: PageData } = $props();

  const u = $derived(userState.user);
</script>

<div class="p-6 md:p-10">
  <div class="max-w-2xl mx-auto space-y-6">
    <h1 class="text-lg font-semibold text-foreground">Account</h1>

    <ProfileCard
      displayName={u?.displayName ?? null}
      email={u?.email ?? null}
      avatarUrl={u?.avatarUrl ?? null}
      role={userState.role}
      createdAt={u?.createdAt ?? null}
    />

    <ConnectedIdentities userId={data.userId} identities={data.identities} />

    <ChannelLinking userId={data.userId} identities={data.identities} />
  </div>
</div>
