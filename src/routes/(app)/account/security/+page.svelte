<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$lib/paraglide/messages';
  import UsernameCard from '$lib/components/users/UsernameCard.svelte';
  import PasswordCard from '$lib/components/users/PasswordCard.svelte';

  let { data }: { data: PageData } = $props();
</script>

<div class="h-full overflow-y-auto p-6 md:p-10">
  <div class="max-w-2xl mx-auto space-y-4">
    <h1 class="text-lg font-semibold text-foreground">{m.account_nav_security()}</h1>

    <UsernameCard username={data.username} />

    <PasswordCard hasPassword={data.hasPassword} />
  </div>
</div>
