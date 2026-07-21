<script lang="ts">
    /**
     * WhatsApp history-sync readout. Two densities of the SAME state:
     *   compact  — one line + a 4px bar, for surfaces that already show the
     *              status pill (ChannelCard, /account/connections).
     *   full     — wizard terminal step: phase, bar, counts, and the actionable
     *              advice for the stalled case.
     *
     * `historySync` may be undefined (older gateway / history disabled). That is
     * "no info", not an error — compact renders nothing, full says so plainly.
     */
    import type { ChannelHistorySync } from '$lib/types/channels';
    import { ProgressBar, Spinner, iconSizes } from '$lib/components/ui';
    import { PauseCircle, RefreshCw, CircleCheck, Smartphone, Database } from 'lucide-svelte';
    import * as m from '$lib/paraglide/messages';

    interface Props {
        sync: ChannelHistorySync | undefined;
        compact?: boolean;
        /** Accepted for caller compatibility; persistence is account-scoped in the authenticated org. */
        serverId?: string;
        accountId?: string | null;
    }
    let { sync, compact = false, accountId }: Props = $props();

    let persisted = $state<number | null>(null);
    let persistenceUnavailable = $state(false);
    let persistenceLoading = $state(false);

    // Message refs, NOT calls — a module-scope m.x() in a .ts const bakes 'en' at SSR.
    const PHASE_LABELS: Record<ChannelHistorySync['phase'], () => string> = {
        idle: m.channelSync_phaseIdle,
        bootstrap: m.channelSync_phaseBootstrap,
        recent: m.channelSync_phaseRecent,
        full: m.channelSync_phaseFull,
        'on-demand': m.channelSync_phaseOnDemand,
        complete: m.channelSync_phaseComplete,
        stalled: m.channelSync_phaseStalled,
    };

    const phase = $derived(sync?.phase ?? 'idle');
    const stalled = $derived(phase === 'stalled');
    const done = $derived(phase === 'complete');
    // `explicit: false` means completion was INFERRED from silence — WhatsApp
    // never said "done". Saying so is the whole point; a bare ✓ would lie.
    const inferred = $derived(done && sync?.explicit === false);
    const label = $derived(
        inferred ? m.channelSync_phaseCompleteInferred() : PHASE_LABELS[phase](),
    );
    const counts = $derived(
        m.channelSync_counts({
            messages: (sync?.messages ?? 0).toLocaleString(),
            chats: (sync?.chats ?? 0).toLocaleString(),
        }),
    );
    const Icon = $derived(stalled ? PauseCircle : done ? CircleCheck : RefreshCw);
    const tone = $derived(stalled ? 'warning' : done ? 'success' : 'accent');
    const canConfirmPersistence = $derived(
        !!accountId && sync?.startedAt != null && phase !== 'idle',
    );

    // Baileys activity and durable ingestion are deliberately separate. Poll the
    // org-scoped Hub DB for rows committed since this sync session began; never
    // derive "saved" from the gateway progress bar or the local outbox.
    $effect(() => {
        const account = accountId;
        const since = sync?.startedAt;
        const terminal = done;
        if (!account || since == null || phase === 'idle') {
            persisted = null;
            persistenceUnavailable = false;
            persistenceLoading = false;
            return;
        }

        let cancelled = false;
        let inFlight = false;
        let firstLoad = true;
        const load = async () => {
            if (inFlight) return;
            inFlight = true;
            if (firstLoad) persistenceLoading = true;
            try {
                const params = new URLSearchParams({
                    channel: 'whatsapp',
                    accountId: account,
                    since: String(since),
                });
                const response = await fetch(`/api/messages/stats?${params}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = (await response.json()) as { persisted?: unknown };
                if (typeof data.persisted !== 'number') throw new Error('Invalid persistence stats');
                if (!cancelled) {
                    persisted = data.persisted;
                    persistenceUnavailable = false;
                }
            } catch {
                if (!cancelled) persistenceUnavailable = true;
            } finally {
                if (!cancelled) persistenceLoading = false;
                inFlight = false;
                firstLoad = false;
            }
        };

        void load();
        if (terminal)
            return () => {
                cancelled = true;
            };
        const timer = setInterval(() => void load(), 5_000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    });
</script>

{#if compact}
    {#if sync && phase !== 'idle' && phase !== 'complete'}
        <div class="flex flex-col gap-1">
            <div class="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                <Icon
                    size={iconSizes.xs}
                    class="shrink-0 {stalled ? 'text-warning' : 'text-accent'}"
                />
                <span class="truncate {stalled ? 'text-warning' : ''}">{label}</span>
                <span class="ml-auto shrink-0 tabular-nums">{counts}</span>
            </div>
            <ProgressBar value={sync.progress} label={m.channelSync_receivedFromWhatsApp()} size="sm" />
            {#if canConfirmPersistence}
                <div class="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                    <Database size={iconSizes.xs} class="shrink-0 text-success" />
                    <span class="truncate">{m.channelSync_savedToHub()}</span>
                    <span class="ml-auto shrink-0 tabular-nums">
                        {#if persisted !== null}
                            {m.channelSync_savedCount({ messages: persisted.toLocaleString() })}
                        {:else if persistenceLoading}
                            <Spinner size="xs" label={m.channelSync_savedChecking()} />
                        {:else if persistenceUnavailable}
                            {m.channelSync_savedUnavailable()}
                        {/if}
                    </span>
                </div>
            {/if}
        </div>
    {/if}
{:else if !sync}
    <p class="text-xs text-muted-foreground">{m.channelSync_noInfo()}</p>
{:else}
    <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2 text-sm">
            <Icon
                size={iconSizes.sm}
                class="shrink-0 {tone === 'warning'
                    ? 'text-warning'
                    : tone === 'success'
                      ? 'text-success'
                      : 'text-accent'}"
            />
            <span class="font-medium text-foreground">{label}</span>
        </div>
        {#if !done}
            <ProgressBar
                value={sync.progress}
                label={m.channelSync_receivedFromWhatsApp()}
                detail={counts}
                size="md"
            />
        {:else}
            <p class="text-xs text-muted-foreground tabular-nums">{counts}</p>
        {/if}
        {#if canConfirmPersistence}
            <div class="flex flex-col gap-1 rounded-md border border-border bg-bg2 p-2.5">
                <div class="flex items-center gap-2 text-xs">
                    <Database size={iconSizes.sm} class="shrink-0 text-success" />
                    <span class="font-medium text-foreground">{m.channelSync_savedToHub()}</span>
                    <span class="ml-auto tabular-nums text-muted-foreground">
                        {#if persisted !== null}
                            {m.channelSync_savedCount({ messages: persisted.toLocaleString() })}
                        {:else if persistenceLoading}
                            <Spinner size="xs" label={m.channelSync_savedChecking()} />
                        {:else if persistenceUnavailable}
                            {m.channelSync_savedUnavailable()}
                        {/if}
                    </span>
                </div>
                <p class="text-xs text-muted-foreground">{m.channelSync_savedHint()}</p>
            </div>
        {/if}
        {#if stalled}
            <div
                class="flex items-start gap-2 p-2.5 rounded-md bg-warning/15 text-warning border border-warning/30"
            >
                <Smartphone size={iconSizes.sm} class="shrink-0 mt-0.5" />
                <p class="text-xs">{m.channelSync_stalledHelp()}</p>
            </div>
        {:else if !done}
            <p class="text-xs text-muted-foreground">{m.channelSync_keepPhoneOpen()}</p>
        {/if}
        <p class="text-xs text-muted-strong">{m.channelSync_sessionOnly()}</p>
    </div>
{/if}
