<script lang="ts">
    import { theme } from "$lib/state/ui/theme.svelte";
    import { logoState } from "$lib/state/ui/logo.svelte";
    import { locale } from "$lib/state/ui/locale.svelte";
    import PatternSettings from "$lib/components/settings/PatternSettings.svelte";
    import SparklineStyleSettings from "$lib/components/settings/SparklineStyleSettings.svelte";
    import MinionLogo from "$lib/components/layout/MinionLogo.svelte";
    import CRTConfigModal from "$lib/components/settings/CRTConfigModal.svelte";
    import { Check, Globe } from "lucide-svelte";
    import * as m from "$lib/paraglide/messages";

    let crtModalOpen = $state(false);
</script>

<div class="flex-1 overflow-y-auto p-6 md:p-10">
    <div class="max-w-2xl mx-auto space-y-4">
        <!-- Logo Presets -->
        <div class="bg-card border border-border rounded-lg px-5 py-4">
            <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">
                {m.settings_siteIdentity()}
            </h2>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {#each logoState.presets as logoPreset (logoPreset.id)}
                    <button
                        type="button"
                        class="group relative bg-bg border rounded-xl p-4 cursor-pointer transition-all text-center
                            {logoState.presetId === logoPreset.id
                            ? 'border-accent ring-1 ring-accent/30'
                            : 'border-border hover:border-muted-foreground'}"
                        onclick={() => logoState.setPreset(logoPreset.id)}
                        title={logoPreset.description}
                    >
                        {#if logoState.presetId === logoPreset.id}
                            <div class="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground shadow-sm">
                                <Check size={10} strokeWidth={3} />
                                <span class="text-[9px] font-semibold">{m.settings_active()}</span>
                            </div>
                        {/if}
                        <div class="flex justify-center mb-3">
                            <MinionLogo size="md" preset={logoPreset.id} />
                        </div>
                        <span class="text-xs font-medium text-card-foreground block">{logoPreset.name}</span>
                    </button>
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
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {#each theme.presets as preset (preset.id)}
                    <button
                        type="button"
                        class="group relative bg-bg border rounded-lg p-4 cursor-pointer transition-all text-left overflow-hidden
                            {theme.presetId === preset.id
                            ? 'border-accent ring-1 ring-accent/30'
                            : 'border-border hover:border-muted-foreground'}"
                        onclick={() => theme.setPreset(preset.id)}
                    >
                        <div
                            class="absolute left-0 top-0 bottom-0 w-1 rounded-l"
                            style="background:{preset.colors.accent}"
                        ></div>
                        <div class="pl-2">
                            <span class="text-sm font-medium text-card-foreground">{preset.name}</span>
                            {#if preset.style}
                                <span class="text-[10px] text-muted-foreground block mt-0.5">{m.settings_customTypography()}</span>
                            {/if}
                            <div class="flex gap-2 mt-3">
                                <div
                                    class="w-8 h-8 rounded"
                                    style="background:{preset.colors.bg}; border:1px solid {preset.colors.border}"
                                    title="Background"
                                ></div>
                                <div
                                    class="w-8 h-8 rounded"
                                    style="background:{preset.colors.bg2}; border:1px solid {preset.colors.border}"
                                    title="Card"
                                ></div>
                                <div
                                    class="w-8 h-8 rounded"
                                    style="background:{preset.colors.accent}"
                                    title="Accent"
                                ></div>
                            </div>
                            {#if theme.presetId === preset.id}
                                <div class="flex items-center gap-0.5 mt-2 w-fit px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground shadow-sm">
                                    <Check size={10} strokeWidth={3} />
                                    <span class="text-[9px] font-semibold">{m.settings_active()}</span>
                                </div>
                            {/if}
                        </div>
                    </button>
                    {#if preset.id === 'crt' && theme.presetId === 'crt'}
                        <button
                            type="button"
                            onclick={() => crtModalOpen = true}
                            class="mt-1 w-full flex items-center justify-center gap-1.5 py-1 text-[10px] font-medium uppercase tracking-widest border transition-all"
                            style="border-radius: 0; border-color: rgba(200,120,32,0.3); color: var(--crt-base, #c87820); background: rgba(200,120,32,0.06); font-family: 'Courier New', monospace;"
                        >
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                                <circle cx="8" cy="8" r="2.5"/>
                                <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/>
                            </svg>
                            {m.settings_configure()}
                        </button>
                    {/if}
                {/each}
            </div>
        </div>

        <!-- Accent Color -->
        <div class="bg-card border border-border rounded-lg px-5 py-4">
            <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">
                {m.settings_accentColor()}
            </h2>
            <div class="grid grid-cols-5 gap-y-3 gap-x-4 w-fit">
                {#each theme.accents as acc (acc.id)}
                    <div class="flex flex-col items-center gap-1">
                        <button
                            type="button"
                            class="rounded-full transition-all duration-150 cursor-pointer shrink-0 flex items-center justify-center
                                {theme.accentId === acc.id
                                ? 'ring-2 ring-offset-2 ring-offset-bg scale-110'
                                : 'hover:scale-105'}"
                            style="width:28px; height:28px; background:{acc.value}; --tw-ring-color:{acc.value};"
                            title={acc.label}
                            onclick={() => theme.setAccent(acc.id)}
                        >
                            {#if theme.accentId === acc.id}
                                <Check size={14} strokeWidth={3} class="text-white drop-shadow-sm" />
                            {/if}
                            <span class="sr-only">{acc.label}</span>
                        </button>
                        <span class="text-[9px] text-muted-foreground leading-none">{acc.label}</span>
                    </div>
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

        <!-- Language -->
        <div class="bg-card border border-border rounded-lg px-5 py-4">
            <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">
                <span class="flex items-center gap-2">
                    <Globe size={13} class="text-muted-strong" />
                    {m.settings_language()}
                </span>
            </h2>
            <select
                class="bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm cursor-pointer transition-colors hover:border-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                value={locale.current}
                onchange={(e) => locale.set(e.currentTarget.value as Parameters<typeof locale.set>[0])}
            >
                {#each locale.available as tag (tag)}
                    <option value={tag}>
                        {tag === "en" ? "English" : tag === "es" ? "Espanol" : tag}
                    </option>
                {/each}
            </select>
        </div>
    </div>
</div>

<CRTConfigModal bind:open={crtModalOpen} />
