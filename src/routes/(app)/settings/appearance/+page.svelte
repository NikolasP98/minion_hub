<script lang="ts">
  import { Button } from '$lib/components/ui';
    import { theme } from "$lib/state/ui/theme.svelte";
    import type { ThemePreset } from "$lib/themes/presets";
    import { logoState } from "$lib/state/ui/logo.svelte";
    import { locale } from "$lib/state/ui/locale.svelte";
    import PatternSettings from "$lib/components/settings/PatternSettings.svelte";
    import SparklineStyleSettings from "$lib/components/settings/SparklineStyleSettings.svelte";
    import MinionLogo from "$lib/components/layout/MinionLogo.svelte";
    import CRTConfigModal from "$lib/components/settings/CRTConfigModal.svelte";
    import { Check, Globe } from "lucide-svelte";
    import * as m from "$lib/paraglide/messages";

    let crtModalOpen = $state(false);

    // Split the picker into Dark / Light families (mode defaults to 'dark').
    const darkPresets = $derived(theme.presets.filter((p) => p.mode !== "light"));
    const lightPresets = $derived(theme.presets.filter((p) => p.mode === "light"));
</script>

<div class="flex-1 overflow-y-auto p-6 md:p-10">
    <div class="max-w-2xl mx-auto space-y-4">
        <!-- Language (segmented) -->
        <div class="bg-card border border-border rounded-lg px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
            <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider">
                <span class="flex items-center gap-2">
                    <Globe size={13} class="text-muted-strong" />
                    {m.settings_language()}
                </span>
            </h2>
            <div class="inline-flex p-0.5 gap-0.5 rounded-lg border border-border bg-bg">
                {#each locale.available as tag (tag)}
                    <Button
                        variant={locale.current === tag ? 'primary' : 'ghost'}
                        size="sm"
                        type="button"
                        aria-pressed={locale.current === tag}
                        onclick={() => locale.set(tag)}
                    >
                        {tag === "en" ? "English" : tag === "es" ? "Español" : tag}
                    </Button>
                {/each}
            </div>
        </div>

        <!-- Logo Presets -->
        <div class="bg-card border border-border rounded-lg px-5 py-4">
            <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">
                {m.settings_siteIdentity()}
            </h2>
            <div class="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                {#each logoState.presets as logoPreset (logoPreset.id)}
                    <Button
                        variant={logoState.presetId === logoPreset.id ? 'outline' : 'secondary'}
                        type="button"
                        aria-pressed={logoState.presetId === logoPreset.id}
                        class="group relative !h-auto flex-col gap-2 !p-2.5"
                        onclick={() => logoState.setPreset(logoPreset.id)}
                        title={logoPreset.description}
                    >
                        {#if logoState.presetId === logoPreset.id}
                            <div class="absolute top-1 right-1 flex items-center justify-center w-4 h-4 rounded-full bg-accent text-accent-foreground shadow-sm">
                                <Check size={9} strokeWidth={3} />
                            </div>
                        {/if}
                        <div class="flex justify-center transition-transform group-hover:scale-105">
                            <MinionLogo size="md" preset={logoPreset.id} />
                        </div>
                        <span class="text-xs font-medium text-card-foreground truncate max-w-full">{logoPreset.name}</span>
                    </Button>
                {/each}
            </div>
            <p class="text-xs text-muted-foreground mt-3">
                {m.settings_logoDescription()}
            </p>
        </div>

        <!-- Theme Presets -->
        <div class="bg-card border border-border rounded-lg px-5 py-4">
            <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">
                {m.settings_theme()}
            </h2>
            {#snippet themeCard(preset: ThemePreset)}
                {@const active = theme.presetId === preset.id}
                <Button
                    variant={active ? 'outline' : 'secondary'}
                    type="button"
                    title={preset.name}
                    aria-pressed={active}
                    class="group !h-auto flex-col gap-2 !p-2 text-left"
                    onclick={() => theme.setPreset(preset.id)}
                >
                    <!-- Live mini-preview: the actual palette composed like a UI —
                         accent rail, two faux text lines, an accent button. -->
                    <div
                        class="relative flex h-11 rounded-md overflow-hidden border transition-transform group-hover:scale-[1.015]"
                        style="background:{preset.colors.bg}; border-color:{preset.colors.border}"
                    >
                        <div class="w-1 shrink-0" style="background:{preset.colors.accent}"></div>
                        <div class="flex-1 flex flex-col justify-center gap-1.5 px-2">
                            <div class="h-1 w-[70%] rounded-full" style="background:{preset.colors.foreground}; opacity:.85"></div>
                            <div class="h-1 w-[45%] rounded-full" style="background:{preset.colors.mutedForeground}"></div>
                            <div class="h-2 w-5 rounded-sm mt-0.5" style="background:{preset.colors.accent}"></div>
                        </div>
                        {#if active}
                            <div class="absolute top-1 right-1 flex items-center justify-center w-4 h-4 rounded-full bg-accent text-accent-foreground shadow-sm">
                                <Check size={9} strokeWidth={3} />
                            </div>
                        {/if}
                    </div>
                    <div class="flex items-center gap-1.5 min-w-0 px-0.5">
                        <span class="text-xs font-medium text-card-foreground truncate">{preset.name}</span>
                        {#if preset.style}
                            <span
                                class="shrink-0 text-xs font-bold leading-none text-muted-foreground border border-border rounded px-1 py-0.5"
                                title={m.settings_customTypography()}
                            >Aa</span>
                        {/if}
                    </div>
                </Button>
                {#if preset.id === 'crt' && active}
                    <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onclick={() => crtModalOpen = true}
                        class="-mt-1 w-full gap-1.5 text-xs uppercase tracking-widest"
                        style="border-radius: 0; border-color: color-mix(in srgb, var(--crt-base) 30%, transparent); color: var(--crt-base); background: color-mix(in srgb, var(--crt-base) 6%, transparent); font-family: 'Courier New', monospace;"
                    >
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="8" cy="8" r="2.5"/>
                            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/>
                        </svg>
                        {m.settings_configure()}
                    </Button>
                {/if}
            {/snippet}

            <div class="space-y-4">
                <div>
                    <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{m.settings_themeDark()}</h3>
                    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                        {#each darkPresets as preset (preset.id)}
                            {@render themeCard(preset)}
                        {/each}
                    </div>
                </div>
                <div>
                    <h3 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{m.settings_themeLight()}</h3>
                    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                        {#each lightPresets as preset (preset.id)}
                            {@render themeCard(preset)}
                        {/each}
                    </div>
                </div>
            </div>
        </div>

        <!-- Accent Color -->
        <div class="bg-card border border-border rounded-lg px-5 py-4">
            <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">
                {m.settings_accentColor()}
            </h2>
            <div class="flex flex-wrap gap-2.5">
                {#each theme.accents as acc (acc.id)}
                    <Button
                        variant="outline"
                        size="icon"
                        type="button"
                        aria-pressed={theme.accentId === acc.id}
                        aria-label={acc.label}
                        class="{theme.accentId === acc.id
                            ? 'ring-2 ring-offset-2 ring-offset-card scale-105'
                            : 'hover:scale-105 hover:-translate-y-0.5'}"
                        style="background:{acc.value}; --tw-ring-color:{acc.value};"
                        title={acc.label}
                        onclick={() => theme.setAccent(acc.id)}
                    >
                        {#if theme.accentId === acc.id}
                            <Check size={15} strokeWidth={3} class="text-primary-foreground drop-shadow-sm" />
                        {/if}
                        <span class="sr-only">{acc.label}</span>
                    </Button>
                {/each}
            </div>
        </div>

        <!-- Background Pattern -->
        <div class="bg-card border border-border rounded-lg px-5 py-4">
            <PatternSettings />
        </div>

        <!-- Sparkline Style -->
        <div class="bg-card border border-border rounded-lg px-5 py-4">
            <SparklineStyleSettings />
        </div>
    </div>
</div>

<CRTConfigModal bind:open={crtModalOpen} />
