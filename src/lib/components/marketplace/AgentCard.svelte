<script lang="ts">
    import { goto } from "$app/navigation";
    import type { MarketplaceAgent } from "$lib/state/features/marketplace.svelte";
    import { parseTags } from "$lib/state/features/marketplace.svelte";
    import { diceBearAvatarUrl } from "$lib/utils/avatar";
    import { holo } from '$lib/actions/holo';
    import IdBadgeClip from './_agent-card/IdBadgeClip.svelte';
    import IdHeader from './_agent-card/IdHeader.svelte';
    import IdPhoto from './_agent-card/IdPhoto.svelte';
    import IdInfo from './_agent-card/IdInfo.svelte';
    import IdFooter from './_agent-card/IdFooter.svelte';
    import CardBack from './_agent-card/CardBack.svelte';

    interface Props {
        agent: MarketplaceAgent;
        onInstall?: (agentId: string) => void;
    }

    let { agent }: Props = $props();

    let isFlipped = $state(false);
    let dividerEl: HTMLElement | undefined; // plain let for bind:this — $state wraps in proxy

    const tags = $derived(parseTags(agent.tags));
    const installCount = $derived(agent.installCount ?? 0);
    // Marketplace agents are autonomous or copilot (default copilot baseline).
    const avatarUrl = $derived(diceBearAvatarUrl(agent.avatarSeed, agent.archetype ?? 'copilot'));

    function getInitials(name: string): string {
        return name.slice(0, 2).toUpperCase();
    }

    function flipCard() {
        isFlipped = !isFlipped;
    }

    // Back side: any click flips back to front.
    // Front side: click below the divider → flip; above → navigate.
    function handleContainerClick(e: MouseEvent) {
        if (isFlipped) { flipCard(); return; }
        if (dividerEl) {
            const { bottom } = dividerEl.getBoundingClientRect();
            if (e.clientY >= bottom) { flipCard(); return; }
        }
        goto(`/marketplace/agents/${agent.id}`);
    }
</script>

<div class="agent-card-container" class:flipped={isFlipped} use:holo onclick={handleContainerClick} onkeydown={(e) => e.key === 'Enter' && flipCard()} role="button" tabindex="0">
    <div class="agent-card-inner">
        <!-- FRONT SIDE - Corporate ID Badge -->
        <div class="agent-card-front">
            <IdBadgeClip />

            <!-- ID Card -->
            <div class="id-card">
                <!-- Holo layers (pointer-driven, CSS-only) -->
                <div class="holo-sheen" aria-hidden="true"></div>
                <div class="holo-glare" aria-hidden="true"></div>

                <IdHeader initials={getInitials(agent.name)} />
                <IdPhoto src={avatarUrl} alt={agent.name} />
                <IdInfo
                    name={agent.name}
                    role={agent.role}
                    catchphrase={agent.catchphrase}
                    description={agent.description}
                />

                <!-- Divider — spatial boundary: above = navigate, below = flip -->
                <div class="id-divider" bind:this={dividerEl}></div>

                <IdFooter onFlip={flipCard} />
            </div>
        </div>

        <!-- BACK SIDE - Role Description -->
        <CardBack
            role={agent.role}
            category={agent.category}
            {tags}
            description={agent.description}
            soulMd={agent.soulMd}
            skillsMd={agent.skillsMd}
            version={agent.version}
            {installCount}
        />
    </div>
</div>

<style>
    .agent-card-container {
        width: 100%;
        max-width: 260px;
        aspect-ratio: 53.98 / 85.6;
        margin: 0 auto;
        cursor: pointer;
    }

    .agent-card-inner {
        position: relative;
        width: 100%;
        height: 100%;
        transform-style: preserve-3d;
        transition: transform 0.7s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .agent-card-container.flipped .agent-card-inner {
        transform: rotateY(180deg);
    }

    .agent-card-front {
        position: absolute;
        width: 100%;
        height: 100%;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        border-radius: 16px;
        overflow: hidden;
        transform: rotateY(0deg);
        padding-top: 12px;
        overflow: visible;
    }

    /* ID Card */
    .id-card {
        width: 100%;
        height: 100%;
        background: linear-gradient(
            145deg,
            rgba(250, 250, 250, 0.98),
            rgba(240, 240, 242, 0.95)
        );
        border-radius: 14px;
        padding: 20px;
        display: flex;
        flex-direction: column;
        position: relative;
        overflow: hidden;
        box-shadow:
            0 4px 6px rgba(0, 0, 0, 0.1),
            0 10px 20px rgba(0, 0, 0, 0.1),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
    }

    /* Divider — solid full-bleed line */
    .id-divider {
        height: 1px;
        background: #18181b;
        margin: 12px -20px 0;
        position: relative;
        z-index: 3;
    }

    /* Responsive */
    @media (max-width: 640px) {
        .agent-card-container {
            height: 360px;
        }

        .id-card {
            padding: 16px;
        }
    }

    /* Register --mx / --my as typed numbers so the browser can interpolate
       them directly. This lets us transition the vars (not the transform),
       avoiding the "transition restarts on every pointermove" glitch. */
    @property --mx {
        syntax: '<number>';
        inherits: true;
        initial-value: 0.5;
    }
    @property --my {
        syntax: '<number>';
        inherits: true;
        initial-value: 0.5;
    }

    /* Graceful snap-back when cursor leaves (slow ease-out) */
    .agent-card-container:not(.flipped) {
        transition: --mx 0.45s ease-out, --my 0.45s ease-out;
    }
    /* Responsive tracking when cursor is over the card (fast) */
    :global(.agent-card-container:not(.flipped).holo-active) {
        transition: --mx 0.1s ease-out, --my 0.1s ease-out;
    }

    /* Holo tilt on front face only — disabled when card is flipped. */
    .agent-card-container:not(.flipped) .agent-card-front {
        transform:
            perspective(800px)
            rotateX(calc((0.5 - var(--my, 0.5)) * 8deg))
            rotateY(calc((var(--mx, 0.5) - 0.5) * 8deg));
    }

    /* ── Holographic effect ──────────────────────────────────────── */

    /* "MINION" repeated watermark — behind card content, above card background */
    .id-card::before {
        content: 'MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  ';
        position: absolute;
        inset: 0;
        font-family: 'JetBrains Mono NF', monospace;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.04em;
        word-spacing: 1.8em;
        line-height: 5;
        background: linear-gradient(
            calc(110deg + var(--my, 0.5) * 60deg),
            hsl(calc(var(--mx, 0.5) * 300deg + 160deg) 70% 48%),
            hsl(calc(var(--mx, 0.5) * 300deg + 240deg) 72% 52%),
            hsl(calc(var(--mx, 0.5) * 300deg + 320deg) 70% 48%)
        );
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        /* Edge-distance opacity: near-invisible at center, richer at card edges */
        opacity: calc(0.12 + abs(var(--mx, 0.5) - 0.5) * 0.55 + abs(var(--my, 0.5) - 0.5) * 0.55);
        transform: rotate(-45deg) scale(1.6);
        transform-origin: center;
        word-break: break-all;
        pointer-events: none;
        z-index: 2;
    }

    /* Radial glare following pointer */
    .holo-glare {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        z-index: 2;
        background: radial-gradient(
            ellipse 60% 50% at calc(var(--mx, 0.5) * 100%) calc(var(--my, 0.5) * 100%),
            rgba(255, 255, 255, 0.35),
            transparent 70%
        );
        mix-blend-mode: overlay;
        opacity: 0;
        transition: opacity var(--duration-slow) var(--ease-standard);
    }

    :global(.agent-card-container:not(.flipped).holo-active) .holo-glare {
        opacity: 0.6;
    }

    /* Diagonal sheen — bright stripe that sweeps with pointer X; topmost layer below accessory */
    .holo-sheen {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        z-index: 15;
        background: linear-gradient(
            calc(115deg + var(--my, 0.5) * 20deg),
            transparent,
            transparent calc(var(--mx, 0.5) * 100% - 22%),
            rgba(255, 255, 255, 0.08) calc(var(--mx, 0.5) * 100% - 10%),
            rgba(255, 255, 255, 0.38) calc(var(--mx, 0.5) * 100%),
            rgba(255, 255, 255, 0.08) calc(var(--mx, 0.5) * 100% + 10%),
            transparent calc(var(--mx, 0.5) * 100% + 22%),
            transparent
        );
        mix-blend-mode: overlay;
        opacity: 0;
        transition: opacity var(--duration-slow) var(--ease-standard);
    }

    :global(.agent-card-container:not(.flipped).holo-active) .holo-sheen {
        opacity: 1;
    }

    /* Holo border — grayscale gradient that sweeps with pointer */
    .id-card::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        z-index: 10;
        /* Gradient angle and stops shift from white→black with pointer position */
        background: linear-gradient(
            calc(var(--mx, 0.5) * 180deg + 30deg),
            hsl(0deg 0% calc(98% - var(--my, 0.5) * 88%)),
            hsl(0deg 0% calc(55% - var(--my, 0.5) * 45%)),
            hsl(0deg 0% calc(8% + var(--my, 0.5) * 12%))
        );
        /* Border-only mask: paint background only where border pixels are */
        padding: 1px;
        -webkit-mask:
            linear-gradient(#fff 0 0) content-box,
            linear-gradient(#fff 0 0);
        mask:
            linear-gradient(#fff 0 0) content-box,
            linear-gradient(#fff 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        mask-composite: exclude;
    }
</style>
