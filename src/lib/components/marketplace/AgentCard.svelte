<script lang="ts">
    import { goto } from "$app/navigation";
    import type { MarketplaceAgent } from "$lib/state/marketplace.svelte";
    import { parseTags, installAgent } from "$lib/state/marketplace.svelte";
    import { diceBearAvatarUrl } from "$lib/utils/avatar";
    import * as m from '$lib/paraglide/messages';

    interface Props {
        agent: MarketplaceAgent;
        onInstall?: (agentId: string) => void;
    }

    let { agent, onInstall }: Props = $props();

    let isFlipped = $state(false);

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

    function handleHireMe() {
        if (onInstall) {
            onInstall(agent.id);
        } else {
            goto(`/marketplace/agents/${agent.id}?tab=hire`);
        }
    }

    function flipCard() {
        isFlipped = !isFlipped;
    }

    function viewDetails(e: MouseEvent) {
        e.stopPropagation();
        goto(`/marketplace/agents/${agent.id}`);
    }
</script>

<div class="agent-card-container" class:flipped={isFlipped}>
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

                <!-- Divider -->
                <div class="id-divider">
                    <div class="dashed-line"></div>
                </div>

                <!-- Footer -->
                <div class="id-footer">
                    <div class="company-brand">MINION</div>
                    <div class="footer-actions">
                        <span class="install-count"
                            >📥 {formatInstallCount(installCount)}</span
                        >
                        <button
                            type="button"
                            class="role-desc-btn"
                            onclick={flipCard}
                        >
                            {m.marketplace_agentCardRoleDescription()}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- BACK SIDE - Role Description -->
        <div class="agent-card-back">
            <!-- Back Header -->
            <div class="back-header">
                <button
                    type="button"
                    class="back-btn"
                    onclick={flipCard}
                    aria-label="Flip card back"
                >
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                </button>
                <span class="back-title">{m.marketplace_agentCardRoleDescription()}</span>
                <div class="w-6"></div>
                <!-- Spacer for centering -->
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
                <div class="version-info">
                    <span>v{agent.version}</span>
                    {#if agent.model}
                        <span class="model-tag">{agent.model}</span>
                    {/if}
                </div>
                <button
                    type="button"
                    class="hire-me-btn"
                    onclick={handleHireMe}
                >
                    <span class="btn-icon">✓</span>
                    <span>{m.marketplace_agentCardHireMe()}</span>
                </button>
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
        perspective: 1200px;
        width: 100%;
        height: 380px;
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
        border: 1px solid rgba(0, 0, 0, 0.08);
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
            rgba(232, 84, 122, 0.4) 0%,
            transparent 70%
        );
        filter: blur(8px);
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

    /* Divider */
    .id-divider {
        margin: 12px 0;
        display: flex;
        align-items: center;
    }

    .dashed-line {
        flex: 1;
        height: 1px;
        background: repeating-linear-gradient(
            90deg,
            rgba(0, 0, 0, 0.15) 0px,
            rgba(0, 0, 0, 0.15) 4px,
            transparent 4px,
            transparent 8px
        );
    }

    /* Footer */
    .id-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: auto;
    }

    .company-brand {
        font-family: "JetBrains Mono NF", monospace;
        font-weight: 800;
        font-size: 16px;
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

    .footer-actions {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .install-count {
        font-size: 10px;
        color: #a1a1aa;
        font-family: "JetBrains Mono NF", monospace;
    }

    .role-desc-btn {
        background: #18181b;
        color: #fafafa;
        border: none;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        font-family: inherit;
    }

    .role-desc-btn:hover {
        background: #e8547a;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(232, 84, 122, 0.4);
    }

    /* BACK SIDE STYLES */

    .back-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .back-btn {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #a1a1aa;
        width: 32px;
        height: 32px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .back-btn:hover {
        background: rgba(232, 84, 122, 0.1);
        border-color: rgba(232, 84, 122, 0.3);
        color: #e8547a;
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
        padding-top: 16px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .version-info {
        display: flex;
        gap: 8px;
        align-items: center;
    }

    .version-info span {
        font-size: 10px;
        color: #71717a;
        font-family: "JetBrains Mono NF", monospace;
    }

    .model-tag {
        background: rgba(6, 182, 212, 0.1);
        color: #06b6d4;
        padding: 2px 8px;
        border-radius: 4px;
        border: 1px solid rgba(6, 182, 212, 0.2);
    }

    .hire-me-btn {
        background: linear-gradient(135deg, #e8547a, #c44d6c);
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s ease;
        box-shadow: 0 4px 15px rgba(232, 84, 122, 0.3);
    }

    .hire-me-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(232, 84, 122, 0.5);
    }

    .btn-icon {
        font-size: 14px;
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
</style>
