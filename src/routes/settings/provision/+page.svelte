<script lang="ts">
    import { page } from "$app/state";
    import { goto } from "$app/navigation";
    import { onMount, onDestroy } from "svelte";
    import { isAdmin } from "$lib/state/features/user.svelte";
    import { hostsState, loadHosts } from "$lib/state/features/hosts.svelte";
    import {
        provisionState,
        fetchConfig,
        checkStatus,
        startProvision,
        stopProvision,
        resetState,
    } from "$lib/state/features/provision.svelte";
    import Topbar from "$lib/components/layout/Topbar.svelte";
    import ProvisionConfigForm from "$lib/components/provision/ProvisionConfigForm.svelte";
    import ProvisionStepper from "$lib/components/provision/ProvisionStepper.svelte";
    import ProvisionLogViewer from "$lib/components/provision/ProvisionLogViewer.svelte";
    import {
        ArrowLeft,
        Play,
        Square,
        RefreshCw,
        Loader2,
    } from "lucide-svelte";

    const serverId = $derived(page.url.searchParams.get("server") ?? "");

    const server = $derived(hostsState.hosts.find((h) => h.id === serverId));

    onMount(async () => {
        if (!isAdmin.value) {
            goto('/settings');
            return;
        }
        await loadHosts();
        if (serverId) {
            await fetchConfig(serverId);
            // Auto-check status if SSH host is configured
            if (provisionState.config.sshHost) {
                await checkStatus(serverId);
            }
        }
    });

    onDestroy(() => {
        resetState();
    });

    function handleRunFrom(phaseId: string) {
        if (serverId) startProvision(serverId, phaseId);
    }

    function handleRun() {
        if (!serverId) return;
        // Find first non-complete phase
        const firstIncomplete = provisionState.phases.find((p) => p.status !== 'complete');
        startProvision(serverId, firstIncomplete?.id);
    }
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden text-foreground">
    <Topbar />

    <!-- Sub-header -->
    <div class="shrink-0 border-b border-border bg-bg/80 backdrop-blur-sm px-4 py-2.5 flex items-center gap-3">
        <button
            type="button"
            class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border-none font-[inherit]"
            onclick={() => goto('/settings?s=hosts')}
        >
            <ArrowLeft size={14} />
            Back to Hosts
        </button>
        <div class="w-px h-4 bg-border"></div>
        <span class="text-sm font-medium text-foreground">
            {server?.name ?? 'Unknown Server'}
        </span>
        {#if server?.url}
            <span class="text-xs text-muted-foreground font-mono">{server.url}</span>
        {/if}

        <!-- Action buttons -->
        <div class="ml-auto flex items-center gap-2">
            <button
                type="button"
                class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-foreground bg-transparent cursor-pointer hover:bg-bg2 transition-colors disabled:opacity-50"
                disabled={provisionState.checking || provisionState.running || !provisionState.config.sshHost}
                onclick={() => checkStatus(serverId)}
            >
                {#if provisionState.checking}
                    <Loader2 size={13} class="animate-spin" />
                    Checking...
                {:else}
                    <RefreshCw size={13} />
                    Check Status
                {/if}
            </button>

            {#if provisionState.running}
                <button
                    type="button"
                    class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-destructive text-white border-none cursor-pointer hover:opacity-90"
                    onclick={stopProvision}
                >
                    <Square size={13} />
                    Stop
                </button>
            {:else}
                <button
                    type="button"
                    class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-accent-foreground border-none cursor-pointer hover:opacity-90 disabled:opacity-50"
                    disabled={!provisionState.config.sshHost}
                    onclick={handleRun}
                >
                    <Play size={13} />
                    Run
                </button>
            {/if}
        </div>
    </div>

    <!-- Error banner -->
    {#if provisionState.error}
        <div class="mx-4 mt-3 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-xs">
            {provisionState.error}
        </div>
    {/if}

    <!-- Main content -->
    <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="p-6 md:p-10">
            <div class="max-w-5xl mx-auto">
                {#if !serverId}
                    <div class="text-center py-12">
                        <p class="text-sm text-muted-foreground">No server selected.</p>
                        <button
                            type="button"
                            class="mt-2 text-xs text-accent hover:underline cursor-pointer bg-transparent border-none"
                            onclick={() => goto('/settings?s=hosts')}
                        >
                            Go to Hosts
                        </button>
                    </div>
                {:else}
                    <div class="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
                        <!-- Left column: Config + Stepper -->
                        <div class="space-y-6">
                            <ProvisionConfigForm {serverId} />

                            <div class="bg-card border border-border rounded-lg px-5 py-4">
                                <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">
                                    Provisioning Steps
                                </h3>
                                <ProvisionStepper onrunfrom={handleRunFrom} />
                            </div>
                        </div>

                        <!-- Right column: Log viewer -->
                        <div class="lg:sticky lg:top-0">
                            <ProvisionLogViewer />
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>
