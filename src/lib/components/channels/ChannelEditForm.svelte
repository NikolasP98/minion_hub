<script lang="ts">
  import type { ChannelType } from '$lib/types/channels';
  import { Button, Select } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { createSaveStatus } from '$lib/records/save-status.svelte';
  import SaveIndicator from '$lib/records/SaveIndicator.svelte';

  interface Props {
    initialLabel: string;
    initialMeta: Record<string, string>;
    channelType: ChannelType;
    onsave: (data: {
      label: string;
      credentialsMeta: Record<string, string>;
    }) => Promise<void> | void;
    oncancel: () => void;
  }

  let { initialLabel, initialMeta, onsave, oncancel }: Props = $props();

  // svelte-ignore state_referenced_locally
  let label = $state(initialLabel);
  // svelte-ignore state_referenced_locally
  let dmPolicy = $state(initialMeta.dmPolicy ?? 'open');
  // svelte-ignore state_referenced_locally
  let allowFrom = $state(initialMeta.allowFrom ?? '');

  // autosave (policy O): each control commits on native `change` (blur/Enter/
  // select). The PUT takes a partial body, but `credentialsMeta` is one map, so
  // it is rebuilt from the committed meta + the two edited keys every time.
  const status = createSaveStatus();
  function commit() {
    if (!label.trim()) return;
    const meta: Record<string, string> = { ...initialMeta, dmPolicy };
    if (allowFrom) {
      meta.allowFrom = allowFrom;
    } else {
      delete meta.allowFrom;
    }
    void status
      .run(async () => onsave({ label: label.trim(), credentialsMeta: meta }))
      .catch(() => {});
  }
</script>

<form
  class="space-y-3"
  onsubmit={(e) => {
    e.preventDefault();
    commit();
  }}
>
  <div>
    <label for="edit-label" class="text-xs font-medium text-muted-foreground block mb-1"
      >{m.channel_label()}</label
    >
    <input
      id="edit-label"
      type="text"
      bind:value={label}
      onchange={commit}
      required
      class="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
    />
  </div>
  <div>
    <label for="edit-dm" class="text-xs font-medium text-muted-foreground block mb-1"
      >DM policy</label
    >
    <Select id="edit-dm" bind:value={dmPolicy} onchange={commit} size="md">
      <option value="open">open</option>
      <option value="pairing">pairing</option>
      <option value="disabled">disabled</option>
    </Select>
  </div>
  <div>
    <label for="edit-allow" class="text-xs font-medium text-muted-foreground block mb-1"
      >Allow from (comma-separated)</label
    >
    <input
      id="edit-allow"
      type="text"
      bind:value={allowFrom}
      onchange={commit}
      placeholder="* or @user1,@user2"
      class="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
    />
  </div>
  <div class="flex items-center gap-2 pt-1">
    <Button type="button" variant="secondary" onclick={oncancel}>
      {m.common_close()}
    </Button>
    <SaveIndicator status={status.status} message={status.message} onRetry={status.retry} />
  </div>
</form>
