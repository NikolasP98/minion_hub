<script lang="ts">
    // `?` cheat-sheet — lists every live hotkey/sequence registration that
    // opted in with `meta` (see $lib/hotkeys), plus a static section for the
    // element-scoped DataTable grid keys (T1), which never carry `meta`
    // because they only exist while a table is mounted/focused.
    import { createHotkey, getHotkeyRegistrations, formatForDisplay } from '$lib/hotkeys';
    import * as m from '$lib/paraglide/messages';

    let open = $state(false);

    // `?` is physically Shift+Slash on a US layout — there's no dedicated `?`
    // key type in the lib (punctuation keys exclude Shift combos to dodge
    // layout drift), so this uses the RawHotkey escape hatch instead of a
    // string literal. `ignoreInputs` defaults to true for Shift-only combos,
    // so typing a literal "?" in a text field never opens this.
    createHotkey({ key: '/', shift: true }, () => { open = !open; }, {
        meta: { name: m.shortcuts_openHotkeyName(), description: m.shortcuts_openHotkeyDesc() },
    });

    createHotkey('Escape', () => { open = false; }, () => ({
        enabled: open,
        stopPropagation: false,
    }));

    const registrations = getHotkeyRegistrations();

    type Row = { id: string; name: string; description?: string; combo: string };

    // Live registrations (global hotkeys + g-nav sequences) that opted into the
    // cheat-sheet via `meta`. Attachments (element-scoped, e.g. DataTable) share
    // the same manager but never carry meta by design — they're listed
    // statically below instead.
    const liveRows = $derived.by<Row[]>(() => {
        const hotkeyRows = registrations.hotkeys
            .filter((r) => r.options.meta?.name)
            .map((r) => ({
                id: r.id,
                name: r.options.meta!.name!,
                description: r.options.meta?.description,
                combo: formatForDisplay(r.hotkey),
            }));
        const sequenceRows = registrations.sequences
            .filter((r) => r.options.meta?.name)
            .map((r) => ({
                id: r.id,
                name: r.options.meta!.name!,
                description: r.options.meta?.description,
                combo: r.sequence.map((step) => formatForDisplay(step)).join(' '),
            }));
        return [...hotkeyRows, ...sequenceRows];
    });

    // Static grid-key section (T1's DataTable attachment) — never in the live
    // registry since it's element-scoped. "Click"/"Shift+Click" aren't real
    // Hotkey strings so those two rows are hand-written; the rest reuse
    // formatForDisplay for a platform-correct kbd chip.
    const gridRows: Row[] = [
        { id: 'grid-click', name: m.shortcuts_gridCtrlClick(), description: undefined, combo: 'Ctrl/Cmd+Click' },
        { id: 'grid-shift-click', name: m.shortcuts_gridShiftClick(), description: undefined, combo: 'Shift+Click' },
        { id: 'grid-select-all', name: m.shortcuts_gridSelectAll(), description: undefined, combo: formatForDisplay('Mod+A') },
        {
            id: 'grid-delete',
            name: m.shortcuts_gridDelete(),
            description: undefined,
            combo: `${formatForDisplay('Delete')} / ${formatForDisplay('Backspace')}`,
        },
        { id: 'grid-search', name: m.shortcuts_gridSearch(), description: undefined, combo: formatForDisplay('/') },
        {
            id: 'grid-navigate',
            name: m.shortcuts_gridNavigate(),
            description: undefined,
            combo: `${formatForDisplay('ArrowDown')}/${formatForDisplay('ArrowUp')}, J/K`,
        },
        { id: 'grid-open', name: m.shortcuts_gridOpen(), description: undefined, combo: formatForDisplay('Enter') },
        { id: 'grid-toggle', name: m.shortcuts_gridToggleFocused(), description: undefined, combo: formatForDisplay('Space') },
        { id: 'grid-clear', name: m.shortcuts_gridClear(), description: undefined, combo: formatForDisplay('Escape') },
    ];

    function handleBackdropClick(e: MouseEvent) {
        if ((e.target as HTMLElement).dataset.backdrop !== undefined) {
            open = false;
        }
    }
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-[var(--layer-command,70)] bg-[color-mix(in_srgb,var(--color-canvas,var(--color-bg))_60%,transparent)] backdrop-blur-sm flex items-start justify-center pt-[10dvh] px-[var(--space-page-gutter,16px)]"
        data-backdrop
        onclick={handleBackdropClick}
    >
        <div
            class="w-full max-w-lg max-h-[calc(80dvh-env(safe-area-inset-bottom,0px))] flex flex-col bg-bg2 border border-border rounded-xl shadow-[var(--shadow-overlay,var(--shadow-xl,var(--shadow-lg)))] overflow-hidden"
            style="animation: shortcuts-in 150ms ease-out"
        >
            <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <span class="text-sm font-semibold text-foreground">{m.shortcuts_title()}</span>
                <kbd class="px-1.5 py-0.5 rounded bg-bg3 border border-border font-mono text-[10px] text-muted">
                    {formatForDisplay('Escape')}
                </kbd>
            </div>
            <div class="flex-1 overflow-y-auto py-2">
                {#each liveRows as row (row.id)}
                    <div class="flex items-center justify-between gap-3 px-4 py-1.5">
                        <div class="min-w-0">
                            <p class="text-sm text-foreground truncate">{row.name}</p>
                            {#if row.description}
                                <p class="text-[11px] text-muted-foreground truncate">{row.description}</p>
                            {/if}
                        </div>
                        <kbd class="shrink-0 px-1.5 py-0.5 rounded bg-bg3 border border-border font-mono text-[11px] text-muted-foreground">
                            {row.combo}
                        </kbd>
                    </div>
                {/each}

                <div class="px-4 pt-3 pb-1">
                    <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-strong">
                        {m.shortcuts_gridSectionTitle()}
                    </span>
                </div>
                {#each gridRows as row (row.id)}
                    <div class="flex items-center justify-between gap-3 px-4 py-1.5">
                        <p class="text-sm text-foreground truncate">{row.name}</p>
                        <kbd class="shrink-0 px-1.5 py-0.5 rounded bg-bg3 border border-border font-mono text-[11px] text-muted-foreground">
                            {row.combo}
                        </kbd>
                    </div>
                {/each}
            </div>
        </div>
    </div>
{/if}

<style>
    @keyframes shortcuts-in {
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
