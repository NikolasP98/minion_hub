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
    import ProvisionConfigForm from "$lib/components/provision/ProvisionConfigForm.svelte";
    import ProvisionStepper from "$lib/components/provision/ProvisionStepper.svelte";
    import ProvisionLogViewer from "$lib/components/provision/ProvisionLogViewer.svelte";
    import SettingsSkeleton from "$lib/components/settings/SettingsSkeleton.svelte";
    import {
        ArrowLeft,
        Play,
        Square,
        RefreshCw,
        Loader2,
    } from "lucide-svelte";
    import * as m from '$lib/paraglide/messages';
    import { Button, PageHeader } from '$lib/components/ui';

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

    <PageHeader
        title={server?.name ?? m.provision_unknownServer()}
        subtitle={server?.url}
        sticky={false}
    >
        {#snippet leading()}
          <Button variant="ghost" size="sm" onclick={() => goto('/settings/gateways')}>
            <ArrowLeft size={14} />
            {m.provision_backToHosts()}
          </Button>
        {/snippet}
        {#snippet secondaryActions()}
            <Button
                variant="secondary"
                size="sm"
                disabled={provisionState.checking || provisionState.running || !provisionState.config.sshHost}
                onclick={() => checkStatus(serverId)}
            >
                {#if provisionState.checking}
                    <Loader2 size={13} class="animate-spin" />
                    {m.provision_checking()}
                {:else}
                    <RefreshCw size={13} />
                    {m.provision_checkStatus()}
                {/if}
            </Button>
        {/snippet}
        {#snippet primaryActions()}
            {#if provisionState.running}
                <Button variant="danger" size="sm"
                    onclick={stopProvision}
                >
                    <Square size={13} />
                    {m.provision_stop()}
                </Button>
            {:else}
                <Button variant="primary" size="sm"
                    disabled={!provisionState.config.sshHost}
                    onclick={handleRun}
                >
                    <Play size={13} />
                    {m.provision_run()}
                </Button>
            {/if}
        {/snippet}
    </PageHeader>

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
                        <p class="text-sm text-muted-foreground">{m.provision_noServer()}</p>
                        <Button
                            variant="ghost"
                            size="sm"
                            class="mt-2"
                            onclick={() => goto('/settings/gateways')}
                        >
                            {m.provision_goToHosts()}
                        </Button>
                    </div>
                {:else if !provisionState.configLoaded}
                    <SettingsSkeleton />
                {:else}
                    <div class="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
                        <!-- Left column: Config + Stepper -->
                        <div class="space-y-6">
                            <ProvisionConfigForm {serverId} />

                            <div class="bg-card border border-border rounded-lg px-5 py-4">
                                <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">
                                    {m.provision_steps()}
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
