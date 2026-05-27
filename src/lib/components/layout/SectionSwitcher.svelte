<script lang="ts">
    import { page } from "$app/state";
    import { ChevronDown, Compass } from "lucide-svelte";
    import { getSections, getDynamicPluginsSection, findActiveSection, gateSections } from "./sections";
    import { pluginNavState } from "$lib/state/plugin-nav.svelte";

    const staticSections = $derived(gateSections(getSections(), pluginNavState.enabledByPluginId));
    const pluginsSection = $derived(getDynamicPluginsSection(pluginNavState.controlCenters));
    const sections = $derived(
        pluginsSection ? [...staticSections, pluginsSection] : staticSections,
    );
    const activeSection = $derived(findActiveSection(sections, page.url.pathname));

    let open = $state(false);
    let triggerEl = $state<HTMLButtonElement | null>(null);
    let panelEl = $state<HTMLDivElement | null>(null);

    function handleOutside(ev: MouseEvent) {
        if (!open) return;
        const target = ev.target as Node;
        if (triggerEl?.contains(target) || panelEl?.contains(target)) return;
        open = false;
    }
    function handleKey(ev: KeyboardEvent) {
        if (ev.key === "Escape" && open) open = false;
    }

    $effect(() => {
        if (!open) return;
        document.addEventListener("mousedown", handleOutside);
        document.addEventListener("keydown", handleKey);
        return () => {
            document.removeEventListener("mousedown", handleOutside);
            document.removeEventListener("keydown", handleKey);
        };
    });

    $effect(() => {
        // close on route change
        page.url.pathname;
        open = false;
    });

    const displayLabel = $derived(activeSection?.label ?? "Browse");
    const DisplayIcon = $derived(activeSection?.icon ?? Compass);
    const tone = $derived(activeSection?.tone ?? "accent");
</script>

<div class="relative shrink-0">
    <button
        bind:this={triggerEl}
        type="button"
        onclick={() => (open = !open)}
        aria-expanded={open}
        aria-haspopup="menu"
        class="section-chip {tone === 'brand' ? 'tone-brand' : 'tone-accent'} {open ? 'is-open' : ''}"
    >
        <DisplayIcon size={14} />
        <span class="chip-label">{displayLabel}</span>
        <ChevronDown size={13} class="chip-caret" />
    </button>

    {#if open}
        <div
            bind:this={panelEl}
            role="menu"
            class="panel"
            style="animation: panel-in 140ms cubic-bezier(0.22, 1, 0.36, 1)"
        >
            {#if pluginsSection}
                <div class="plugins-band col">
                    <div class="col-head {pluginsSection.tone === 'brand' ? 'head-brand' : 'head-accent'}">
                        <pluginsSection.icon size={13} />
                        <span>{pluginsSection.label}</span>
                    </div>
                    <div class="plugins-items">
                        {#each pluginsSection.items as item (item.href)}
                            {@const isActive = item.matcher(page.url.pathname)}
                            <a
                                href={item.href}
                                class="row {isActive ? 'row-active' : ''} {pluginsSection.tone === 'brand' ? 'row-brand' : 'row-accent'}"
                                role="menuitem"
                            >
                                <item.icon size={14} />
                                <span>{item.label}</span>
                            </a>
                        {/each}
                    </div>
                </div>
            {/if}
            <div class="panel-grid">
                {#each staticSections as section (section.id)}
                    <div class="col">
                        <div class="col-head {section.tone === 'brand' ? 'head-brand' : 'head-accent'}">
                            <section.icon size={13} />
                            <span>{section.label}</span>
                        </div>
                        <div class="col-items">
                            {#each section.items as item (item.href)}
                                {@const isActive = item.matcher(page.url.pathname)}
                                <a
                                    href={item.href}
                                    class="row {isActive ? 'row-active' : ''} {section.tone === 'brand' ? 'row-brand' : 'row-accent'}"
                                    role="menuitem"
                                >
                                    <item.icon size={14} />
                                    <span>{item.label}</span>
                                </a>
                            {/each}
                        </div>
                    </div>
                {/each}
            </div>
            <div class="panel-foot">
                <span>Press <kbd>Esc</kbd> to dismiss</span>
            </div>
        </div>
    {/if}
</div>

<style>
    .section-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        height: 2rem;
        padding: 0 0.625rem;
        border-radius: 0.5rem;
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--color-foreground);
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        transition:
            background 140ms ease,
            border-color 140ms ease,
            box-shadow 200ms cubic-bezier(0.22, 1, 0.36, 1);
        cursor: pointer;
    }
    .section-chip:hover {
        background: var(--color-bg3);
    }
    .section-chip.is-open {
        background: var(--color-bg3);
    }
    .tone-accent {
        box-shadow: inset 0 0 0 1px
            color-mix(in srgb, var(--color-accent) 22%, transparent);
    }
    .tone-accent.is-open {
        box-shadow:
            inset 0 0 0 1px
                color-mix(in srgb, var(--color-accent) 45%, transparent),
            0 6px 22px -10px
                color-mix(in srgb, var(--color-accent) 50%, transparent);
    }
    .tone-brand {
        box-shadow: inset 0 0 0 1px
            color-mix(in srgb, var(--color-brand-pink) 28%, transparent);
        color: var(--color-brand-pink);
    }
    .tone-brand.is-open {
        box-shadow:
            inset 0 0 0 1px
                color-mix(in srgb, var(--color-brand-pink) 55%, transparent),
            0 6px 22px -10px
                color-mix(in srgb, var(--color-brand-pink) 50%, transparent);
    }
    .chip-label {
        white-space: nowrap;
    }
    :global(.section-chip .chip-caret) {
        opacity: 0.55;
        transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .section-chip.is-open :global(.chip-caret) {
        transform: rotate(180deg);
        opacity: 0.85;
    }

    .panel {
        position: absolute;
        top: calc(100% + 8px);
        left: 0;
        z-index: 60;
        min-width: 540px;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        padding: 0.625rem 0.625rem 0.375rem;
        box-shadow:
            inset 0 1px 0
                color-mix(in srgb, var(--color-foreground) 6%, transparent),
            0 24px 60px -28px rgba(0, 0, 0, 0.6),
            0 8px 22px -12px rgba(0, 0, 0, 0.45);
        transform-origin: top left;
    }
    @keyframes panel-in {
        from {
            opacity: 0;
            transform: translateY(-4px) scale(0.985);
        }
        to {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }
    .panel-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(160px, 1fr));
        gap: 0.25rem;
    }
    .plugins-band {
        margin-bottom: 0.375rem;
        padding-bottom: 0.375rem;
        border-bottom: 1px dashed var(--color-border);
    }
    .plugins-items {
        display: grid;
        grid-template-columns: repeat(3, minmax(160px, 1fr));
        gap: 0.0625rem 0.25rem;
    }
    .col {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        padding: 0.25rem;
    }
    .col-head {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.25rem 0.5rem 0.375rem;
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }
    .head-accent {
        color: color-mix(in srgb, var(--color-accent) 80%, var(--color-muted));
    }
    .head-brand {
        color: var(--color-brand-pink);
    }
    .col-items {
        display: flex;
        flex-direction: column;
        gap: 0.0625rem;
    }
    .row {
        display: inline-flex;
        align-items: center;
        gap: 0.625rem;
        padding: 0.4375rem 0.5rem;
        border-radius: 0.4375rem;
        font-size: 0.8125rem;
        color: var(--color-foreground);
        text-decoration: none;
        transition:
            background 120ms ease,
            color 120ms ease;
        position: relative;
    }
    .row :global(svg) {
        opacity: 0.65;
        transition: opacity 120ms ease;
        flex-shrink: 0;
    }
    .row:hover {
        background: var(--color-bg3);
    }
    .row:hover :global(svg) {
        opacity: 1;
    }
    .row-active.row-accent {
        background: color-mix(in srgb, var(--color-accent) 14%, transparent);
        color: var(--color-accent);
        font-weight: 600;
    }
    .row-active.row-accent :global(svg) {
        opacity: 1;
        color: var(--color-accent);
    }
    .row-active.row-brand {
        background: color-mix(
            in srgb,
            var(--color-brand-pink) 14%,
            transparent
        );
        color: var(--color-brand-pink);
        font-weight: 600;
    }
    .row-active.row-brand :global(svg) {
        opacity: 1;
        color: var(--color-brand-pink);
    }
    .panel-foot {
        margin-top: 0.375rem;
        padding: 0.375rem 0.5rem 0.125rem;
        font-size: 0.6875rem;
        color: var(--color-muted);
        border-top: 1px dashed var(--color-border);
    }
    .panel-foot kbd {
        font-family: inherit;
        font-size: 0.625rem;
        padding: 0.0625rem 0.3125rem;
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: 0.25rem;
        color: var(--color-foreground);
    }
</style>
