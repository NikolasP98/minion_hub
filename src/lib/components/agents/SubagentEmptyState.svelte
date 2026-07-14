<script lang="ts">
  import * as m from '$lib/paraglide/messages';
</script>

<div class="flex-1 flex flex-col items-center justify-center gap-3 text-muted text-[length:var(--font-size-body)] p-8">
  <span class="text-[length:var(--font-size-display)] opacity-30">&#x1f500;</span>
  <span class="font-medium">{m.subagent_noneSpawned()}</span>
  <p class="text-[length:var(--font-size-caption)] text-center max-w-xs opacity-60 leading-relaxed">
    {m.subagent_noneDesc()}
  </p>
</div>
