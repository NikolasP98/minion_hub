<script lang="ts">
    import type { ChannelType } from '$lib/types/channels';
    import { CHANNEL_TYPE_LABELS } from '$lib/types/channels';
    import { sendRequest } from '$lib/services/gateway.svelte';
    import { configState, loadConfig } from '$lib/state/config/config.svelte';
    import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
    import WhatsAppQrPairing from './WhatsAppQrPairing.svelte';
    import ChannelAssignmentPicker from './ChannelAssignmentPicker.svelte';
    import { CircleCheck, CircleX, Eye, EyeOff } from 'lucide-svelte';
    import { Button } from '$lib/components/ui';
    import * as m from '$lib/paraglide/messages';

    interface Props {
        serverId: string;
        channelType: ChannelType;
        onclose: () => void;
    }
    let { serverId, channelType, onclose }: Props = $props();

    type Step = 'connect' | 'name' | 'assign' | 'done';
    let step = $state<Step>('connect');

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

    // Step 2 state
    let label = $state('');
    let dmPolicy = $state<'open' | 'pairing' | 'disabled'>('open');

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

    async function commit() {
        if (!verified) return;
        if (!configState.baseHash) await loadConfig();
        if (!configState.baseHash) {
            toastError('Save failed', 'Could not load config.');
            return;
        }
        const accountId =
            verified.kind === 'telegram'
                ? String(verified.id)
                : verified.kind === 'discord'
                  ? verified.id
                  : verified.phone;
        // The gateway account schemas are strict and use `name` (not `label`)
        // for the display name — an unknown `label` key is rejected.
        const accountPatch: Record<string, unknown> = { name: label, dmPolicy };
        // dmPolicy "open" is invalid unless allowFrom explicitly includes "*"
        // (the gateway config schema enforces this for every channel).
        if (dmPolicy === 'open') accountPatch.allowFrom = ['*'];
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
            await loadConfig();
            committedChannelId = `gw:${channelType}:${accountId}`;
            toastSuccess(`Created ${CHANNEL_TYPE_LABELS[channelType]}: ${label}`);
            step = 'assign';
        } catch (e) {
            try { await loadConfig(); } catch { /* refresh baseHash for retry */ }
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
        {#each ['connect', 'name', 'assign'] as s, i}
            <div
                class="flex items-center gap-1.5
                {step === s ? 'text-foreground font-semibold' : 'text-muted-foreground'}"
            >
                <span
                    class="w-5 h-5 rounded-full flex items-center justify-center text-[10px]
                    {step === s ? 'bg-accent text-accent-foreground' : 'bg-bg3'}">{i + 1}</span
                >
                {#if s === 'connect'}{m.channelWizard_stepConnect()}{/if}
                {#if s === 'name'}{m.channelWizard_stepName()}{/if}
                {#if s === 'assign'}{m.channelWizard_stepAssign()}{/if}
            </div>
            {#if i < 2}<span class="text-muted-foreground/40">›</span>{/if}
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
                <button
                    type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onclick={() => (revealToken = !revealToken)}
                    aria-label={revealToken ? 'Hide token' : 'Show token'}
                >
                    {#if revealToken}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
                </button>
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
                <button
                    class="text-xs text-muted-foreground hover:text-foreground"
                    onclick={() => {
                        verified = null;
                        verifyError = null;
                    }}
                >
                    {m.channelWizard_retry()}
                </button>
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
            <div>
                <label
                    for="wizard-label"
                    class="text-xs font-medium text-muted-foreground block mb-1">Label</label
                >
                <input
                    id="wizard-label"
                    type="text"
                    bind:value={label}
                    class="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
            </div>
            <div>
                <label for="wizard-dm" class="text-xs font-medium text-muted-foreground block mb-1"
                    >DM policy</label
                >
                <select
                    id="wizard-dm"
                    bind:value={dmPolicy}
                    class="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm"
                >
                    <option value="open">open — anyone can DM</option>
                    <option value="pairing">pairing — must pair first</option>
                    <option value="disabled">disabled — DMs disabled</option>
                </select>
            </div>
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
        <Button type="button" variant="primary" onclick={onclose}>
            {m.channelWizard_finish()}
        </Button>
    {/if}
</div>
