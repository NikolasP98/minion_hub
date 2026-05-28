<script lang="ts">
    import * as m from '$lib/paraglide/messages';
    import { Download } from "lucide-svelte";

    interface Props {
        role: string;
        category: string;
        tags: string[];
        description: string;
        soulMd?: string | null;
        skillsMd?: string | null;
        version: string | number;
        installCount: number;
    }
    let {
        role,
        category,
        tags,
        description,
        soulMd,
        skillsMd,
        version,
        installCount,
    }: Props = $props();

    function formatInstallCount(n: number): string {
        if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
        return String(n);
    }
</script>

<div class="agent-card-back">
    <div class="back-header">
        <span class="back-title">{m.marketplace_agentCardRoleDescription()}</span>
    </div>

    <div class="back-content">
        <div class="role-header">
            <h3 class="role-title">{role}</h3>
            <div class="role-badges">
                <span class="role-badge category">{category}</span>
                {#each tags.slice(0, 2) as tag (tag)}
                    <span class="role-badge tag">{tag}</span>
                {/each}
            </div>
        </div>

        <div class="role-description">
            <p>{description}</p>
        </div>

        {#if soulMd}
            <div class="soul-section">
                <h4 class="section-title">{m.marketplace_agentCardCorePurpose()}</h4>
                <p class="section-text">
                    {soulMd.slice(0, 150)}...
                </p>
            </div>
        {/if}

        {#if skillsMd}
            <div class="skills-section">
                <h4 class="section-title">{m.marketplace_agentCardCapabilities()}</h4>
                <p class="section-text">
                    {skillsMd.slice(0, 120)}...
                </p>
            </div>
        {/if}
    </div>

    <div class="back-footer">
        <span class="back-meta">v{version}</span>
        <span class="back-meta install-back">
            <Download size={9} />{formatInstallCount(installCount)}
        </span>
    </div>

    <div class="corner-decoration tl"></div>
    <div class="corner-decoration tr"></div>
    <div class="corner-decoration bl"></div>
    <div class="corner-decoration br"></div>
</div>

<style>
    .agent-card-back {
        position: absolute;
        width: 100%;
        height: 100%;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        border-radius: 16px;
        overflow: hidden;
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
</style>
