<script lang="ts">
    import type { MarketplaceAgent } from "$lib/state/features/marketplace.svelte";
    import * as m from "$lib/paraglide/messages";
    import { AlignLeft, ClipboardList, BarChart2 } from "lucide-svelte";

    interface Props {
        agent: MarketplaceAgent;
    }

    let { agent }: Props = $props();

    function formatInstallCount(n: number | null): string {
        const count = n ?? 0;
        if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
        return String(count);
    }
</script>

<div class="overview-grid">
    <!-- About Card -->
    <div class="info-card">
        <div class="card-header">
            <AlignLeft size={16} class="text-[var(--color-brand-pink)] shrink-0" />
            <h3>{m.marketplace_agentDetailAbout()}</h3>
        </div>
        <p class="card-body">{agent.description}</p>
    </div>

    <!-- Details Card -->
    <div class="info-card">
        <div class="card-header">
            <ClipboardList size={16} class="text-[var(--color-brand-pink)] shrink-0" />
            <h3>{m.marketplace_agentDetailDetails()}</h3>
        </div>
        <div class="details-list">
            <div class="detail-row">
                <span class="detail-label">{m.marketplace_agentDetailCategory()}</span>
                <span class="detail-value capitalize"
                    >{agent.category}</span
                >
            </div>
            <div class="detail-row">
                <span class="detail-label">{m.marketplace_agentDetailVersion()}</span>
                <span class="detail-value">{agent.version}</span
                >
            </div>
            {#if agent.model}
                <div class="detail-row">
                    <span class="detail-label">{m.marketplace_agentDetailModel()}</span>
                    <span class="detail-value model-tag"
                        >{agent.model}</span
                    >
                </div>
            {/if}
            <div class="detail-row">
                <span class="detail-label">{m.marketplace_agentDetailSource()}</span>
                <span
                    class="detail-value truncate max-w-[200px]"
                    >{agent.githubPath}</span
                >
            </div>
        </div>
    </div>

    <!-- Quick Stats -->
    <div class="info-card stats-card">
        <div class="card-header">
            <BarChart2 size={16} class="text-[var(--color-brand-pink)] shrink-0" />
            <h3>{m.marketplace_agentDetailPerformance()}</h3>
        </div>
        <div class="performance-stats">
            <div class="perf-stat">
                <div class="perf-value">
                    {formatInstallCount(agent.installCount)}
                </div>
                <div class="perf-label">{m.marketplace_agentDetailTotalHires()}</div>
            </div>
            <div class="perf-stat">
                <div class="perf-value">
                    {new Date(
                        agent.createdAt,
                    ).toLocaleDateString()}
                </div>
                <div class="perf-label">{m.marketplace_agentDetailJoined()}</div>
            </div>
            <div class="perf-stat">
                <div class="perf-value">
                    {new Date(
                        agent.syncedAt,
                    ).toLocaleDateString()}
                </div>
                <div class="perf-label">{m.marketplace_agentDetailLastUpdated()}</div>
            </div>
        </div>
    </div>
</div>

<style>
    .overview-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 20px;
    }

    .info-card {
        background: rgba(24, 24, 27, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 16px;
        padding: 20px;
    }

    .card-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 16px;
    }

    .card-header h3 {
        font-size: 14px;
        font-weight: 700;
        color: #fafafa;
        margin: 0;
    }

    .card-body {
        font-size: 13px;
        line-height: 1.7;
        color: #a1a1aa;
        margin: 0;
    }

    .details-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .detail-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }

    .detail-row:last-child {
        padding-bottom: 0;
        border-bottom: none;
    }

    .detail-label {
        font-size: 12px;
        color: #71717a;
    }

    .detail-value {
        font-size: 12px;
        color: #fafafa;
        font-weight: 500;
    }

    .model-tag {
        padding: 2px 10px;
        background: rgba(6, 182, 212, 0.1);
        color: #06b6d4;
        border-radius: 4px;
        border: 1px solid rgba(6, 182, 212, 0.2);
    }

    .performance-stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
    }

    .perf-stat {
        text-align: center;
    }

    .perf-value {
        font-size: 16px;
        font-weight: 700;
        color: #fafafa;
        margin-bottom: 4px;
        font-family: "JetBrains Mono NF", monospace;
    }

    .perf-label {
        font-size: 10px;
        color: #71717a;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }

    @media (max-width: 640px) {
        .performance-stats {
            grid-template-columns: 1fr;
            gap: 12px;
        }

        .perf-stat {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
    }
</style>
