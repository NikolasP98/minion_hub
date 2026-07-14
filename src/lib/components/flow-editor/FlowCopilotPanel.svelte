<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { Sparkles, Send, Check, X } from 'lucide-svelte';
  import ChatMessage from '$lib/components/chat/ChatMessage.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import type { WorkingFlow } from '$lib/flows/flow-ops';
  import { Button, Textarea } from '@minion-stack/ui';
  import { fetchJson } from '$lib/api/fetch-json';

  let {
    flowId,
    onpreview,
    onapply,
    onreject,
  }: {
    flowId: string;
    onpreview: (proposed: WorkingFlow | null) => void;
    onapply: (proposed: WorkingFlow) => boolean | Promise<boolean>;
    onreject: () => void;
  } = $props();

  type Turn = { role: 'user' | 'assistant'; content: string };
  let messages = $state<Turn[]>([]);
  let input = $state('');
  let busy = $state(false);
  let proposal = $state<WorkingFlow | null>(null);
  let validation = $state<{ ok: boolean; issues: string[] } | null>(null);
  let errorMsg = $state('');

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    messages = [...messages, { role: 'user', content: text }];
    input = '';
    busy = true;
    errorMsg = '';
    try {
      const data = await fetchJson<{
        message: string;
        proposedFlow: WorkingFlow;
        validation: { ok: boolean; issues: string[] };
      }>(`/api/flows/${flowId}/copilot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
      messages = [...messages, { role: 'assistant', content: data.message }];
      proposal = data.proposedFlow;
      validation = data.validation;
      onpreview(data.proposedFlow);
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : m.common_error();
    } finally {
      busy = false;
    }
  }

  async function apply() {
    if (!proposal || busy) return;
    busy = true;
    errorMsg = '';
    try {
      const applied = await onapply(proposal);
      if (!applied) return;
      proposal = null;
      validation = null;
      onpreview(null);
    } catch (error) {
      errorMsg = error instanceof Error ? error.message : m.common_error();
    } finally {
      busy = false;
    }
  }
  function reject() {
    proposal = null;
    validation = null;
    onpreview(null);
    onreject();
  }

  function handleInputKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void send();
  }
</script>

<aside class="copilot-panel" aria-label={m.flow_copilot_title()}>
  <header>
    <Sparkles size={15} aria-hidden="true" />
    {m.flow_copilot_title()}
  </header>

  <div class="copilot-thread" aria-live="polite">
    {#each messages as msg (msg)}
      <ChatMessage message={msg} />
    {/each}
    {#if busy}
      <div class="copilot-progress" role="status">
        <Spinner size="xs" />
        {m.flow_copilot_thinking()}
      </div>
    {/if}
    {#if errorMsg}<p class="copilot-error" role="alert">{errorMsg}</p>{/if}
  </div>

  {#if proposal}
    <div class="proposal-panel">
      <p>{m.flow_copilot_proposed()}</p>
      {#if validation && !validation.ok}
        <p class="proposal-warning">{m.flow_copilot_invalid()}</p>
      {/if}
      <div class="proposal-actions">
        <Button variant="primary" size="sm" loading={busy} onclick={apply}>
          {#snippet icon()}<Check size={13} aria-hidden="true" />{/snippet}
          {m.flow_copilot_confirm()}
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onclick={reject}>
          {#snippet icon()}<X size={13} aria-hidden="true" />{/snippet}
          {m.flow_copilot_reject()}
        </Button>
      </div>
    </div>
  {/if}

  <div class="composer">
    <div class="composer-row">
      <Textarea
        label={m.flow_copilot_placeholder()}
        bind:value={input}
        rows={2}
        resize="none"
        placeholder={m.flow_copilot_placeholder()}
        onkeydown={handleInputKeydown}
      />
      <Button
        variant="primary"
        size="touch"
        shape="icon"
        onclick={send}
        disabled={busy || !input.trim()}
        aria-label={m.chat_send()}
      >
        {#snippet icon()}<Send size={15} aria-hidden="true" />{/snippet}
      </Button>
    </div>
  </div>
</aside>

<style>
  .copilot-panel {
    display: flex;
    width: 20rem;
    height: 100%;
    flex-shrink: 0;
    flex-direction: column;
    border-left: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
  }

  header {
    display: flex;
    padding: var(--space-3) var(--space-4);
    align-items: center;
    gap: var(--space-control-gap);
    border-bottom: 1px solid var(--color-border-subtle);
    color: var(--color-text-primary);
    font-size: var(--font-size-section-title);
    line-height: var(--line-height-heading);
    font-weight: var(--font-weight-semibold);
  }

  .copilot-thread {
    display: flex;
    min-height: 0;
    padding: var(--space-3);
    flex: 1;
    flex-direction: column;
    gap: var(--space-3);
    overflow-y: auto;
  }

  .copilot-progress,
  .copilot-error,
  .proposal-panel {
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .copilot-progress {
    display: flex;
    align-items: center;
    gap: var(--space-control-gap);
    color: var(--color-text-secondary);
  }

  .copilot-error {
    color: var(--color-danger-fg);
  }

  .proposal-panel,
  .composer {
    padding: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
  }

  .proposal-panel {
    color: var(--color-text-secondary);
    background: var(--color-surface-2);
  }

  .proposal-warning {
    margin-top: var(--space-2);
    color: var(--color-warning-fg);
  }

  .proposal-actions,
  .composer-row {
    display: flex;
    align-items: flex-end;
    gap: var(--space-control-gap);
  }

  .proposal-actions {
    margin-top: var(--space-2);
  }

  .proposal-actions :global([data-part='button']) {
    flex: 1;
  }

  .composer-row :global([data-part='form-field']) {
    min-width: 0;
    flex: 1;
  }

  @media (max-width: 767.98px) {
    .copilot-panel {
      width: 100%;
      border-left: 0;
    }
  }
</style>
