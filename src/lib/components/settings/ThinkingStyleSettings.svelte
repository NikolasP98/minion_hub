<script lang="ts">
  // Appearance → the assistant's "Thinking…" spinner material (spec 027).
  // Every option is a live preview of the real shader in the current accent.
  import { Button, iconSizes } from '$lib/components/ui';
  import ThinkingShader from '$lib/components/assistant/ThinkingShader.svelte';
  import { THINKING_STYLES, type ThinkingStyle } from '$lib/components/assistant/thinking-shader';
  import { thinkingStyle } from '$lib/state/ui/thinking-style.svelte';
  import * as m from '$lib/paraglide/messages';

  // Thunks, so the labels follow the active locale.
  const LABELS: Record<ThinkingStyle, { name: () => string; hint: () => string }> = {
    mercury: { name: m.settings_thinking_mercury, hint: m.settings_thinking_mercuryHint },
    cel: { name: m.settings_thinking_cel, hint: m.settings_thinking_celHint },
    neon: { name: m.settings_thinking_neon, hint: m.settings_thinking_neonHint },
    chrome: { name: m.settings_thinking_chrome, hint: m.settings_thinking_chromeHint },
    holo: { name: m.settings_thinking_holo, hint: m.settings_thinking_holoHint },
    dither: { name: m.settings_thinking_dither, hint: m.settings_thinking_ditherHint },
    crystal: { name: m.settings_thinking_crystal, hint: m.settings_thinking_crystalHint },
    velvet: { name: m.settings_thinking_velvet, hint: m.settings_thinking_velvetHint },
    softtouch: { name: m.settings_thinking_softtouch, hint: m.settings_thinking_softtouchHint },
  };
</script>

<section class="thinking-styles space-y-4">
  <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider">
    {m.settings_thinkingStyle()}
  </h2>
  <div class="grid" role="group" aria-label={m.settings_thinkingStyle()}>
    {#each THINKING_STYLES as id (id)}
      {@const active = thinkingStyle.current === id}
      <Button
        variant="secondary"
        type="button"
        class="ts-option {active ? 'is-active' : ''}"
        aria-pressed={active}
        onclick={() => thinkingStyle.set(id)}
      >
        <ThinkingShader style={id} size={iconSizes.lg * 2} />
        <span class="name">{LABELS[id].name()}</span>
        <span class="hint t-caption">{LABELS[id].hint()}</span>
      </Button>
    {/each}
  </div>
</section>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
    gap: var(--space-2);
  }
  .thinking-styles :global(.ts-option) {
    height: auto;
    padding: var(--space-3) var(--space-2);
    border: 1px solid var(--color-border);
  }
  /* Button slots children into an inner row span; stack it into a card. */
  .thinking-styles :global(.ts-option > span) {
    flex-direction: column;
    align-items: center;
    width: 100%;
    gap: var(--space-1);
  }
  /* Selection = accent-tinted surface + accent text (list-selection contract). */
  .thinking-styles :global(.ts-option.is-active) {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    border-color: var(--color-accent);
  }
  .thinking-styles :global(.ts-option.is-active .name) {
    color: var(--color-accent);
  }
  .name {
    font-size: var(--font-size-caption);
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .hint {
    color: var(--color-text-tertiary);
  }
</style>
