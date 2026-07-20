<script lang="ts">
    import type { ChannelType } from '$lib/types/channels';
    import { CHANNEL_TYPE_LABELS } from '$lib/types/channels';
    import { sendRequest } from '$lib/services/gateway.svelte';
    import { configState, loadBaseHash } from '$lib/state/config/config.svelte';
    import { conn } from '$lib/state/gateway/connection.svelte';
    import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
    import WhatsAppQrPairing from './WhatsAppQrPairing.svelte';
    import { WIZARD_INTENTS, wizardSteps, type WizardIntent, type WizardStep } from './wizard-intent';
    import ChannelAssignmentPicker from './ChannelAssignmentPicker.svelte';
    import ChannelSyncStatus from './ChannelSyncStatus.svelte';
    import { findHistorySync } from '$lib/state/gateway';
    import { CircleCheck, CircleX, Eye, EyeOff } from 'lucide-svelte';
    import { Button, Input, Select, iconSizes } from '$lib/components/ui';
    import * as m from '$lib/paraglide/messages';

    interface Props {
        serverId: string;
        channelType: ChannelType;
        /** Where the wizard was opened from — the trigger carries the intent.
         *  'operator' = wiring a business channel for the org (default, unchanged).
         *  'personal' = a person connecting their OWN account (/account/connections). */
        intent?: WizardIntent;
        onclose: () => void;
    }
    let { serverId, channelType, intent = 'operator', onclose }: Props = $props();

    type Step = WizardStep | 'done';
    let step = $state<Step>('connect');
    const mode = $derived(WIZARD_INTENTS[intent]);
    /** Steps for THIS intent + channel (WhatsApp gains a terminal `sync`). */
    const steps = $derived(wizardSteps(intent, channelType));

    // Step 1 state
    let token = $state('');
    let revealToken = $state(false);
    let verifying = $state(false);
    let verifyError = $state<string | null>(null);
    let verified = $state<
        | { kind: 'telegram'; username: string; firstName: string; id: number }
        | { kind: 'discord'; username: string; appName?: string; id: string }
        | { kind: 'whatsapp'; phone: string }
        | null
    >(null);

    /** Live history-sync for the account just paired, straight off channels.status. */
    const sync = $derived(
        findHistorySync(channelType, verified?.kind === 'whatsapp' ? verified.phone : null),
    );

    // Step 2 state
    let label = $state('');
    // Seeded once from the intent, then user-editable (operator mode) — a $derived
    // here would wipe the operator's choice on every re-render.
    // svelte-ignore state_referenced_locally
    let dmPolicy = $state<'open' | 'pairing' | 'disabled'>(WIZARD_INTENTS[intent].dmPolicy);

    // Step 3 state
    let committedChannelId = $state<string | null>(null);

    async function verifyTelegram() {
        verifying = true;
        verifyError = null;
        try {
            const res = (await sendRequest('channels.telegram.validateToken', { token })) as
                | { ok: boolean; bot?: { id: number; username: string; firstName: string }; error?: string }
                | undefined;
            if (!res?.ok || !res.bot) {
                verifyError = res?.error ?? m.channelWizard_tokenInvalid();
                return;
            }
            verified = { kind: 'telegram', ...res.bot };
            label = res.bot.username;
        } catch (e) {
            verifyError = (e as Error).message ?? m.channelWizard_tokenInvalid();
        } finally {
            verifying = false;
        }
    }

    async function verifyDiscord() {
        verifying = true;
        verifyError = null;
        try {
            const res = (await sendRequest('channels.discord.validateToken', { token })) as
                | {
                      ok: boolean;
                      bot?: { id: string; username: string };
                      application?: { id: string; name: string };
                      error?: string;
                  }
                | undefined;
            if (!res?.ok || !res.bot) {
                verifyError = res?.error ?? m.channelWizard_tokenInvalid();
                return;
            }
            verified = {
                kind: 'discord',
                id: res.bot.id,
                username: res.bot.username,
                appName: res.application?.name,
            };
            label = res.bot.username;
        } catch (e) {
            verifyError = (e as Error).message ?? m.channelWizard_tokenInvalid();
        } finally {
            verifying = false;
        }
    }

    function handleWhatsAppPaired(phone: string) {
        verified = { kind: 'whatsapp', phone };
        label = phone;
        step = 'name';
    }

    /** Map the wizard's dmPolicy choice to the DB's replies/allowFrom columns —
     *  same derivation ChannelCard's behavior selector uses (replies checked FIRST,
     *  it's the master kill-switch; allowFrom only matters when replies:'bound'). */
    function accessFieldsFor(policy: 'open' | 'pairing' | 'disabled'): {
        replies: 'none' | 'bound';
        allowFrom: string[];
    } {
        if (policy === 'disabled') return { replies: 'none', allowFrom: [] };
        if (policy === 'open') return { replies: 'bound', allowFrom: ['*'] };
        return { replies: 'bound', allowFrom: [] }; // 'pairing' — closed until a sender pairs
    }

    /** config.patch needs a baseHash — and ONLY a baseHash, so this asks for
     *  config.get alone (loadBaseHash). Going through loadConfig() also fired
     *  config.schema, whose gateway-side work regularly exceeds 8s and queued
     *  config.get behind it on the same socket until it timed out too.
     *  The retry covers the other real case: the socket is down for a few seconds
     *  after any gateway restart, including the one a fresh pairing triggers. */
    async function ensureBaseHash(): Promise<boolean> {
        if (configState.baseHash) return true;
        if (await loadBaseHash()) return true;
        await new Promise((r) => setTimeout(r, 2000));
        return !!(await loadBaseHash());
    }

    async function commit() {
        if (!verified) return;
        if (!(await ensureBaseHash())) {
            // loadBaseHash() stores the cause in configState.loadError — surface it
            // instead of the generic string, which sent us chasing the wrong bug twice.
            toastError(
                'Save failed',
                conn.connected
                    ? (configState.loadError ?? 'Could not load config.')
                    : 'Lost the gateway connection — reconnect and try again.',
            );
            return;
        }
        const accountId =
            verified.kind === 'telegram'
                ? String(verified.id)
                : verified.kind === 'discord'
                  ? verified.id
                  : verified.phone;

        // 1) DB create FIRST (access fields live here now — Phase 4). If this fails,
        // no gateway.json account is written, so nothing is left half-configured.
        const { replies, allowFrom } = accessFieldsFor(dmPolicy);
        let channelId: string;
        try {
            const res = await fetch(`/api/servers/${serverId}/channels`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    type: channelType,
                    label,
                    accountId,
                    replies,
                    allowFrom,
                    personal: mode.personal,
                }),
            });
            const data = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string };
            if (!res.ok || data.ok === false || !data.id) {
                throw new Error(data.error ?? `HTTP ${res.status}`);
            }
            channelId = data.id;
        } catch (e) {
            toastError('Save failed', e instanceof Error ? e.message : 'Unknown error');
            return;
        }

        // 2) gateway.json patch — transport fields ONLY. The gateway account schemas
        // are strict and use `name` (not `label`) for the display name — an unknown
        // `label` key is rejected. Access rules (dmPolicy/allowFrom) no longer go
        // here; they reach the gateway via the channel-publish mirror (above).
        const accountPatch: Record<string, unknown> = { name: label };
        if (verified.kind === 'telegram') accountPatch.botToken = token;
        if (verified.kind === 'discord') accountPatch.token = token;
        const patch = { channels: { [channelType]: { accounts: { [accountId]: accountPatch } } } };
        try {
            const result = (await sendRequest('config.patch', {
                raw: JSON.stringify(patch),
                baseHash: configState.baseHash,
                note: `Create ${channelType}:${accountId} via Hub wizard`,
            })) as { reloadMode?: string } | undefined;
            void result; // reloadMode is informational — restart happens in background; user still advances to Step 3
            await loadBaseHash(); // refresh baseHash for any follow-up patch (schema not needed)
            committedChannelId = channelId;
            toastSuccess(`Created ${CHANNEL_TYPE_LABELS[channelType]}: ${label}`);
            step = steps.includes('assign') ? 'assign' : steps.includes('sync') ? 'sync' : 'done';
        } catch (e) {
            await loadBaseHash(); // refresh baseHash so a retry isn't stale
            toastError('Save failed', (e as Error).message);
        }
    }

    function startVerify() {
        if (channelType === 'telegram') verifyTelegram();
        else if (channelType === 'discord') verifyDiscord();
    }
</script>

<div class="bg-card border border-border rounded-lg p-5 space-y-4">
    <!-- Stepper -->
    <div class="flex items-center gap-2 text-xs">
        {#each steps as s, i}
            <div
                class="flex items-center gap-1.5
                {step === s ? 'text-foreground font-semibold' : 'text-muted-foreground'}"
            >
                <span
                    class="w-5 h-5 rounded-full flex items-center justify-center text-xs
                    {step === s ? 'bg-accent text-accent-foreground' : 'bg-bg3'}">{i + 1}</span
                >
                {#if s === 'connect'}{m.channelWizard_stepConnect()}{/if}
                {#if s === 'name'}{m.channelWizard_stepName()}{/if}
                {#if s === 'assign'}{m.channelWizard_stepAssign()}{/if}
                {#if s === 'sync'}{m.channelWizard_stepSync()}{/if}
            </div>
            {#if i < steps.length - 1}<span class="text-muted-strong">›</span>{/if}
        {/each}
    </div>

    <!-- Step 1: Connect -->
    {#if step === 'connect'}
        {#if channelType === 'whatsapp'}
            <p class="text-xs text-muted-foreground">{m.channelWizard_whatsappHint()}</p>
            <WhatsAppQrPairing
                channelId="pending"
                {serverId}
                onpaired={(phone: string) => handleWhatsAppPaired(phone)}
            />
        {:else if !verified}
            <p class="text-xs text-muted-foreground">
                {channelType === 'telegram'
                    ? m.channelWizard_telegramHint()
                    : m.channelWizard_discordHint()}
            </p>
            <div class="relative">
                <input
                    type={revealToken ? 'text' : 'password'}
                    bind:value={token}
                    placeholder="Token"
                    class="w-full bg-bg border border-border rounded-md px-3 py-2 pr-9 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                    autocomplete="off"
                    onkeydown={(e) => {
                        if (e.key === 'Enter' && token && !verifying) startVerify();
                    }}
                />
                <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    class="absolute right-0.5 top-1/2 -translate-y-1/2"
                    onclick={() => (revealToken = !revealToken)}
                    aria-label={revealToken ? 'Hide token' : 'Show token'}
                >
                    {#if revealToken}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
                </Button>
            </div>
            {#if verifyError}
                <div class="flex items-start gap-2 text-xs text-destructive">
                    <CircleX size={14} class="shrink-0 mt-0.5" />
                    <span>{verifyError}</span>
                </div>
            {/if}
            <Button
                type="button"
                variant="primary"
                loading={verifying}
                disabled={!token}
                onclick={startVerify}
            >
                {verifying ? m.channelWizard_verifying() : m.channelWizard_verifyToken()}
            </Button>
        {:else}
            <!-- Confirmation card -->
            <div
                class="flex items-start gap-3 p-3 bg-success/10 border border-success/30 rounded-md"
            >
                <CircleCheck size={18} class="text-success shrink-0 mt-0.5" />
                <div class="flex-1 min-w-0 text-xs space-y-0.5">
                    <p class="font-semibold text-foreground">{m.channelWizard_verified()}</p>
                    {#if verified.kind === 'telegram'}
                        <p class="text-muted-foreground">
                            @{verified.username} · {verified.firstName} · id {verified.id}
                        </p>
                    {:else if verified.kind === 'discord'}
                        <p class="text-muted-foreground">
                            {verified.username} · id {verified.id}{#if verified.appName} · app
                                {verified.appName}{/if}
                        </p>
                    {/if}
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onclick={() => {
                        verified = null;
                        verifyError = null;
                    }}
                >
                    {m.channelWizard_retry()}
                </Button>
            </div>
            <div class="flex gap-2">
                <Button type="button" variant="primary" onclick={() => (step = 'name')}>
                    {m.channelWizard_next()}
                </Button>
                <Button type="button" variant="secondary" onclick={onclose}>
                    {m.channelWizard_close()}
                </Button>
            </div>
        {/if}

        <!-- Step 2: Name -->
    {:else if step === 'name'}
        <div class="space-y-3">
            <Input id="wizard-label" type="text" label="Label" bind:value={label} />
            {#if mode.asksDmPolicy}
            <div>
                <label for="wizard-dm" class="text-xs font-medium text-muted-foreground block mb-1"
                    >DM policy</label
                >
                <Select id="wizard-dm" bind:value={dmPolicy} size="md">
                    <option value="open">open — anyone can DM</option>
                    <option value="pairing">pairing — must pair first</option>
                    <option value="disabled">disabled — DMs disabled</option>
                </Select>
            </div>
            {/if}
        </div>
        <div class="flex gap-2">
            <Button type="button" variant="secondary" onclick={() => (step = 'connect')}>
                {m.channelWizard_back()}
            </Button>
            <Button type="button" variant="primary" onclick={commit} disabled={!label}>
                {m.channelWizard_next()}
            </Button>
        </div>

        <!-- Step 3: Assign -->
    {:else if step === 'assign' && committedChannelId}
        <div>
            <h4 class="text-xs font-semibold uppercase tracking-wider mb-2">
                {m.channelWizard_stepAssign()}
            </h4>
            <ChannelAssignmentPicker {serverId} channelId={committedChannelId} />
        </div>
        {#if steps.includes('sync')}
            <Button type="button" variant="primary" onclick={() => (step = 'sync')}>
                {m.channelWizard_next()}
            </Button>
        {:else}
            <Button type="button" variant="primary" onclick={onclose}>
                {m.channelWizard_finish()}
            </Button>
        {/if}

        <!-- Terminal Sync step — pairing is the START of the work. WhatsApp keeps
             streaming history from the PHONE for minutes; closing this dialog does
             not stop it, and a sleeping phone stalls it. -->
    {:else if step === 'sync'}
        <div class="flex items-start gap-3 p-3 bg-success/10 border border-success/30 rounded-md">
            <CircleCheck size={iconSizes.md} class="text-success shrink-0 mt-0.5" />
            <p class="text-xs text-foreground">
                {m.channelWizard_linkedAccount({ account: label })}
            </p>
        </div>
        <ChannelSyncStatus {sync} />
        <Button type="button" variant="primary" onclick={onclose}>
            {m.channelSync_doneKeepSyncing()}
        </Button>

        <!-- Done (personal intent — no assign step) -->
    {:else if step === 'done'}
        <div class="flex items-start gap-3 p-3 bg-success/10 border border-success/30 rounded-md">
            <CircleCheck size={iconSizes.sm} class="text-success shrink-0 mt-0.5" />
            <p class="text-xs text-foreground">{m.channelWizard_verified()} · {label}</p>
        </div>
        <Button type="button" variant="primary" onclick={onclose}>
            {m.channelWizard_finish()}
        </Button>
    {/if}
</div>
