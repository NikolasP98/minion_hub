<script lang="ts">
  import { Button } from '$lib/components/ui';

  import { tick } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { ArrowDown, SendHorizontal, Clock, CheckCheck } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { submitOnEnter } from '$lib/hotkeys';
  import JourneyTimeline from './JourneyTimeline.svelte';

  type TRow = {
    kind?: string;
    channel?: string | null;
    body?: string | null;
    occurred_at?: string;
    direction?: string | null;
    source_id?: string;
    client_id?: string | null;
  };
  let {
    rows,
    contactId,
    channel,
    canSend = true,
  }: { rows: TRow[]; contactId: string; channel: string; canSend?: boolean } = $props();

  // Optimistic queue: the input never blocks. A sent message lives as ONE bubble
  // that flips pending → sent in place. The server's echo of that same message
  // (matched by client_id) is hidden while its optimistic bubble exists, so the
  // bubble never de-renders or duplicates — it just changes status.
  type Pending = { clientId: string; text: string; status: 'pending' | 'sent' | 'failed' };
  let pending = $state<Pending[]>([]);
  const pendingIds = $derived(new Set(pending.map((p) => p.clientId)));
  const visibleRows = $derived(rows.filter((r) => !(r.client_id && pendingIds.has(r.client_id))));

  // New-message detection (matches the visible bubbles + optimistic ones).
  const shownCount = $derived(
    visibleRows.filter((r) => (r.body ?? '').trim().length > 0).length + pending.length,
  );

  let scrollEl = $state<HTMLDivElement | null>(null);
  // `stick` = keep the view pinned to the newest message. It flips ONLY from real
  // user scrolls; our own programmatic scrolls are ignored via the guard so the
  // onscroll fired while content grows can't knock us off the bottom.
  let stick = $state(true);
  let unseen = $state(0);
  let prevCount = 0;
  let prevChannel = '';
  let programmatic = false;

  const NEAR = 80;
  function onScroll() {
    if (programmatic || !scrollEl) return;
    stick = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight <= NEAR;
    if (stick) unseen = 0;
  }
  function toBottom() {
    if (!scrollEl) return;
    programmatic = true;
    scrollEl.scrollTop = scrollEl.scrollHeight; // instant — smooth races the content growth
    stick = true;
    unseen = 0;
    // Release after layout settles so the resulting onscroll doesn't flip `stick`.
    requestAnimationFrame(() => requestAnimationFrame(() => (programmatic = false)));
  }

  // Channel switch → pin to the newest message.
  $effect(() => {
    if (channel !== prevChannel) {
      prevChannel = channel;
      prevCount = shownCount;
      stick = true;
      void tick().then(toBottom);
    }
  });

  // Any rows change (poll refresh, new inbound, optimistic reconcile). While
  // sticking, stay pinned — this also re-anchors when a refresh re-creates the
  // list DOM and the browser resets scrollTop to the top. Otherwise count the
  // new arrivals into the "jump to latest" pill.
  $effect(() => {
    void rows; // track the array identity (replaced every poll)
    void pending.length; // …and optimistic bubbles
    const n = shownCount;
    if (channel !== prevChannel) return; // channel effect handles the switch
    if (stick) void tick().then(toBottom);
    else if (n > prevCount) unseen += n - prevCount;
    prevCount = n;
  });

  let draft = $state('');
  let seq = 0;

  function setStatus(clientId: string, status: Pending['status']) {
    pending = pending.map((x) => (x.clientId === clientId ? { ...x, status } : x));
  }

  async function dispatch(p: Pending) {
    try {
      const res = await fetch(`/api/crm/contacts/${contactId}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channel, text: p.text, clientId: p.clientId }),
      });
      setStatus(p.clientId, res.ok ? 'sent' : 'failed');
      // Refresh other UI (counts/journey) in the background; the server's echo of
      // this message is deduped against the bubble, so nothing flickers.
      if (res.ok) void invalidate('crm:contact');
    } catch {
      setStatus(p.clientId, 'failed');
    }
  }
  function send() {
    const text = draft.trim();
    if (!text) return;
    const p: Pending = {
      clientId: `crm-send:${contactId}:${Date.now()}-${++seq}`,
      text,
      status: 'pending',
    };
    pending = [...pending, p];
    draft = '';
    stick = true;
    void tick().then(toBottom);
    void dispatch(p);
  }
  function retry(p: Pending) {
    setStatus(p.clientId, 'pending');
    void dispatch(p);
  }
</script>

<div class="chat">
  <div class="scroll" bind:this={scrollEl} onscroll={onScroll}>
    <JourneyTimeline rows={visibleRows as never} hideHeaders />
    {#if pending.length}
      <ol class="pending-thread">
        {#each pending as p (p.clientId)}
          <li class="row out">
            <div
              class="bubble"
              class:failed={p.status === 'failed'}
              class:sent={p.status === 'sent'}
            >
              <p class="text">{p.text}</p>
              {#if p.status === 'failed'}
                <Button class="retry" onclick={() => retry(p)}>{m.crm_send_failed()}</Button>
              {:else}
                <span class="status" aria-label={p.status}>
                  {#if p.status === 'sent'}<CheckCheck size={12} />{:else}<Clock size={11} />{/if}
                </span>
              {/if}
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  </div>

  {#if unseen > 0 && !stick}
    <Button class="new-pill" onclick={toBottom}>
      <ArrowDown size={13} />
      {m.crm_new_messages({ count: unseen })}
    </Button>
  {/if}

  {#if canSend}
    <div class="composer">
      <textarea
        class="c-input"
        bind:value={draft}
        {@attach submitOnEnter(() => send())}
        placeholder={m.crm_message_placeholder()}
        rows="1"></textarea>
      <Button class="c-send" onclick={send} disabled={!draft.trim()} aria-label={m.crm_send()}>
        <SendHorizontal size={16} />
      </Button>
    </div>
  {/if}
</div>

<style>
  .chat {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .chat :global(.new-pill) {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 4.2rem;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-caption);
    font-weight: 600;
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    background: var(--color-accent, var(--color-emerald, var(--color-success)));
    color: var(--color-on-accent, var(--color-foreground));
    box-shadow: var(--shadow-elevation-2);
    z-index: var(--layer-sticky);
  }
  .composer {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--hairline);
    margin-top: var(--space-2);
  }
  .c-input {
    flex: 1;
    resize: none;
    max-height: 6rem;
    min-height: 2.2rem;
    padding: var(--space-2) var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--hairline);
    background: var(--color-canvas);
    color: var(--color-foreground);
    font-size: var(--font-size-body);
    line-height: 1.3;
    font-family: inherit;
  }
  .c-input:focus {
    outline: none;
    border-color: var(--color-accent, var(--color-emerald, var(--color-success)));
  }
  .chat :global(.c-send) {
    display: grid;
    place-items: center;
    width: 2.2rem;
    height: 2.2rem;
    flex-shrink: 0;
    border-radius: var(--radius-md);
    background: var(--color-accent, var(--color-emerald, var(--color-success)));
    color: var(--color-on-accent, var(--color-foreground));
  }
  .chat :global(.c-send):disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  /* Optimistic pending bubbles (JourneyTimeline's bubble styles are scoped to it). */
  .pending-thread {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    list-style: none;
    margin: var(--space-1) 0 0;
    padding: 0;
  }
  .row {
    display: flex;
    justify-content: flex-end;
  }
  .bubble {
    position: relative;
    max-width: 80%;
    padding: var(--space-2) var(--space-2) var(--space-1);
    border-radius: var(--radius-xl);
    border-bottom-right-radius: 0.2rem;
    background: color-mix(
      in srgb,
      var(--color-emerald, var(--color-success)) 22%,
      var(--color-card)
    );
    color: var(--color-foreground);
    opacity: 0.6;
    transition: opacity var(--duration-fast) ease;
  }
  .bubble.sent {
    opacity: 1;
  }
  .bubble.failed {
    opacity: 1;
    background: color-mix(
      in srgb,
      var(--color-destructive, var(--color-brand)) 18%,
      var(--color-card)
    );
  }
  .text {
    font-size: var(--font-size-body);
    line-height: 1.3;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 0;
  }
  .status {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    color: var(--color-muted-foreground);
    margin-top: var(--space-0-5);
  }
  .bubble.sent .status {
    color: color-mix(
      in srgb,
      var(--color-emerald, var(--color-success)) 70%,
      var(--color-foreground)
    );
  }
  .chat :global(.retry) {
    display: block;
    margin-top: var(--space-0-5);
    margin-left: auto;
    font-size: var(--font-size-telemetry);
    font-weight: 600;
    color: var(--color-destructive, var(--color-brand));
    text-decoration: underline;
  }
</style>
