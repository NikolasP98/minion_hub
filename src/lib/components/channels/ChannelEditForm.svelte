<script lang="ts">
    import type { ChannelType } from '$lib/types/channels';
    import * as m from '$lib/paraglide/messages';

    interface Props {
        initialLabel: string;
        initialMeta: Record<string, string>;
        channelType: ChannelType;
        onsave: (data: { label: string; credentialsMeta: Record<string, string> }) => void;
        oncancel: () => void;
    }

    let { initialLabel, initialMeta, onsave, oncancel }: Props = $props();

    let label = $state(initialLabel);
    let dmPolicy = $state(initialMeta.dmPolicy ?? 'open');
    let allowFrom = $state(initialMeta.allowFrom ?? '');

    function handleSubmit() {
        const meta: Record<string, string> = { ...initialMeta, dmPolicy };
        if (allowFrom) {
            meta.allowFrom = allowFrom;
        } else {
            delete meta.allowFrom;
        }
        onsave({ label, credentialsMeta: meta });
    }
</script>

<form class="space-y-3" onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
    <div>
        <label for="edit-label" class="text-xs font-medium text-muted-foreground block mb-1">{m.channel_label()}</label>
        <input
            id="edit-label"
            type="text"
            bind:value={label}
            required
            class="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
    </div>
    <div>
        <label for="edit-dm" class="text-xs font-medium text-muted-foreground block mb-1">DM policy</label>
        <select id="edit-dm" bind:value={dmPolicy} class="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm">
            <option value="open">open</option>
            <option value="pairing">pairing</option>
            <option value="closed">closed</option>
        </select>
    </div>
    <div>
        <label for="edit-allow" class="text-xs font-medium text-muted-foreground block mb-1">Allow from (comma-separated)</label>
        <input
            id="edit-allow"
            type="text"
            bind:value={allowFrom}
            placeholder="* or @user1,@user2"
            class="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
    </div>
    <div class="flex gap-2 pt-1">
        <button type="submit" class="bg-accent text-accent-foreground rounded-md px-4 py-2 text-sm font-medium hover:opacity-90">
            {m.channel_update()}
        </button>
        <button type="button" class="bg-bg3 border border-border rounded-md px-4 py-2 text-sm" onclick={oncancel}>
            {m.common_cancel()}
        </button>
    </div>
</form>
