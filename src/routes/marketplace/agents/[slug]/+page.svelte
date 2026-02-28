<script lang="ts">
    import { onMount } from "svelte";
    import { page } from "$app/stores";
    import { goto } from "$app/navigation";
    import { hostsState } from "$lib/state/hosts.svelte";
    import {
        loadAgent,
        installAgent,
        marketplaceState,
        parseTags,
        type MarketplaceAgent,
    } from "$lib/state/marketplace.svelte";
    import { diceBearAvatarUrl } from "$lib/utils/avatar";
    import * as m from "$lib/paraglide/messages";
    import {
        ArrowLeft, Search, Check, AlertCircle,
        UserPlus, FileText, Info, AlignLeft,
        ClipboardList, BarChart2,
    } from "lucide-svelte";

    const slug = $derived($page.params.slug);
    const initialTab = $derived(
        ($page.url.searchParams.get("tab") === "documents"
            ? "documents"
            : "overview") as Tab,
    );

    type Tab = "overview" | "documents";
    type DocTab = "soul" | "identity" | "context" | "skills";

    let agent = $state<MarketplaceAgent | null>(null);
    let loading = $state(true);
    let activeTab = $state<Tab>("overview");
    let activeDocTab = $state<DocTab>("soul");
    let selectedServerId = $state<string>("");
    let hireSuccess = $state(false);
    let hireError = $state<string | null>(null);
    let isHiring = $state(false);

    const tags = $derived(agent ? parseTags(agent.tags) : []);
    const avatarUrl = $derived(
        agent ? diceBearAvatarUrl(agent.avatarSeed) : "",
    );

    const docTabs: {
        id: DocTab;
        label: string;
        field: keyof MarketplaceAgent;
    }[] = [
        { id: "soul", label: "SOUL", field: "soulMd" },
        { id: "identity", label: "IDENTITY", field: "identityMd" },
        { id: "context", label: "CONTEXT", field: "contextMd" },
        { id: "skills", label: "SKILLS", field: "skillsMd" },
    ];

    onMount(async () => {
        activeTab = initialTab;
        if (hostsState.hosts.length > 0) {
            selectedServerId = hostsState.hosts[0].id;
        }

        const data = await loadAgent(slug as string);
        agent = data;
        loading = false;
    });

    // Simple markdown renderer
    function renderMd(md: string | null | undefined): string {
        if (!md)
            return `<p class="text-muted text-xs italic">${m.marketplace_agentDetailNoContent()}</p>`;
        return md
            .replace(
                /^#{3}\s+(.+)$/gm,
                '<h3 class="text-sm font-semibold text-foreground mt-4 mb-1">$1</h3>',
            )
            .replace(
                /^#{2}\s+(.+)$/gm,
                '<h2 class="text-base font-bold text-foreground mt-5 mb-2">$1</h2>',
            )
            .replace(
                /^#{1}\s+(.+)$/gm,
                '<h1 class="text-lg font-bold text-foreground mt-6 mb-2">$1</h1>',
            )
            .replace(
                /\*\*(.+?)\*\*/g,
                '<strong class="text-foreground font-semibold">$1</strong>',
            )
            .replace(/\*(.+?)\*/g, '<em class="text-muted italic">$1</em>')
            .replace(
                /`(.+?)`/g,
                '<code class="px-1 py-0.5 rounded bg-bg3 text-brand-pink text-[11px] font-mono">$1</code>',
            )
            .replace(
                /^[-*]\s+(.+)$/gm,
                '<li class="ml-4 text-xs text-foreground/80 list-disc list-outside">$1</li>',
            )
            .replace(/(<li.*<\/li>)/gs, '<ul class="my-2 space-y-1">$1</ul>')
            .replace(
                /\n{2,}/g,
                '</p><p class="text-xs text-foreground/80 leading-relaxed mb-2">',
            )
            .replace(/^(?!<[hulo])(.+)$/gm, "$1")
            .replace(/^(.+(?!\n))$/gm, (line) => {
                if (line.startsWith("<")) return line;
                return `<p class="text-xs text-foreground/80 leading-relaxed mb-2">${line}</p>`;
            });
    }

    async function handleHire() {
        if (!selectedServerId || !agent) return;
        hireError = null;
        hireSuccess = false;
        isHiring = true;

        const host = hostsState.hosts.find((h) => h.id === selectedServerId);
        const ok = await installAgent(
            agent.id,
            selectedServerId,
            host?.name,
            host?.url,
        );
        if (ok) {
            hireSuccess = true;
        } else {
            hireError = marketplaceState.installError;
        }
        isHiring = false;
    }

    function formatInstallCount(n: number | null): string {
        const count = n ?? 0;
        if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
        return String(count);
    }

    function getInitials(name: string): string {
        return name.slice(0, 2).toUpperCase();
    }

    function goBack() {
        goto("/marketplace/agents");
    }
</script>

<div class="flex flex-col min-h-full">
    <!-- Compact sticky toolbar -->
    <header class="sticky top-0 z-10 shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-border bg-bg2/80 backdrop-blur-sm">
        <button
            type="button"
            onclick={goBack}
            class="flex items-center gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer transition-colors text-xs"
        >
            <ArrowLeft size={13} />
            <span>{m.marketplace_agentDetailBack()}</span>
        </button>
        {#if agent}
            <span class="text-border/60">·</span>
            <span class="text-sm font-semibold tracking-tight truncate">{agent.name}</span>
        {/if}
    </header>

    <div class="agent-detail-page">
    {#if loading}
        <!-- Loading State -->
        <div class="loading-state">
            <div class="w-6 h-6 border-2 border-[var(--color-brand-pink)] border-t-transparent rounded-full animate-spin"></div>
            <p class="loading-text">{m.marketplace_agentDetailLoading()}</p>
        </div>
    {:else if !agent}
        <!-- Not Found -->
        <div class="not-found">
            <Search size={40} class="text-muted-foreground/30 mb-2" />
            <h2>{m.marketplace_agentDetailNotFound()}</h2>
            <p>{m.marketplace_agentDetailNotFoundHint()}</p>
            <button type="button" onclick={goBack} class="back-btn">
                {m.marketplace_agentDetailBack()}
            </button>
        </div>
    {:else}

        <!-- Hero Section - Corporate ID Style -->
        <div class="agent-hero">
            <!-- ID Badge Card -->
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
                            <span class="stat-label">Dept</span>
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

            <!-- Quick Actions Panel -->
            <div class="quick-actions-panel">
                <h2 class="panel-title">{m.marketplace_agentDetailHiringOptions()}</h2>

                <div class="action-section">
                    <span class="section-label">{m.marketplace_agentDetailDeployTo()}</span>
                    {#if hostsState.hosts.length === 0}
                        <div class="no-servers">
                            <p>{m.marketplace_agentDetailNoServers()}</p>
                            <a href="/" class="connect-link"
                                >{m.marketplace_agentDetailConnectFirst()}</a
                            >
                        </div>
                    {:else}
                        <select
                            bind:value={selectedServerId}
                            class="server-select"
                        >
                            {#each hostsState.hosts as host}
                                <option value={host.id}
                                    >{host.name} — {host.url}</option
                                >
                            {/each}
                        </select>
                    {/if}
                </div>

                {#if hireSuccess}
                    <div class="success-message">
                        <span class="success-icon"><Check size={14} /></span>
                        <div>
                            <strong>{m.marketplace_agentDetailHiredSuccess()}</strong>
                            <p>{m.marketplace_agentDetailHiredSuccessHint({ name: agent.name })}</p>
                        </div>
                    </div>
                {/if}

                {#if hireError}
                    <div class="error-message">
                        <span class="error-icon"><AlertCircle size={13} /></span>
                        <p>{hireError}</p>
                    </div>
                {/if}

                <button
                    type="button"
                    onclick={handleHire}
                    disabled={hostsState.hosts.length === 0 ||
                        isHiring ||
                        hireSuccess}
                    class="hire-cta-btn"
                >
                    {#if isHiring}
                        <span class="spinner"></span>
                        <span>{m.marketplace_agentDetailHiring()}</span>
                    {:else if hireSuccess}
                        <span>{m.marketplace_agentDetailHired()}</span>
                    {:else}
                        <UserPlus size={16} />
                        <span>{m.marketplace_agentDetailHireBtn({ name: agent.name })}</span>
                    {/if}
                </button>

                <div class="tags-section">
                    <span class="section-label">{m.marketplace_agentDetailSkillsTags()}</span>
                    <div class="tags-list">
                        {#each tags as tag}
                            <span class="tag">{tag}</span>
                        {/each}
                    </div>
                </div>
            </div>
        </div>

        <!-- Tab Navigation -->
        <div class="tab-bar">
            {#each ["overview", "documents"] as const as tab}
                <button
                    type="button"
                    onclick={() => {
                        activeTab = tab;
                    }}
                    class="tab-btn"
                    class:active={activeTab === tab}
                >
                    {#if tab === "documents"}
                        <FileText size={13} />
                        <span>{m.marketplace_agentDetailTabDocuments()}</span>
                    {:else}
                        <Info size={13} />
                        <span>{m.marketplace_agentDetailTabOverview()}</span>
                    {/if}
                </button>
            {/each}
        </div>

        <!-- Tab Content -->
        <div class="tab-content">
            {#if activeTab === "overview"}
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
            {:else if activeTab === "documents"}
                <div class="documents-section">
                    <!-- Doc Tabs -->
                    <div class="doc-tabs">
                        {#each docTabs as dt}
                            <button
                                type="button"
                                onclick={() => {
                                    activeDocTab = dt.id;
                                }}
                                class="doc-tab"
                                class:active={activeDocTab === dt.id}
                            >
                                {dt.label}
                            </button>
                        {/each}
                    </div>

                    <!-- Doc Content -->
                    <div class="doc-content">
                        {#each docTabs as dt}
                            {#if activeDocTab === dt.id}
                                <div class="markdown-content">
                                    {@html renderMd(
                                        agent[dt.field] as string | null,
                                    )}
                                </div>
                            {/if}
                        {/each}
                    </div>
                </div>
            {/if}
        </div>
    {/if}
    </div>
</div>

<style>
    .agent-detail-page {
        max-width: 1000px;
        margin: 0 auto;
        padding: 24px 32px 48px;
        min-height: 100%;
    }

    /* Loading State */
    .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 100px 20px;
        gap: 12px;
    }

    .loading-text {
        font-size: 13px;
        color: #71717a;
    }

    /* Not Found */
    .not-found {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 100px 20px;
        text-align: center;
        gap: 8px;
    }

    .not-found h2 {
        font-size: 24px;
        font-weight: 700;
        color: #fafafa;
        margin: 0 0 8px;
    }

    .not-found p {
        font-size: 14px;
        color: #71717a;
        margin: 0 0 24px;
    }

    .back-btn {
        padding: 10px 20px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        color: #a1a1aa;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .back-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #fafafa;
    }

    /* Hero Section */
    .agent-hero {
        display: grid;
        grid-template-columns: 320px 1fr;
        gap: 32px;
        margin-bottom: 32px;
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
        transition: opacity 0.3s ease;
    }

    .id-badge-card:hover .badge-glow {
        opacity: 1;
    }

    /* Quick Actions Panel */
    .quick-actions-panel {
        background: rgba(24, 24, 27, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 16px;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    .panel-title {
        font-size: 18px;
        font-weight: 700;
        color: #fafafa;
        margin: 0;
    }

    .action-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .section-label {
        font-size: 11px;
        font-weight: 600;
        color: #71717a;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }

    .no-servers {
        padding: 16px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px dashed rgba(255, 255, 255, 0.1);
        border-radius: 10px;
        text-align: center;
    }

    .no-servers p {
        font-size: 13px;
        color: #a1a1aa;
        margin: 0 0 8px;
    }

    .connect-link {
        font-size: 12px;
        color: #e8547a;
        text-decoration: none;
    }

    .connect-link:hover {
        text-decoration: underline;
    }

    .server-select {
        width: 100%;
        padding: 12px;
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 10px;
        color: #fafafa;
        font-size: 13px;
        cursor: pointer;
    }

    .server-select:focus {
        outline: none;
        border-color: rgba(232, 84, 122, 0.4);
    }

    .success-message {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px;
        background: rgba(34, 197, 94, 0.1);
        border: 1px solid rgba(34, 197, 94, 0.2);
        border-radius: 10px;
    }

    .success-icon {
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #22c55e;
        border-radius: 50%;
        color: white;
        font-size: 14px;
        font-weight: 700;
    }

    .success-message strong {
        display: block;
        color: #22c55e;
        font-size: 13px;
        margin-bottom: 2px;
    }

    .success-message p {
        margin: 0;
        font-size: 12px;
        color: #a1a1aa;
    }

    .error-message {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.2);
        border-radius: 10px;
        color: #ef4444;
        font-size: 12px;
    }

    .error-icon {
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #ef4444;
        border-radius: 50%;
        color: white;
        font-size: 12px;
        font-weight: 700;
    }

    .hire-cta-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 14px 24px;
        background: linear-gradient(135deg, #e8547a, #c44d6c);
        border: none;
        border-radius: 12px;
        color: white;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 4px 20px rgba(232, 84, 122, 0.3);
    }

    .hire-cta-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 6px 25px rgba(232, 84, 122, 0.5);
    }

    .hire-cta-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .spinner {
        width: 18px;
        height: 18px;
        border: 2px solid transparent;
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    .tags-section {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .tags-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .tag {
        padding: 6px 12px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 20px;
        font-size: 11px;
        color: #a1a1aa;
    }

    /* Tab Bar */
    .tab-bar {
        display: flex;
        gap: 4px;
        padding: 4px;
        background: rgba(24, 24, 27, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 12px;
        margin-bottom: 24px;
        width: fit-content;
    }

    .tab-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 20px;
        background: transparent;
        border: none;
        border-radius: 8px;
        color: #71717a;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .tab-btn:hover {
        color: #fafafa;
        background: rgba(255, 255, 255, 0.05);
    }

    .tab-btn.active {
        background: rgba(232, 84, 122, 0.15);
        color: #e8547a;
    }

    /* Tab Content */
    .tab-content {
        min-height: 300px;
    }

    /* Overview Grid */
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

    /* Documents Section */
    .documents-section {
        background: rgba(24, 24, 27, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 16px;
        overflow: hidden;
    }

    .doc-tabs {
        display: flex;
        gap: 2px;
        padding: 8px;
        background: rgba(0, 0, 0, 0.2);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .doc-tab {
        flex: 1;
        padding: 10px;
        background: transparent;
        border: none;
        border-radius: 8px;
        color: #71717a;
        font-size: 11px;
        font-weight: 600;
        font-family: "JetBrains Mono NF", monospace;
        cursor: pointer;
        transition: all 0.2s ease;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .doc-tab:hover {
        color: #fafafa;
        background: rgba(255, 255, 255, 0.05);
    }

    .doc-tab.active {
        background: rgba(232, 84, 122, 0.15);
        color: #e8547a;
    }

    .doc-content {
        padding: 24px;
        min-height: 300px;
    }

    .markdown-content :global(p) {
        font-size: 13px;
        line-height: 1.7;
        color: #a1a1aa;
        margin-bottom: 12px;
    }

    .markdown-content :global(h1),
    .markdown-content :global(h2),
    .markdown-content :global(h3) {
        color: #fafafa;
        margin-top: 20px;
        margin-bottom: 10px;
    }

    .markdown-content :global(ul) {
        margin: 12px 0;
        padding-left: 20px;
    }

    .markdown-content :global(li) {
        font-size: 13px;
        color: #a1a1aa;
        margin-bottom: 6px;
    }

    .markdown-content :global(code) {
        background: rgba(232, 84, 122, 0.1);
        color: #e8547a;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 12px;
    }

    /* Responsive */
    @media (max-width: 900px) {
        .agent-hero {
            grid-template-columns: 1fr;
            max-width: 400px;
            margin: 0 auto 32px;
        }

        .quick-actions-panel {
            order: -1;
        }
    }

    @media (max-width: 640px) {
        .agent-detail-page {
            padding: 16px;
        }

        .tab-btn {
            padding: 10px 14px;
            font-size: 12px;
        }

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
