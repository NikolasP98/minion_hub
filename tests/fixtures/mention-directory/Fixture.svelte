<script lang="ts">
  import { Button } from '@minion-stack/ui';
  import ChatMessage from '$lib/components/chat/ChatMessage.svelte';
  import ChatInput from '$lib/components/my-agent/ChatInput.svelte';
  import { invalidateAliases, getAliases } from '$lib/state/features/aliases.svelte';
  import { renderMention } from '$lib/utils/mention';
  import { page, ORG_A, ORG_B } from './page.svelte';
  let submitted = $state('');
  const orgLabel = $derived(page.data.activeOrgId === ORG_A ? 'Studio North' : 'Studio South');
  const phase = import.meta.env.VITE_MENTION_PHASE;
  Object.assign(window, {
    mentionActions: {
      organization: (value: 'A' | 'B') => {
        page.data.activeOrgId = value === 'A' ? ORG_A : ORG_B;
      },
      invalidate: invalidateAliases,
    },
  });
</script>

<main class="min-h-screen bg-background text-foreground p-4 sm:p-8">
  <div class="mx-auto max-w-3xl min-w-0 space-y-6">
    <header class="space-y-2">
      <p class="text-xs text-muted-foreground">
        HC-039 · {phase === 'before' ? 'Original alias cache' : 'Current alias resource'} · synthetic
        evidence
      </p>
      <h1 class="text-xl font-semibold">Chat mentions follow your organization</h1>
      <p class="text-sm text-muted-foreground">
        Actual ChatMessage and ChatInput components. Synthetic identities and directory transport.
        No production session.
      </p>
    </header>
    <section class="rounded-lg border border-border p-4 space-y-3">
      <h2 class="text-sm font-semibold">Evidence controls</h2>
      <div class="flex flex-wrap gap-2">
        <Button
          onclick={() => {
            page.data.activeOrgId = ORG_A;
          }}>Studio North</Button
        >
        <Button
          onclick={() => {
            page.data.activeOrgId = ORG_B;
          }}>Studio South</Button
        >
        <Button variant="outline" onclick={invalidateAliases}>Refresh confirmed alias change</Button
        >
      </div>
      <p class="text-sm" data-org>Current organization: {orgLabel}</p>
    </section>
    <section class="rounded-lg border border-border bg-card p-4 space-y-6 min-w-0">
      <h2 class="text-sm font-semibold">Shared conversation components</h2>
      <div class="flex flex-col gap-3" data-messages>
        <ChatMessage
          message={{ role: 'user', content: '@colleague can you review the daily report?' }}
        />
        <ChatMessage
          message={{ role: 'user', content: '@current_person will take over at Studio South.' }}
        />
      </div>
      <div class="pt-12 min-w-0" data-composer>
        <ChatInput
          placeholder="Type @ to find a colleague"
          onsubmit={(text) => {
            submitted = text;
          }}
        />
      </div>
      {#if submitted}<p data-submitted class="break-words text-sm">
          Submitted locally: {submitted}
        </p>{/if}
    </section>
    <section class="rounded-lg border border-border bg-card p-4 space-y-3">
      <h2 class="text-sm font-semibold">Unchanged mention surfaces</h2>
      <p data-ordinary>{@html renderMention('@colleague in an ordinary message', getAliases())}</p>
      <div data-error>
        <ChatMessage error message={{ role: 'user', content: '@colleague in an error message' }} />
      </div>
    </section>
  </div>
</main>
