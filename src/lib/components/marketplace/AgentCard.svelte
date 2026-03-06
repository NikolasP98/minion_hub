<script lang="ts">
    import { goto } from "$app/navigation";
    import type { MarketplaceAgent } from "$lib/state/features/marketplace.svelte";
    import { parseTags, installAgent } from "$lib/state/features/marketplace.svelte";
    import { diceBearAvatarUrl } from "$lib/utils/avatar";
    import * as m from '$lib/paraglide/messages';
    import { Download, RefreshCw } from "lucide-svelte";
    import { holo } from '$lib/actions/holo';

    interface Props {
        agent: MarketplaceAgent;
        onInstall?: (agentId: string) => void;
    }

    let { agent, onInstall }: Props = $props();

    let isFlipped = $state(false);
    let dividerEl: HTMLElement | undefined; // plain let for bind:this — $state wraps in proxy

    const tags = $derived(parseTags(agent.tags));
    const installCount = $derived(agent.installCount ?? 0);
    const avatarUrl = $derived(diceBearAvatarUrl(agent.avatarSeed));

    function formatInstallCount(n: number): string {
        if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
        return String(n);
    }

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
            <!-- Badge Clip -->
            <div class="badge-clip">
                <div class="clip-base"></div>
                <div class="clip-ring"></div>
            </div>

            <!-- ID Card -->
            <div class="id-card">
                <!-- Holo layers (pointer-driven, CSS-only) -->
                <div class="holo-sheen" aria-hidden="true"></div>
                <div class="holo-glare" aria-hidden="true"></div>
                <!-- Header with initials -->
                <div class="id-header">
                    <span class="initials">{getInitials(agent.name)}</span>
                    <div class="header-glow"></div>
                </div>

                <!-- Photo Area -->
                <div class="photo-container">
                    <div class="photo-frame">
                        <img
                            src={avatarUrl}
                            alt={agent.name}
                            class="agent-photo"
                            loading="lazy"
                        />
                    </div>
                    <div class="photo-corner tl"></div>
                    <div class="photo-corner tr"></div>
                    <div class="photo-corner bl"></div>
                    <div class="photo-corner br"></div>
                </div>

                <!-- Agent Info -->
                <div class="agent-info">
                    <h3 class="agent-name">{agent.name}</h3>
                    <p class="agent-role">{agent.role}</p>

                    {#if agent.catchphrase}
                        <p class="agent-tagline">"{agent.catchphrase}"</p>
                    {:else}
                        <p class="agent-tagline">
                            {agent.description.slice(0, 60)}...
                        </p>
                    {/if}
                </div>

                <!-- Divider — spatial boundary: above = navigate, below = flip -->
                <div class="id-divider" bind:this={dividerEl}></div>

                <div class="id-footer">
                    <div class="company-brand">MINION</div>
                    <button
                        type="button"
                        class="role-desc-btn"
                        onclick={(e) => { e.stopPropagation(); flipCard(); }}
                    >
                        <RefreshCw size={16} />
                    </button>
                </div>
            </div>
        </div>

        <!-- BACK SIDE - Role Description -->
        <div class="agent-card-back">
            <!-- Back Header -->
            <div class="back-header">
                <span class="back-title">{m.marketplace_agentCardRoleDescription()}</span>
            </div>

            <!-- Content -->
            <div class="back-content">
                <div class="role-header">
                    <h3 class="role-title">{agent.role}</h3>
                    <div class="role-badges">
                        <span class="role-badge category">{agent.category}</span
                        >
                        {#each tags.slice(0, 2) as tag (tag)}
                            <span class="role-badge tag">{tag}</span>
                        {/each}
                    </div>
                </div>

                <div class="role-description">
                    <p>{agent.description}</p>
                </div>

                {#if agent.soulMd}
                    <div class="soul-section">
                        <h4 class="section-title">{m.marketplace_agentCardCorePurpose()}</h4>
                        <p class="section-text">
                            {agent.soulMd.slice(0, 150)}...
                        </p>
                    </div>
                {/if}

                {#if agent.skillsMd}
                    <div class="skills-section">
                        <h4 class="section-title">{m.marketplace_agentCardCapabilities()}</h4>
                        <p class="section-text">
                            {agent.skillsMd.slice(0, 120)}...
                        </p>
                    </div>
                {/if}
            </div>

            <!-- Back Footer -->
            <div class="back-footer">
                <span class="back-meta">v{agent.version}</span>
                <span class="back-meta install-back">
                    <Download size={9} />{formatInstallCount(installCount)}
                </span>
            </div>

            <!-- Decorative elements -->
            <div class="corner-decoration tl"></div>
            <div class="corner-decoration tr"></div>
            <div class="corner-decoration bl"></div>
            <div class="corner-decoration br"></div>
        </div>
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

    .agent-card-front,
    .agent-card-back {
        position: absolute;
        width: 100%;
        height: 100%;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        border-radius: 16px;
        overflow: hidden;
    }

    .agent-card-front {
        transform: rotateY(0deg);
        padding-top: 12px;
        overflow: visible;
    }

    .agent-card-back {
        transform: rotateY(180deg);
        background: linear-gradient(
            145deg,
            rgba(24, 24, 27, 0.95),
            rgba(9, 9, 11, 0.98)
        );
        border: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        flex-direction: column;
        padding: 20px;
        box-shadow:
            0 0 0 1px rgba(255, 255, 255, 0.05),
            0 20px 40px rgba(0, 0, 0, 0.5);
    }

    /* Badge Clip */
    .badge-clip {
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10;
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    .clip-base {
        width: 36px;
        height: 20px;
        background: linear-gradient(145deg, #3a3a3c, #1c1c1e);
        border-radius: 4px 4px 0 0;
        border: 1px solid #48484a;
        box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.1),
            0 2px 4px rgba(0, 0, 0, 0.4);
    }

    .clip-ring {
        width: 20px;
        height: 8px;
        background: linear-gradient(145deg, #48484a, #2c2c2e);
        border-radius: 0 0 10px 10px;
        border: 1px solid #5a5a5c;
        margin-top: -1px;
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
        box-shadow:
            0 4px 6px rgba(0, 0, 0, 0.1),
            0 10px 20px rgba(0, 0, 0, 0.1),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
    }

    /* Header */
    .id-header {
        background: linear-gradient(90deg, #1c1c1e, #2c2c2e, #1c1c1e);
        border-radius: 8px;
        padding: 8px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        position: relative;
        overflow: hidden;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    .initials {
        font-family: "JetBrains Mono NF", monospace;
        font-weight: 700;
        font-size: 12px;
        color: #fafafa;
        letter-spacing: 0.15em;
        z-index: 2;
    }

    .header-glow {
        position: absolute;
        right: 10px;
        width: 40px;
        height: 40px;
        background: radial-gradient(
            circle,
            hsl(calc(var(--mx, 0.5) * 120deg + 300deg) 75% 60% / 0.55) 0%,
            transparent 70%
        );
        filter: blur(3px);
        /* Turbulence noise mask — breaks smooth glow into sparkle cluster */
        -webkit-mask-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='0.55' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 7 -2.5'/></filter><rect width='100%25' height='100%25' filter='url(%23f)'/></svg>");
        mask-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='0.55' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 7 -2.5'/></filter><rect width='100%25' height='100%25' filter='url(%23f)'/></svg>");
        -webkit-mask-size: 40px 40px;
        mask-size: 40px 40px;
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
    }

    /* Photo */
    .photo-container {
        display: flex;
        justify-content: center;
        margin: 16px 0;
        position: relative;
    }

    .photo-frame {
        width: 90px;
        height: 90px;
        border-radius: 12px;
        background: #ffffff;
        padding: 4px;
        box-shadow:
            0 2px 8px rgba(0, 0, 0, 0.1),
            inset 0 0 0 1px rgba(0, 0, 0, 0.05);
        position: relative;
        overflow: hidden;
    }

    .agent-photo {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 8px;
        filter: contrast(1.05) saturate(0.9);
    }

    .photo-corner {
        position: absolute;
        width: 8px;
        height: 8px;
        border: 2px solid rgba(232, 84, 122, 0.4);
    }

    .photo-corner.tl {
        top: -4px;
        left: calc(50% - 45px - 4px);
        border-right: none;
        border-bottom: none;
    }
    .photo-corner.tr {
        top: -4px;
        right: calc(50% - 45px - 4px);
        border-left: none;
        border-bottom: none;
    }
    .photo-corner.bl {
        bottom: -4px;
        left: calc(50% - 45px - 4px);
        border-right: none;
        border-top: none;
    }
    .photo-corner.br {
        bottom: -4px;
        right: calc(50% - 45px - 4px);
        border-left: none;
        border-top: none;
    }

    /* Agent Info */
    .agent-info {
        text-align: center;
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
    }

    .agent-name {
        font-size: 15px;
        font-weight: 700;
        color: #18181b;
        margin: 0;
        line-height: 1.2;
        letter-spacing: -0.01em;
    }

    .agent-role {
        font-size: 12px;
        color: #71717a;
        margin: 4px 0 0;
        font-weight: 500;
    }

    .agent-tagline {
        font-size: 11px;
        color: #a1a1aa;
        font-style: italic;
        margin: 8px 0 0;
        line-height: 1.4;
        padding: 0 8px;
    }

    /* Divider — solid full-bleed line */
    .id-divider {
        height: 1px;
        background: #18181b;
        margin: 12px -20px 0;
    }

    /* Footer — stretches flush to card edges and bottom */
    .id-footer {
        display: flex;
        align-items: stretch;
        margin: 0 -20px -20px;
        min-height: 48px;
    }

    .company-brand {
        font-family: "JetBrains Mono NF", monospace;
        font-weight: 800;
        font-size: 16px;
        letter-spacing: 0.05em;
        flex: 1;
        display: flex;
        align-items: center;
        padding-left: 20px;
        color: #18181b;
        position: relative;
    }

    .company-brand::after {
        content: '';
        position: absolute;
        left: 20px;
        bottom: calc(50% - 11px);
        width: 46px;
        height: 2px;
        background: linear-gradient(90deg, var(--color-brand-pink), transparent);
        opacity: 0.85;
    }

    .role-desc-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 20px;
        background: #18181b;
        color: #fafafa;
        border: none;
        border-left: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0;
        cursor: pointer;
        transition: background 0.15s ease;
        font-family: inherit;
    }

    .role-desc-btn:hover {
        background: #2c2c30;
    }

    /* BACK SIDE STYLES */

    .back-header {
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .back-title {
        font-size: 14px;
        font-weight: 600;
        color: #fafafa;
    }

    .back-content {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .back-content::-webkit-scrollbar {
        width: 4px;
    }

    .back-content::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
    }

    .role-header {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .role-title {
        font-size: 18px;
        font-weight: 700;
        color: #fafafa;
        margin: 0;
        background: linear-gradient(90deg, #fafafa, #e8547a);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
    }

    .role-badges {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
    }

    .role-badge {
        font-size: 10px;
        padding: 3px 10px;
        border-radius: 20px;
        font-weight: 600;
    }

    .role-badge.category {
        background: rgba(232, 84, 122, 0.15);
        color: #e8547a;
        border: 1px solid rgba(232, 84, 122, 0.3);
        text-transform: capitalize;
    }

    .role-badge.tag {
        background: rgba(255, 255, 255, 0.05);
        color: #a1a1aa;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .role-description p {
        font-size: 12px;
        line-height: 1.7;
        color: #a1a1aa;
        margin: 0;
    }

    .soul-section,
    .skills-section {
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 10px;
        padding: 12px;
    }

    .section-title {
        font-size: 10px;
        font-weight: 700;
        color: #e8547a;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin: 0 0 8px;
    }

    .section-text {
        font-size: 11px;
        line-height: 1.6;
        color: #71717a;
        margin: 0;
    }

    .back-footer {
        margin-top: 16px;
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.07);
        display: flex;
        align-items: center;
        gap: 16px;
    }

    .back-meta {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        color: #52525b;
        font-family: "JetBrains Mono NF", monospace;
    }


    /* Corner Decorations */
    .corner-decoration {
        position: absolute;
        width: 30px;
        height: 30px;
        border: 2px solid rgba(232, 84, 122, 0.2);
    }

    .corner-decoration.tl {
        top: 10px;
        left: 10px;
        border-right: none;
        border-bottom: none;
        border-radius: 8px 0 0 0;
    }

    .corner-decoration.tr {
        top: 10px;
        right: 10px;
        border-left: none;
        border-bottom: none;
        border-radius: 0 8px 0 0;
    }

    .corner-decoration.bl {
        bottom: 10px;
        left: 10px;
        border-right: none;
        border-top: none;
        border-radius: 0 0 0 8px;
    }

    .corner-decoration.br {
        bottom: 10px;
        right: 10px;
        border-left: none;
        border-top: none;
        border-radius: 0 0 8px 0;
    }

    /* Responsive */
    @media (max-width: 640px) {
        .agent-card-container {
            height: 360px;
        }

        .photo-frame {
            width: 80px;
            height: 80px;
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

    /* Add overflow:hidden and position:relative to contain layers */
    .id-card {
        overflow: hidden;
        position: relative;
    }

    /* "MINION" repeated watermark — behind card content, above card background */
    .id-card::before {
        content: 'MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  MINION  ';
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
        transition: opacity 0.4s ease;
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
        transition: opacity 0.4s ease;
    }

    :global(.agent-card-container:not(.flipped).holo-active) .holo-sheen {
        opacity: 1;
    }

    /* Ensure content renders above holo overlay layers */
    .id-header,
    .photo-container,
    .agent-info,
    .id-divider,
    .id-footer {
        position: relative;
        z-index: 3;
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
        -webkit-mask-composite: xor;
        mask-composite: exclude;
    }

</style>
