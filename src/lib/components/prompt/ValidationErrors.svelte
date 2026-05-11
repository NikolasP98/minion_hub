<script lang="ts">
  import type { SectionViolation } from "@minion-stack/shared";

  let {
    errors,
  }: {
    errors: SectionViolation[];
  } = $props();

  function severityClass(severity: "block" | "warn") {
    if (severity === "block") {
      return "border-red-500/60 bg-red-500/10 text-red-300";
    }
    return "border-amber-500/60 bg-amber-500/10 text-amber-300";
  }

  function severityLabel(severity: "block" | "warn") {
    return severity === "block" ? "Block" : "Warn";
  }
</script>

{#if errors.length > 0}
  <div class="flex flex-col gap-2 p-3">
    {#each errors as v, i (i)}
      <div class="border rounded px-3 py-2 text-xs {severityClass(v.severity)}">
        <div class="flex items-center gap-2 mb-1">
          <span
            class="inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-semibold {severityClass(
              v.severity,
            )}"
          >
            {severityLabel(v.severity)}
          </span>
          <span class="font-mono font-semibold">{v.rule}</span>
        </div>
        {#if v.match}
          <div class="font-mono opacity-80">{v.match}</div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
