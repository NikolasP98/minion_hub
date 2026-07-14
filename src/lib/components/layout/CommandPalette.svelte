<script lang="ts">
    import { tick } from 'svelte';
    import { createHotkey } from '$lib/hotkeys';
    import {
        palette,
        togglePalette,
        closePalette,
        getFilteredCommands,
        runRecordSearch,
    } from '$lib/state/ui/command-palette.svelte';
    import {
        Search,
        Home,
        User,
        Users,
        BookOpen,
        Store,
        Activity,
        MessagesSquare,
        Settings,
        Wrench,
        GitBranch,
        Plus,
        Bot,
        LayoutDashboard,
        Inbox,
        CheckCircle2,
        Target,
        FolderKanban,
        Wand2,
        Paintbrush,
        Bell,
        Cloud,
    } from 'lucide-svelte';
    import * as m from '$lib/paraglide/messages';

    let inputEl: HTMLInputElement | undefined = $state();

    // Flows/permission gating is handled inside getFilteredCommands (sourced
    // from the canonical route registry $lib/nav/routes).
    const groups = $derived(getFilteredCommands());

    // Flat list for keyboard nav
    const flatCommands = $derived(groups.flatMap((g) => g.commands));

    const iconMap: Record<string, typeof Home> = {
        home: Home,
        user: User,
        users: Users,
        'book-open': BookOpen,
        store: Store,
        activity: Activity,
        'messages-square': MessagesSquare,
        settings: Settings,
        wrench: Wrench,
        'git-branch': GitBranch,
        plus: Plus,
        bot: Bot,
        'layout-dashboard': LayoutDashboard,
        inbox: Inbox,
        check: CheckCircle2,
        target: Target,
        folder: FolderKanban,
        wand: Wand2,
        paintbrush: Paintbrush,
        bell: Bell,
        cloud: Cloud,
    };

    // Global: open/close the palette (fires anywhere, including inside inputs).
    createHotkey('Mod+K', () => togglePalette(), {
        meta: { name: m.shortcuts_commandPaletteName(), description: m.shortcuts_commandPaletteDesc() },
    });

    // View-scoped: list navigation, live only while the palette is open. The
    // search input is focused, so arrows/Enter set ignoreInputs:false to fire
    // there; stopPropagation:false preserves Escape reaching other overlays.
    createHotkey('Escape', () => closePalette(), () => ({
        enabled: palette.open,
        stopPropagation: false,
    }));
    createHotkey(
        'ArrowDown',
        () => {
            palette.selectedIndex = Math.min(palette.selectedIndex + 1, flatCommands.length - 1);
            scrollToSelected();
        },
        () => ({ enabled: palette.open, ignoreInputs: false }),
    );
    createHotkey(
        'ArrowUp',
        () => {
            palette.selectedIndex = Math.max(palette.selectedIndex - 1, 0);
            scrollToSelected();
        },
        () => ({ enabled: palette.open, ignoreInputs: false }),
    );
    createHotkey(
        'Enter',
        () => {
            const cmd = flatCommands[palette.selectedIndex];
            if (cmd) {
                cmd.action();
                closePalette();
            }
        },
        () => ({ enabled: palette.open, ignoreInputs: false }),
    );

    function scrollToSelected() {
        tick().then(() => {
            const el = document.querySelector(`[data-cmd-index="${palette.selectedIndex}"]`);
            el?.scrollIntoView({ block: 'nearest' });
        });
    }

    function handleBackdropClick(e: MouseEvent) {
        if ((e.target as HTMLElement).dataset.backdrop !== undefined) {
            closePalette();
        }
    }

    function selectCommand(idx: number) {
        const cmd = flatCommands[idx];
        if (cmd) {
            cmd.action();
            closePalette();
        }
    }

    // Reset selection + run debounced live record search on query change.
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    $effect(() => {
        const q = palette.query;
        palette.selectedIndex = 0;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => runRecordSearch(q), 150);
    });

    // Focus input when opened
    $effect(() => {
        if (palette.open) {
            tick().then(() => inputEl?.focus());
        }
    });
</script>

{#if palette.open}
    <!-- Backdrop -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh]"
        data-backdrop
        onclick={handleBackdropClick}
    >
        <!-- Palette container -->
        <div
            class="w-full max-w-lg bg-bg2 border border-border rounded-xl shadow-2xl overflow-hidden"
            style="animation: palette-in 150ms ease-out"
        >
            <!-- Search input -->
            <div class="flex items-center gap-3 px-4 py-3 border-b border-border">
                <Search size={16} class="text-muted shrink-0" />
                <input
                    bind:this={inputEl}
                    bind:value={palette.query}
                    type="text"
                    class="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
                    placeholder={m.command_searchPlaceholder()}
                    autocomplete="off"
                    spellcheck="false"
                />
                <kbd class="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-bg3 border border-border text-[10px] font-mono text-muted">
                    Esc
                </kbd>
            </div>

            <!-- Results -->
            <div
                class="max-h-72 overflow-y-auto py-2"
                role="listbox"
                aria-label={m.command_searchPlaceholder()}
            >
                {#if flatCommands.length === 0}
                    <div class="px-4 py-8 text-center text-sm text-muted">
                        {m.command_noResults()}
                    </div>
                {:else}
                    {@const flatIdx = { value: 0 }}
                    {#each groups as group}
                        <div class="px-3 pt-2 pb-1">
                            <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-strong">
                                {group.category}
                            </span>
                        </div>
                        {#each group.commands as cmd}
                            {@const currentIdx = flatIdx.value++}
                            {@const isSelected = palette.selectedIndex === currentIdx}
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div
                                class="mx-2 px-3 py-2 rounded-lg flex items-center gap-3 cursor-pointer transition-colors duration-75 {isSelected ? 'bg-accent/12 text-foreground' : 'text-muted hover:bg-bg3 hover:text-foreground'}"
                                data-cmd-index={currentIdx}
                                onmouseenter={() => { palette.selectedIndex = currentIdx; }}
                                onclick={() => selectCommand(currentIdx)}
                                role="option"
                                tabindex={-1}
                                aria-selected={isSelected}
                            >
                                {#if cmd.icon && cmd.icon.length <= 2}
                                    <!-- Emoji icon (from agent) -->
                                    <span class="text-sm w-5 text-center shrink-0">{cmd.icon}</span>
                                {:else if cmd.icon && iconMap[cmd.icon]}
                                    {@const Icon = iconMap[cmd.icon]}
                                    <Icon size={15} class="shrink-0 {isSelected ? 'text-accent' : ''}" />
                                {:else}
                                    <Bot size={15} class="shrink-0 {isSelected ? 'text-accent' : ''}" />
                                {/if}
                                <span class="text-sm flex-1 truncate">{cmd.label}</span>
                                {#if cmd.category === 'page'}
                                    <span class="text-[10px] text-muted-foreground font-mono shrink-0">{m.command_pageTag()}</span>
                                {/if}
                            </div>
                        {/each}
                    {/each}
                {/if}
            </div>

            <!-- Footer hint -->
            <div class="px-4 py-2 border-t border-border flex items-center gap-4 text-[10px] text-muted-foreground">
                <span class="flex items-center gap-1">
                    <kbd class="px-1 py-0.5 rounded bg-bg3 border border-border font-mono">&uarr;&darr;</kbd>
                    {m.command_hintNavigate()}
                </span>
                <span class="flex items-center gap-1">
                    <kbd class="px-1 py-0.5 rounded bg-bg3 border border-border font-mono">&crarr;</kbd>
                    {m.command_hintSelect()}
                </span>
                <span class="flex items-center gap-1">
                    <kbd class="px-1 py-0.5 rounded bg-bg3 border border-border font-mono">esc</kbd>
                    {m.command_hintClose()}
                </span>
            </div>
        </div>
    </div>
{/if}

<style>
    @keyframes palette-in {
        from {
            opacity: 0;
            transform: translateY(-8px) scale(0.98);
        }
        to {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }
</style>
