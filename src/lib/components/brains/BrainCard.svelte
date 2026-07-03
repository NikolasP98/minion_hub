<script lang="ts">
  import { ArrowUpRight, Lock, Globe } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { diceBearAvatarUrl } from '$lib/utils/avatar';
  import type { BrainDTO } from '$lib/types/brains';

  let { brain }: { brain: BrainDTO } = $props();

  const detailHref = $derived(`/brains/${encodeURIComponent(brain.id)}`);
  const avatarUrl = $derived(diceBearAvatarUrl(brain.id, 'brain'));
</script>

<article
  class="group/card flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/20"
>
  <header class="flex items-start gap-3">
    <img src={avatarUrl} alt="" class="size-11 shrink-0 rounded-lg bg-white/5 ring-1 ring-white/10" loading="lazy" />
    <div class="min-w-0 flex-1">
      <a href={detailHref} class="group/name inline-flex max-w-full items-center gap-1 text-sm font-semibold text-white hover:underline">
        <span class="truncate">{brain.name}</span>
        <ArrowUpRight size={13} class="shrink-0 opacity-0 transition-opacity group-hover/name:opacity-100" />
      </a>
      <p class="mt-0.5 inline-flex items-center gap-1 text-[11px] text-white/45">
        {#if brain.visibility === 'private'}
          <Lock size={11} /> {m.brains_visibility_private()}
        {:else}
          <Globe size={11} /> {m.brains_visibility_org()}
        {/if}
      </p>
    </div>
    {#if brain.icon}
      <span class="shrink-0 text-lg leading-none">{brain.icon}</span>
    {/if}
  </header>

  {#if brain.description}
    <p class="line-clamp-2 text-xs leading-relaxed text-white/60">{brain.description}</p>
  {/if}
</article>
