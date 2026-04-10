<script lang="ts">
  import * as m from '$lib/paraglide/messages';
</script>

<div class="flex-1 flex flex-col items-center justify-center gap-3 text-muted text-[13px] p-8">
  <span class="text-[32px] opacity-30">&#x1f500;</span>
  <span class="font-medium">{m.subagent_noneSpawned()}</span>
  <p class="text-[11px] text-center max-w-xs opacity-60 leading-relaxed">
    {m.subagent_noneDesc()}
  </p>
</div>
