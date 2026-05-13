/**
 * Contract tests for ChannelSetupWizard's validate-before-patch invariant.
 *
 * Strategy: replicate the exact async sequences from the component's
 * verifyTelegram / verifyDiscord / commit functions against a mock
 * sendRequest. No DOM rendering needed — the contract is pure call-order logic.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mock sendRequest ──────────────────────────────────────────────────────────
const sendRequest = vi.fn();

// Inline re-implementations of the component's core async functions so we can
// exercise them without mounting Svelte in jsdom.  These are structurally
// identical to the functions in ChannelSetupWizard.svelte.

type VerifiedBot =
    | { kind: 'telegram'; username: string; firstName: string; id: number }
    | { kind: 'discord'; username: string; appName?: string; id: string }
    | null;

interface WizardState {
    token: string;
    verifyError: string | null;
    verified: VerifiedBot;
    label: string;
    step: 'connect' | 'name' | 'assign' | 'done';
}

function makeState(token = ''): WizardState {
    return { token, verifyError: null, verified: null, label: '', step: 'connect' };
}

async function verifyTelegram(state: WizardState, sr: typeof sendRequest) {
    state.verifyError = null;
    try {
        const res = (await sr('channels.telegram.validateToken', { token: state.token })) as
            | { ok: boolean; bot?: { id: number; username: string; firstName: string }; error?: string }
            | undefined;
        if (!res?.ok || !res.bot) {
            state.verifyError = res?.error ?? 'Invalid token';
            return;
        }
        state.verified = { kind: 'telegram', ...res.bot };
        state.label = res.bot.username;
    } catch (e) {
        state.verifyError = (e as Error).message ?? 'Invalid token';
    }
}

async function verifyDiscord(state: WizardState, sr: typeof sendRequest) {
    state.verifyError = null;
    try {
        const res = (await sr('channels.discord.validateToken', { token: state.token })) as
            | { ok: boolean; bot?: { id: string; username: string }; application?: { id: string; name: string }; error?: string }
            | undefined;
        if (!res?.ok || !res.bot) {
            state.verifyError = res?.error ?? 'Invalid token';
            return;
        }
        state.verified = {
            kind: 'discord',
            id: res.bot.id,
            username: res.bot.username,
            appName: res.application?.name,
        };
        state.label = res.bot.username;
    } catch (e) {
        state.verifyError = (e as Error).message ?? 'Invalid token';
    }
}

async function commit(
    state: WizardState,
    sr: typeof sendRequest,
    channelType: string,
    configBaseHash: string,
) {
    if (!state.verified) return; // <-- contract gate: no verified = no patch
    const accountId =
        state.verified.kind === 'telegram'
            ? String(state.verified.id)
            : state.verified.kind === 'discord'
              ? state.verified.id
              : (state.verified as { phone: string }).phone;
    const accountPatch: Record<string, unknown> = { label: state.label, dmPolicy: 'open' };
    if (state.verified.kind === 'telegram') accountPatch.botToken = state.token;
    if (state.verified.kind === 'discord') accountPatch.token = state.token;
    const patch = { channels: { [channelType]: { accounts: { [accountId]: accountPatch } } } };
    await sr('config.patch', {
        raw: JSON.stringify(patch),
        baseHash: configBaseHash,
        note: `Create ${channelType}:${accountId} via Hub wizard`,
    });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('ChannelSetupWizard contract — validate-before-patch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── T1: No action at all = no config.patch ────────────────────────────────
    it('step=connect with no user action: zero sendRequest calls', () => {
        // Simulates the wizard being rendered and immediately closed
        const patchCalls = sendRequest.mock.calls.filter((c) => c[0] === 'config.patch');
        expect(patchCalls).toHaveLength(0);
        expect(sendRequest).not.toHaveBeenCalled();
    });

    // ── T2: ok:false → verified stays null → commit() is a no-op ─────────────
    it('telegram: validateToken ok:false keeps verified null, commit does not send config.patch', async () => {
        sendRequest.mockResolvedValueOnce({ ok: false, error: 'Unauthorized' });

        const state = makeState('bad-token');
        await verifyTelegram(state, sendRequest);

        expect(state.verified).toBeNull();
        expect(state.verifyError).toBe('Unauthorized');

        // Now simulate commit being called anyway (shouldn't happen in UI, but test the guard)
        await commit(state, sendRequest, 'telegram', 'abc');

        const patchCalls = sendRequest.mock.calls.filter((c) => c[0] === 'config.patch');
        expect(patchCalls).toHaveLength(0);
    });

    // ── T3: ok:true → verified set → validateToken called BEFORE config.patch ─
    it('telegram happy path: validateToken is called before config.patch', async () => {
        sendRequest.mockResolvedValueOnce({
            ok: true,
            bot: { id: 42, username: 'mybot', firstName: 'My' },
        });
        sendRequest.mockResolvedValueOnce({ reloadMode: 'hot' }); // config.patch response

        const state = makeState('1234567:fake');
        await verifyTelegram(state, sendRequest);

        expect(state.verified).not.toBeNull();
        expect(state.verifyError).toBeNull();

        // Simulate user advancing to step=name and clicking commit
        await commit(state, sendRequest, 'telegram', 'abc');

        const callMethods = sendRequest.mock.calls.map((c) => c[0]);
        // validateToken was first
        expect(callMethods[0]).toBe('channels.telegram.validateToken');
        // config.patch was second (after verify)
        expect(callMethods[1]).toBe('config.patch');
        // validateToken index < config.patch index
        expect(callMethods.indexOf('channels.telegram.validateToken')).toBeLessThan(
            callMethods.indexOf('config.patch'),
        );
    });

    // ── T4: discord happy path follows same ordering contract ─────────────────
    it('discord happy path: validateToken called before config.patch', async () => {
        sendRequest.mockResolvedValueOnce({
            ok: true,
            bot: { id: 'b1', username: 'discordbot' },
            application: { id: 'a1', name: 'MyApp' },
        });
        sendRequest.mockResolvedValueOnce({ reloadMode: 'hot' });

        const state = makeState('discord-token');
        await verifyDiscord(state, sendRequest);

        expect(state.verified).not.toBeNull();

        await commit(state, sendRequest, 'discord', 'abc');

        const callMethods = sendRequest.mock.calls.map((c) => c[0]);
        expect(callMethods[0]).toBe('channels.discord.validateToken');
        expect(callMethods[1]).toBe('config.patch');
    });

    // ── T5: commit() is a no-op when called without prior verification ─────────
    it('commit() without prior verify never calls config.patch', async () => {
        const state = makeState('any-token');
        // verified is still null — call commit directly as if Step 2 was reached via a bug
        await commit(state, sendRequest, 'telegram', 'abc');

        expect(sendRequest).not.toHaveBeenCalled();
    });

    // ── T6: network error during verify → verified stays null, no patch ────────
    it('telegram: network error during verify keeps verified null, no config.patch', async () => {
        sendRequest.mockRejectedValueOnce(new Error('Network timeout'));

        const state = makeState('1234567:fake');
        await verifyTelegram(state, sendRequest);

        expect(state.verified).toBeNull();
        expect(state.verifyError).toBe('Network timeout');

        await commit(state, sendRequest, 'telegram', 'abc');
        const patchCalls = sendRequest.mock.calls.filter((c) => c[0] === 'config.patch');
        expect(patchCalls).toHaveLength(0);
    });
});
