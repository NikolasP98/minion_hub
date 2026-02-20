<script lang="ts">
  import { theme } from '$lib/state/theme.svelte';
  import PatternSettings from '$lib/components/settings/PatternSettings.svelte';
</script>

<div class="flex flex-col h-screen overflow-hidden bg-bg text-foreground">
  <!-- Header -->
  <header class="shrink-0 bg-bg/95 backdrop-blur-sm border-b border-border px-4.5 py-2.5 flex items-center">
    <a
      href="/"
      class="text-xs text-muted no-underline px-3 py-1 rounded-full border border-border transition-all duration-150 hover:bg-bg3 hover:text-foreground"
    >
      &larr; Back to Dashboard
    </a>
    <span class="ml-auto mr-auto font-bold text-sm text-foreground tracking-wide uppercase">Settings</span>
    <!-- Right spacer to keep title centered -->
    <div class="invisible text-xs px-3 py-1">&larr; Back to Dashboard</div>
  </header>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto p-6 md:p-10">
    <div class="max-w-2xl mx-auto space-y-10">

      <!-- Theme Presets -->
      <section>
        <h2 class="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">Theme</h2>
        <div class="grid grid-cols-3 gap-4">
          {#each theme.presets as preset (preset.id)}
            <button
              type="button"
              class="bg-card border rounded-lg p-4 cursor-pointer transition-all text-left
                {theme.presetId === preset.id
                  ? 'border-accent ring-1 ring-accent/30'
                  : 'border-border hover:border-muted-foreground'}"
              onclick={() => theme.setPreset(preset.id)}
            >
              <span class="text-sm font-medium text-card-foreground">{preset.name}</span>
              {#if preset.style}
                <span class="text-[10px] text-muted-foreground block mt-0.5">Custom typography</span>
              {/if}
              <div class="flex gap-1.5 mt-3">
                <div class="w-6 h-6 rounded" style="background:{preset.colors.bg}; border:1px solid {preset.colors.border}"></div>
                <div class="w-6 h-6 rounded" style="background:{preset.colors.bg2}; border:1px solid {preset.colors.border}"></div>
                <div class="w-6 h-6 rounded" style="background:{preset.colors.bg3}; border:1px solid {preset.colors.border}"></div>
                <div class="w-6 h-6 rounded" style="background:{preset.colors.border}; border:1px solid {preset.colors.bg3}"></div>
                <div class="w-6 h-6 rounded" style="background:{preset.colors.accent}"></div>
              </div>
              {#if theme.presetId === preset.id}
                <div class="mt-3 text-accent text-xs font-medium flex items-center gap-1">
                  <svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                  </svg>
                  Active
                </div>
              {/if}
            </button>
          {/each}
        </div>
      </section>

      <!-- Accent Color -->
      <section>
        <h2 class="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">Accent Color</h2>
        <div class="flex flex-wrap gap-3">
          {#each theme.accents as acc (acc.id)}
            <button
              type="button"
              class="rounded-full transition-all duration-150 cursor-pointer shrink-0
                {theme.accentId === acc.id
                  ? 'ring-2 ring-offset-2 ring-offset-bg scale-110'
                  : 'hover:scale-105'}"
              style="width:28px; height:28px; background:{acc.value}; --tw-ring-color:{acc.value};"
              title={acc.label}
              onclick={() => theme.setAccent(acc.id)}
            >
              <span class="sr-only">{acc.label}</span>
            </button>
          {/each}
        </div>
      </section>

      <!-- Background Pattern -->
      <PatternSettings />

    </div>
  </div>
</div>
