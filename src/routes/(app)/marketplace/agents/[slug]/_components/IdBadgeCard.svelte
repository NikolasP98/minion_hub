<script lang="ts">
    import type { MarketplaceAgent } from "$lib/state/features/marketplace.svelte";
    import { diceBearAvatarUrl } from "$lib/utils/avatar";
    import * as m from "$lib/paraglide/messages";

    interface Props {
        agent: MarketplaceAgent;
    }

    let { agent }: Props = $props();

    let lanyardEl = $state<HTMLElement | null>(null);

    const avatarUrl = $derived(diceBearAvatarUrl(agent.avatarSeed, agent.archetype ?? 'copilot'));

    $effect(() => {
        if (agent && lanyardEl) startLanyardAnimation();
    });

    function startLanyardAnimation() {
        if (!lanyardEl) return;
        const el: HTMLElement = lanyardEl;

        // Damped pendulum: θ(t) = θ₀ · e^(-ζωt) · cos(ω_d · t)
        const theta0 = 22 * (Math.PI / 180);
        const omega  = 3.0;
        const zeta   = 0.35;
        const omegaD = omega * Math.sqrt(1 - zeta * zeta);
        const startMs = performance.now();
        let raf: number;

        function tick() {
            const t = (performance.now() - startMs) / 1000;
            const envelope = theta0 * Math.exp(-zeta * omega * t);
            const theta = envelope * Math.cos(omegaD * t);
            el.style.transform = `rotateZ(${theta}rad)`;

            // Stop only when the envelope (max possible displacement) is negligible,
            // not when the instantaneous angle happens to cross zero
            if (envelope < 0.0008) {
                el.style.transform = 'rotateZ(0rad)';
                return;
            }
            raf = requestAnimationFrame(tick);
        }

        raf = requestAnimationFrame(tick);
    }

    function formatInstallCount(n: number | null): string {
        const count = n ?? 0;
        if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
        return String(count);
    }

    function getInitials(name: string): string {
        return name.slice(0, 2).toUpperCase();
    }
</script>

<!-- ID Badge Card wrapped in lanyard mount for swing animation -->
<div class="lanyard-mount" bind:this={lanyardEl}>
    <svg class="lanyard-rope" width="20" height="70" viewBox="0 0 20 70" aria-hidden="true">
        <line x1="10" y1="0" x2="10" y2="70"
            stroke="rgba(120,120,130,0.7)" stroke-width="3.5"
            stroke-linecap="round"
            stroke-dasharray="2 3" />
    </svg>
<div class="id-badge-card">
    <!-- Badge Clip -->
    <div class="badge-clip">
        <div class="clip-base"></div>
        <div class="clip-ring"></div>
    </div>

    <!-- Card Content -->
    <div class="badge-content">
        <!-- Header -->
        <div class="badge-header">
            <span class="initials">{getInitials(agent.name)}</span>
            <div class="status-badge">
                <span class="status-dot"></span>
                <span>{m.marketplace_agentDetailAvailable()}</span>
            </div>
        </div>

        <!-- Photo -->
        <div class="badge-photo">
            <div class="photo-frame">
                <img src={avatarUrl} alt={agent.name} />
            </div>
            <div class="photo-corners">
                <span class="corner tl"></span>
                <span class="corner tr"></span>
                <span class="corner bl"></span>
                <span class="corner br"></span>
            </div>
        </div>

        <!-- Info -->
        <div class="badge-info">
            <h1 class="agent-name">{agent.name}</h1>
            <p class="agent-role">{agent.role}</p>
            {#if agent.catchphrase}
                <p class="agent-tagline">"{agent.catchphrase}"</p>
            {/if}
        </div>

        <!-- Stats -->
        <div class="badge-stats">
            <div class="stat">
                <span class="stat-value"
                    >{formatInstallCount(agent.installCount)}</span
                >
                <span class="stat-label">{m.marketplace_agentDetailInstalls()}</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat">
                <span class="stat-value">{agent.version}</span>
                <span class="stat-label">{m.marketplace_agentDetailVersion()}</span>
            </div>
            <div class="stat-divider"></div>
            <div class="stat">
                <span class="stat-value capitalize"
                    >{agent.category}</span
                >
                <span class="stat-label">{m.marketplace_agentDetailDept()}</span>
            </div>
        </div>

        <!-- Footer -->
        <div class="badge-footer">
            <span class="company-brand">MINION</span>
            <span class="agent-id">ID: {agent.id.slice(0, 8)}</span>
        </div>
    </div>

    <!-- Glow Effect -->
    <div class="badge-glow"></div>
</div>
</div> <!-- /lanyard-mount -->

<style>
    /* Lanyard mount — pivots from top center for swing animation */
    .lanyard-mount {
        display: flex;
        flex-direction: column;
        align-items: center;
        transform-origin: 50% 0;
        will-change: transform;
    }

    .lanyard-rope {
        display: block;
        flex-shrink: 0;
        margin-bottom: -4px;
    }

    /* ID Badge Card */
    .id-badge-card {
        position: relative;
        perspective: 1000px;
    }

    .badge-clip {
        position: absolute;
        top: -12px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10;
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    .clip-base {
        width: 40px;
        height: 24px;
        background: linear-gradient(145deg, #3a3a3c, #1c1c1e);
        border-radius: 4px 4px 0 0;
        border: 1px solid #48484a;
        box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.1),
            0 2px 4px rgba(0, 0, 0, 0.4);
    }

    .clip-ring {
        width: 24px;
        height: 10px;
        background: linear-gradient(145deg, #48484a, #2c2c2e);
        border-radius: 0 0 12px 12px;
        border: 1px solid #5a5a5c;
        margin-top: -1px;
    }

    .badge-content {
        background: linear-gradient(
            145deg,
            rgba(250, 250, 250, 0.98),
            rgba(240, 240, 242, 0.95)
        );
        border-radius: 16px;
        padding: 24px;
        box-shadow:
            0 4px 6px rgba(0, 0, 0, 0.1),
            0 10px 20px rgba(0, 0, 0, 0.1),
            inset 0 1px 0 rgba(255, 255, 255, 0.8);
        border: 1px solid rgba(0, 0, 0, 0.08);
        position: relative;
    }

    .badge-header {
        background: linear-gradient(90deg, #1c1c1e, #2c2c2e, #1c1c1e);
        border-radius: 10px;
        padding: 10px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;
    }

    .initials {
        font-family: "JetBrains Mono NF", monospace;
        font-weight: 700;
        font-size: 14px;
        color: #fafafa;
        letter-spacing: 0.15em;
    }

    .status-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 10px;
        color: #22c55e;
        font-weight: 600;
    }

    .status-dot {
        width: 6px;
        height: 6px;
        background: #22c55e;
        border-radius: 50%;
        box-shadow: 0 0 6px #22c55e;
        animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0.6;
        }
    }

    .badge-photo {
        display: flex;
        justify-content: center;
        margin-bottom: 20px;
        position: relative;
    }

    .photo-frame {
        width: 120px;
        height: 120px;
        border-radius: 16px;
        background: #ffffff;
        padding: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .photo-frame img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 10px;
    }

    .photo-corners {
        position: absolute;
        inset: 0;
    }

    .corner {
        position: absolute;
        width: 12px;
        height: 12px;
        border: 2px solid rgba(232, 84, 122, 0.4);
    }

    .corner.tl {
        top: -4px;
        left: calc(50% - 60px - 4px);
        border-right: none;
        border-bottom: none;
    }
    .corner.tr {
        top: -4px;
        right: calc(50% - 60px - 4px);
        border-left: none;
        border-bottom: none;
    }
    .corner.bl {
        bottom: -4px;
        left: calc(50% - 60px - 4px);
        border-right: none;
        border-top: none;
    }
    .corner.br {
        bottom: -4px;
        right: calc(50% - 60px - 4px);
        border-left: none;
        border-top: none;
    }

    .badge-info {
        text-align: center;
        margin-bottom: 20px;
    }

    .agent-name {
        font-size: 20px;
        font-weight: 800;
        color: #18181b;
        margin: 0 0 4px;
    }

    .agent-role {
        font-size: 13px;
        color: #71717a;
        margin: 0 0 8px;
        font-weight: 500;
    }

    .agent-tagline {
        font-size: 12px;
        color: #a1a1aa;
        font-style: italic;
        margin: 0;
        line-height: 1.4;
    }

    .badge-stats {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        padding: 16px 0;
        border-top: 1px dashed rgba(0, 0, 0, 0.15);
        border-bottom: 1px dashed rgba(0, 0, 0, 0.15);
        margin-bottom: 16px;
    }

    .stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
    }

    .stat-value {
        font-size: 14px;
        font-weight: 700;
        color: #18181b;
        font-family: "JetBrains Mono NF", monospace;
    }

    .stat-label {
        font-size: 9px;
        color: #a1a1aa;
        text-transform: uppercase;
        letter-spacing: 0.1em;
    }

    .stat-divider {
        width: 1px;
        height: 24px;
        background: rgba(0, 0, 0, 0.1);
    }

    .badge-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .company-brand {
        font-family: "JetBrains Mono NF", monospace;
        font-weight: 800;
        font-size: 18px;
        color: #18181b;
        letter-spacing: 0.05em;
        position: relative;
    }

    .company-brand::after {
        content: "";
        position: absolute;
        bottom: -2px;
        left: 0;
        width: 100%;
        height: 2px;
        background: linear-gradient(90deg, #e8547a, transparent);
    }

    .agent-id {
        font-size: 9px;
        color: #a1a1aa;
        font-family: "JetBrains Mono NF", monospace;
    }

    .badge-glow {
        position: absolute;
        inset: -4px;
        background: linear-gradient(
            135deg,
            rgba(232, 84, 122, 0.3),
            transparent,
            rgba(232, 84, 122, 0.1)
        );
        border-radius: 20px;
        z-index: -1;
        opacity: 0;
        transition: opacity var(--duration-slow) var(--ease-standard);
    }

    .id-badge-card:hover .badge-glow {
        opacity: 1;
    }
</style>
