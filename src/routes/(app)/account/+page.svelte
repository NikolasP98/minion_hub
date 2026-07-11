<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$lib/paraglide/messages';
  import { userState } from '$lib/state/features/user.svelte';
  import ProfileCard from '$lib/components/users/ProfileCard.svelte';

  let { data }: { data: PageData } = $props();

  const u = $derived(userState.user);
</script>

<div class="h-full overflow-y-auto p-6 md:p-10">
  <div class="max-w-2xl mx-auto space-y-4">
    <h1 class="text-lg font-semibold text-foreground">{m.account_nav_profile()}</h1>

    <ProfileCard
      userId={data.userId}
      displayName={u?.displayName ?? null}
      email={u?.email ?? null}
      avatarUrl={u?.avatarUrl ?? null}
      role={userState.role}
      createdAt={u?.createdAt ?? null}
    />
  </div>
</div>
