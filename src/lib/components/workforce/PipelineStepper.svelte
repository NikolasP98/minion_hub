<script lang="ts">
  // Extracted verbatim from workforce/issues/[id]/+page.svelte so the pipeline
  // builder's live preview renders the SAME stepper as the issue page.
  export type StepState = 'done' | 'current' | 'pending';
  export type StepperStep = { key: string; label: string; who: string; state: StepState };

  let { steps }: { steps: StepperStep[] } = $props();
</script>

<ol class="flex flex-wrap items-center gap-1">
  {#each steps as step, i (step.key)}
    {#if i > 0}<li aria-hidden="true" class="text-muted-foreground/50 px-1">→</li>{/if}
    <li
      class="flex items-center gap-2 rounded-full border px-3 py-1 text-xs
				{step.state === 'done'
        ? 'border-success/40 bg-success/10 text-success'
        : step.state === 'current'
          ? 'border-info/50 bg-info/10 text-info font-medium'
          : 'border-border text-muted-foreground'}"
    >
      <span>{step.label}</span>
      {#if step.who}<span class="opacity-75">· {step.who}</span>{/if}
      {#if step.state === 'done'}<span aria-label="done">✓</span>{/if}
      {#if step.state === 'current'}<span
          class="inline-block size-1.5 rounded-full bg-info animate-pulse"
          aria-label="current step"
        ></span>{/if}
    </li>
  {/each}
</ol>
