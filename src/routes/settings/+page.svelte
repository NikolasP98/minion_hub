<script lang="ts">
    import { theme } from "$lib/state/theme.svelte";
    import { logoState } from "$lib/state/logo.svelte";
    import PatternSettings from "$lib/components/settings/PatternSettings.svelte";
    import MinionLogo from "$lib/components/MinionLogo.svelte";
    import { Check } from "lucide-svelte";
    import * as m from "$lib/paraglide/messages";
</script>

<div
    class="relative z-10 flex flex-col h-screen overflow-hidden text-foreground"
>
    <!-- Header -->
    <header
        class="shrink-0 bg-bg/95 backdrop-blur-sm border-b border-border px-4.5 py-2.5 flex items-center"
    >
        <a
            href="/"
            class="text-xs text-muted no-underline px-3 py-1 rounded-full border border-border transition-all duration-150 hover:bg-bg3 hover:text-foreground"
        >
            {m.settings_back()}
        </a>
        <span
            class="ml-auto mr-auto font-bold text-sm text-foreground tracking-wide uppercase"
            >{m.settings_title()}</span
        >
        <!-- Right spacer to keep title centered -->
        <div class="invisible text-xs px-3 py-1">{m.settings_back()}</div>
    </header>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-6 md:p-10">
        <div class="max-w-2xl mx-auto space-y-10">
            <!-- Logo Presets -->
            <section>
                <h2
                    class="text-sm font-semibold text-foreground uppercase tracking-wider mb-4"
                >
                    {m.settings_siteIdentity()}
                </h2>
                <div
                    class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3"
                >
                    {#each logoState.presets as logoPreset (logoPreset.id)}
                        <button
                            type="button"
                            class="group relative bg-card border rounded-xl p-4 cursor-pointer transition-all text-center
                {logoState.presetId === logoPreset.id
                                ? 'border-accent ring-1 ring-accent/30'
                                : 'border-border hover:border-muted-foreground'}"
                            onclick={() => logoState.setPreset(logoPreset.id)}
                            title={logoPreset.description}
                        >
                            <!-- Active Badge - Top Right -->
                            {#if logoState.presetId === logoPreset.id}
                                <div
                                    class="absolute -top-2 -right-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground shadow-sm"
                                >
                                    <Check size={10} strokeWidth={3} />
                                    <span class="text-[9px] font-semibold"
                                        >{m.settings_active()}</span
                                    >
                                </div>
                            {/if}

                            <div class="flex justify-center mb-3">
                                <MinionLogo size="md" preset={logoPreset.id} />
                            </div>
                            <span
                                class="text-xs font-medium text-card-foreground block"
                                >{logoPreset.name}</span
                            >
                        </button>
                    {/each}
                </div>
                <p class="text-xs text-muted-foreground mt-3">
                    {m.settings_logoDescription()}
                </p>
            </section>

            <!-- Theme Presets -->
            <section>
                <h2
                    class="text-sm font-semibold text-foreground uppercase tracking-wider mb-4"
                >
                    {m.settings_theme()}
                </h2>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {#each theme.presets as preset (preset.id)}
                        <button
                            type="button"
                            class="group relative bg-card border rounded-lg p-4 cursor-pointer transition-all text-left
                {theme.presetId === preset.id
                                ? 'border-accent ring-1 ring-accent/30'
                                : 'border-border hover:border-muted-foreground'}"
                            onclick={() => theme.setPreset(preset.id)}
                        >
                            <!-- Active Badge - Top Right -->
                            {#if theme.presetId === preset.id}
                                <div
                                    class="absolute -top-2 -right-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground shadow-sm"
                                >
                                    <Check size={10} strokeWidth={3} />
                                    <span class="text-[9px] font-semibold"
                                        >{m.settings_active()}</span
                                    >
                                </div>
                            {/if}

                            <span
                                class="text-sm font-medium text-card-foreground"
                                >{preset.name}</span
                            >
                            {#if preset.style}
                                <span
                                    class="text-[10px] text-muted-foreground block mt-0.5"
                                    >{m.settings_customTypography()}</span
                                >
                            {/if}
                            <div class="flex gap-1.5 mt-3">
                                <div
                                    class="w-6 h-6 rounded"
                                    style="background:{preset.colors
                                        .bg}; border:1px solid {preset.colors
                                        .border}"
                                ></div>
                                <div
                                    class="w-6 h-6 rounded"
                                    style="background:{preset.colors
                                        .bg2}; border:1px solid {preset.colors
                                        .border}"
                                ></div>
                                <div
                                    class="w-6 h-6 rounded"
                                    style="background:{preset.colors
                                        .bg3}; border:1px solid {preset.colors
                                        .border}"
                                ></div>
                                <div
                                    class="w-6 h-6 rounded"
                                    style="background:{preset.colors
                                        .border}; border:1px solid {preset
                                        .colors.bg3}"
                                ></div>
                                <div
                                    class="w-6 h-6 rounded"
                                    style="background:{preset.colors.accent}"
                                ></div>
                            </div>
                        </button>
                    {/each}
                </div>
            </section>

            <!-- Accent Color -->
            <section>
                <h2
                    class="text-sm font-semibold text-foreground uppercase tracking-wider mb-4"
                >
                    {m.settings_accentColor()}
                </h2>
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
                            {#if theme.accentId === acc.id}
                                <div
                                    class="w-full h-full flex items-center justify-center"
                                >
                                    <Check
                                        size={14}
                                        strokeWidth={3}
                                        class="text-white drop-shadow-sm"
                                    />
                                </div>
                            {/if}
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
