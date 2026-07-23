<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  import { Button } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import {
    Sparkles,
    Minus,
    SquarePen,
    Send,
    ChevronDown,
    AlertCircle,
    Mic,
    MicOff,
    PhoneOff,
    Factory,
    MessageCircle,
  } from 'lucide-svelte';
  import { voiceCall, mouth, toggleMute, endCall } from '$lib/state/features/voice-call.svelte';
  import OpenHumanAvatar from '$lib/components/my-agent/OpenHumanAvatar.svelte';
  import {
    assistant,
    toggleAssistant,
    closeAssistant,
    loadPersonalAgent,
  } from '$lib/state/features/assistant.svelte';
  import { userState } from '$lib/state/features/user.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { agentChat } from '$lib/state/chat/chat.svelte';
  import {
    sendAssistantTurn,
    loadChatHistory,
    cleanInboundForDisplay,
    resetChat,
  } from '$lib/services/gateway.svelte';
  import { buildAssistantContext } from '$lib/state/features/assistant-context';
  import { extractText, stripTtsTags } from '$lib/utils/text';
  import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';
  import ChatBlocks from '$lib/chat/ChatBlocks.svelte';
  import {
    isToolResultOnly,
    assistantHasContent,
    toolResultsById as computeToolResultsById,
  } from '$lib/chat/blocks';
  import { page } from '$app/state';
  import { onMount, tick } from 'svelte';
  import { createHotkey, formatForDisplay } from '$lib/hotkeys';
  import FactoryIntakeCard from '$lib/components/workforce/FactoryIntakeCard.svelte';
  import {
    factoryIntakeIsSettled,
    factoryIntakeAttempt,
    normalizeFactoryIntake,
    classifyFactoryIntakeFailure,
    type FactoryIntakeAttempt,
    type FactoryIntakeView,
  } from '$lib/workforce/factory-intake';
  import { onDestroy } from 'svelte';

  let inputEl: HTMLTextAreaElement | undefined = $state();
  let messagesEl: HTMLDivElement | null = $state(null);
  let atBottom = $state(true);

  // Launcher kbd hint — ⌘J on macOS, Ctrl+J elsewhere. Seeded to the mac glyph
  // (matches SSR) and corrected to the real platform after mount.
  let kbdToggle = $state('⌘J');

  onMount(() => {
    loadPersonalAgent();
    kbdToggle = formatForDisplay('Mod+J');
  });

  // ⌘J / Ctrl+J — ⌘K is owned by the command palette (CommandPalette.svelte).
  createHotkey(
    'Mod+J',
    () => {
      toggleAssistant();
      if (assistant.open) requestAnimationFrame(() => inputEl?.focus());
    },
    { meta: { name: m.shortcuts_assistantName(), description: m.shortcuts_assistantDesc() } },
  );

  // Escape closes only while open; keep it propagating to other overlays
  // (`allow` = shared ownership is intended; see ShortcutsOverlay).
  createHotkey(
    'Escape',
    () => closeAssistant(),
    () => ({
      enabled: assistant.open,
      stopPropagation: false,
      conflictBehavior: 'allow',
    }),
  );

  // Update scope reactively from current route + selected agent
  $effect(() => {
    assistant.scope.route = canonicalPath(page.url.pathname);
    assistant.scope.agentId = ui.selectedAgentId;
  });

  // When opened + connected + we know the agent ID, lazy-load chat history
  $effect(() => {
    if (assistant.open && conn.connected && assistant.personalAgentId) {
      const id = assistant.personalAgentId;
      const existing = agentChat[id];
      if (!existing || existing.messages.length === 0) {
        loadChatHistory(id);
      }
    }
  });

  const chat = $derived(
    assistant.personalAgentId ? agentChat[assistant.personalAgentId] : undefined,
  );
  const messages = $derived(chat?.messages ?? []);
  const sending = $derived(chat?.sending ?? false);
  const stream = $derived(chat?.stream ?? null);

  const greeting = $derived.by(() => {
    const name = userState.user?.displayName?.split(' ')[0] ?? 'there';
    return `Hi ${name}`;
  });

  const scopeLabel = $derived.by(() => {
    const parts: string[] = [];
    if (assistant.scope.route && assistant.scope.route !== '/') {
      parts.push(assistant.scope.route);
    }
    if (assistant.scope.agentId) {
      parts.push(`agent: ${assistant.scope.agentId}`);
    }
    return parts.length > 0 ? parts.join(' · ') : 'Home';
  });

  const canSend = $derived(!!assistant.personalAgentId && conn.connected && !sending);

  type ComposerMode = 'chat' | 'factory';
  let modeChoice = $state<ComposerMode>('chat');
  let previousRoute = $state('');
  let factorySending = $state(false);
  let factoryIntake = $state<FactoryIntakeView | null>(null);
  let factoryError = $state<string | null>(null);
  let factoryPollTimer: ReturnType<typeof setTimeout> | null = null;
  let factoryAttempt = $state<FactoryIntakeAttempt | null>(null);

  // The factory desk only exists inside the Workforce module — an intake creates
  // production-line work there and nowhere else. Off /workforce the composer is
  // chat-only, so the two-button switcher is dead chrome and isn't rendered.
  const factoryAvailable = $derived(canonicalPath(page.url.pathname).startsWith('/workforce'));

  // Derived, not raw state: factory mode is then IMPOSSIBLE off /workforce by
  // construction, rather than depending on the reset effect below having run.
  const composerMode = $derived<ComposerMode>(factoryAvailable ? modeChoice : 'chat');

  // Route entry chooses a sensible default once. The explicit selector remains
  // authoritative until the next navigation, so chat is always available.
  $effect(() => {
    const route = canonicalPath(page.url.pathname);
    if (route === previousRoute) return;
    previousRoute = route;
    modeChoice = route.startsWith('/workforce') ? 'factory' : 'chat';
  });

  const canSubmit = $derived(composerMode === 'factory' ? !factorySending : canSend);

  // Local-only draft — written to chat.inputText only at send time, no
  // bidirectional $effect mirroring (that creates reactive loops that
  // interfere with chat.messages tracking downstream).
  let draft = $state('');

  function send() {
    if (composerMode === 'factory') {
      void submitFactoryIntake();
      return;
    }
    if (!canSend) return;
    const id = assistant.personalAgentId;
    if (!id) return;
    const text = draft.trim();
    if (!text) return;
    // Prepend page-context envelope (route + focus + nav instructions) for the
    // model; the clean text is what shows in the transcript.
    sendAssistantTurn(id, text, buildAssistantContext());
    draft = '';
  }

  function stopFactoryPolling() {
    if (factoryPollTimer) clearTimeout(factoryPollTimer);
    factoryPollTimer = null;
  }

  function scheduleFactoryPoll(issueId: string) {
    stopFactoryPolling();
    factoryPollTimer = setTimeout(() => void pollFactoryIntake(issueId), 2500);
  }

  async function pollFactoryIntake(issueId: string) {
    try {
      const response = await fetch(`/api/workforce/factory-intake/${encodeURIComponent(issueId)}`);
      if (!response.ok) throw new Error('status unavailable');
      const next = normalizeFactoryIntake(await response.json());
      if (!next) throw new Error('invalid status response');
      factoryIntake = next;
      if (!factoryIntakeIsSettled(next)) scheduleFactoryPoll(next.issueId);
    } catch {
      // Keep the accepted intake card and its issue link. A transient
      // polling failure must never imply that the ticket was lost.
      if (factoryIntake && !factoryIntakeIsSettled(factoryIntake)) {
        scheduleFactoryPoll(factoryIntake.issueId);
      }
    }
  }

  async function submitFactoryIntake() {
    if (factorySending) return;
    const request = draft.trim();
    if (!request) return;
    factoryAttempt = factoryIntakeAttempt(factoryAttempt, request, () => crypto.randomUUID());
    factorySending = true;
    factoryError = null;
    factoryIntake = null;
    stopFactoryPolling();
    try {
      const response = await fetch('/api/workforce/factory-intake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          request,
          source: {
            kind: 'hub_assistant',
            route: canonicalPath(page.url.pathname),
            selectedAgentId: ui.selectedAgentId ?? undefined,
          },
          idempotencyKey: factoryAttempt.idempotencyKey,
        }),
      });
      if (!response.ok) {
        const failure = classifyFactoryIntakeFailure(
          response.status,
          await response.json().catch(() => null),
        );
        factoryError =
          failure === 'identity_missing'
            ? m.factoryDesk_identityMissing()
            : failure === 'rejected'
              ? m.factoryDesk_rejected()
              : m.factoryDesk_unavailable();
        return;
      }
      const accepted = normalizeFactoryIntake(await response.json());
      if (!accepted) {
        factoryError = m.factoryDesk_invalidResponse();
        return;
      }
      factoryIntake = accepted;
      factoryAttempt = null;
      draft = '';
      if (!factoryIntakeIsSettled(accepted)) scheduleFactoryPoll(accepted.issueId);
    } catch {
      factoryError = m.factoryDesk_unavailable();
    } finally {
      factorySending = false;
    }
  }

  onDestroy(stopFactoryPolling);

  function onInputKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function newChat() {
    if (composerMode === 'factory') {
      stopFactoryPolling();
      factoryIntake = null;
      factoryError = null;
      factoryAttempt = null;
      draft = '';
      requestAnimationFrame(() => inputEl?.focus());
      return;
    }
    const id = assistant.personalAgentId;
    if (!id) return;
    void resetChat(id);
    atBottom = true;
    draft = '';
    requestAnimationFrame(() => inputEl?.focus());
  }

  // Auto-scroll
  function handleScroll() {
    if (!messagesEl) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesEl;
    atBottom = scrollHeight - scrollTop - clientHeight < 40;
  }
  function scrollToBottom() {
    tick().then(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }
  // Every open starts pinned to the newest message (the panel is re-mounted at
  // scrollTop 0, and `atBottom` may be stale from a prior scroll-up) — and stays
  // pinned as history streams in.
  $effect(() => {
    if (!assistant.open) return;
    atBottom = true;
    void messages.length;
    scrollToBottom();
  });
  $effect(() => {
    void messages.length;
    void stream;
    if (atBottom) scrollToBottom();
  });

  function fmtTime(ts: number | undefined): string {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function msgRole(msg: unknown): 'user' | 'assistant' {
    return (msg as { role?: string }).role === 'user' ? 'user' : 'assistant';
  }

  function msgTs(msg: unknown): number | undefined {
    return (msg as { timestamp?: number }).timestamp;
  }

  // tool_use_id → result, collected across the whole thread, so assistant
  // turns rendered via ChatBlocks can show tool card outcomes.
  const toolResultsById = $derived(computeToolResultsById(messages));

  // On /my-agent the user is already in a full chat with this same personal
  // agent (same thread, same AI), so the floating assistant is redundant
  // there — hide it entirely on that route.
  const onMyAgentPage = $derived(canonicalPath(page.url.pathname) === '/home');

  // A call lives at the app level (module singleton). When it's running and
  // the user has navigated off the call UI, this anchored popup surfaces the
  // live status + controls so the call is never interrupted by navigation.
  const callElsewhere = $derived(voiceCall.active && !onMyAgentPage);
  const CALL_STATUS_LABEL: Record<string, string> = {
    idle: m.floatingAssistant_muted(),
    listening: m.floatingAssistant_listening(),
    thinking: m.floatingAssistant_thinking(),
    speaking: m.floatingAssistant_speaking(),
  };

  // ── Draggable, edge-snapping launcher ───────────────────────────────────
  // The collapsed pill is icon-only and expands its label on hover. It can be
  // dragged anywhere and snaps to the nearest screen edge on release (smooth),
  // persisting its spot. Anchored by whichever half it lands in so the
  // hover-expand always grows inward and never spills off-screen.
  const LAUNCH_MARGIN = 20;
  let launcherEl: HTMLElement | null = $state(null);
  let pos = $state<{ left: number; top: number } | null>(null);
  let dragging = $state(false);
  let vw = $state(typeof window !== 'undefined' ? window.innerWidth : 1280);
  let vh = $state(typeof window !== 'undefined' ? window.innerHeight : 800);
  let drag = { px: 0, py: 0, left: 0, top: 0, moved: false };
  let suppressClick = false;

  const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  // Measured COLLAPSED pill size. Everything (edge snapping, the mirrored
  // `right:` anchor, cursor centring, the in-view clamp) is derived from it,
  // so it has to be the real box — the old `launcherEl?.offsetWidth ?? 56`
  // read `null` on every first paint (the ref was only assigned on
  // pointerdown), and `right: vw - left - 56` on a ~140px pill rendered it
  // ~80px away from where it was dropped. Sampled only while collapsed:
  // hovering expands the label, which must NOT move the anchor.
  let launcherSize = $state({ w: 56, h: 44 });
  const launcherW = () => launcherSize.w;
  const launcherH = () => launcherSize.h;
  function measureLauncher() {
    if (!launcherEl || dragging) return;
    const { offsetWidth: w, offsetHeight: h } = launcherEl;
    if (w > 0 && h > 0 && (w !== launcherSize.w || h !== launcherSize.h)) launcherSize = { w, h };
  }

  // Keep the pill inside the viewport whenever the real size or the viewport
  // changes. This is the single self-healing guard: a position saved at a
  // different window size, or written against the old size guess, is pulled
  // back on screen instead of leaving the launcher parked out of sight.
  $effect(() => {
    if (!pos) return;
    const { w, h } = launcherSize;
    const left = clampN(pos.left, LAUNCH_MARGIN, Math.max(LAUNCH_MARGIN, vw - w - LAUNCH_MARGIN));
    const top = clampN(pos.top, LAUNCH_MARGIN, Math.max(LAUNCH_MARGIN, vh - h - LAUNCH_MARGIN));
    if (left !== pos.left || top !== pos.top) pos = { left, top };
  });

  onMount(() => {
    try {
      const s = localStorage.getItem('assistant-launcher-pos');
      const p = s ? JSON.parse(s) : null;
      // A corrupt/non-finite saved value would clamp to NaN → the pill
      // renders fixed at 0,0 (under the topbar) and reads as "gone".
      // Ignore it and fall back to the default bottom-right anchor.
      // In-viewport clamping is the $effect above, which re-runs once the
      // real size lands.
      if (Number.isFinite(p?.left) && Number.isFinite(p?.top)) pos = { left: p.left, top: p.top };
    } catch {
      /* ignore */
    }
    const onResize = () => {
      vw = window.innerWidth;
      vh = window.innerHeight;
      measureLauncher();
      if (pos) snapToEdge();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  function snapToEdge() {
    if (!pos) return;
    const w = launcherW();
    const h = launcherH();
    let { left, top } = pos;
    const dl = left;
    const dr = vw - (left + w);
    const dt = top;
    const db = vh - (top + h);
    const min = Math.min(dl, dr, dt, db);
    if (min === dl) left = LAUNCH_MARGIN;
    else if (min === dr) left = vw - w - LAUNCH_MARGIN;
    else if (min === dt) top = LAUNCH_MARGIN;
    else top = vh - h - LAUNCH_MARGIN;
    pos = {
      left: clampN(left, LAUNCH_MARGIN, vw - w - LAUNCH_MARGIN),
      top: clampN(top, LAUNCH_MARGIN, vh - h - LAUNCH_MARGIN),
    };
    try {
      localStorage.setItem('assistant-launcher-pos', JSON.stringify(pos));
    } catch {
      /* ignore */
    }
  }

  function onLauncherPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !launcherEl) return;
    const r = launcherEl.getBoundingClientRect();
    pos = pos ?? { left: r.left, top: r.top };
    drag = { px: e.clientX, py: e.clientY, left: pos.left, top: pos.top, moved: false };
    launcherEl.setPointerCapture(e.pointerId);
    dragging = true;
  }
  function onLauncherPointerMove(e: PointerEvent) {
    if (!dragging || !launcherEl) return;
    // Wait for a real drag before moving so a click never jumps the pill.
    if (!drag.moved && Math.abs(e.clientX - drag.px) < 4 && Math.abs(e.clientY - drag.py) < 4)
      return;
    drag.moved = true;
    // Centre the COLLAPSED pill on the cursor. Measured size, not a live
    // offsetWidth read: the label collapse is a transition, so reading it
    // mid-drag returns an interpolated width and the pill slides sideways
    // under the cursor for the length of the animation.
    const { w, h } = launcherSize;
    pos = {
      left: clampN(e.clientX - w / 2, LAUNCH_MARGIN, vw - w - LAUNCH_MARGIN),
      top: clampN(e.clientY - h / 2, LAUNCH_MARGIN, vh - h - LAUNCH_MARGIN),
    };
  }
  function onLauncherPointerUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    try {
      launcherEl?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (drag.moved) {
      suppressClick = true; // a drag is not a click
      snapToEdge();
    }
  }
  function onLauncherClick() {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    toggleAssistant();
  }

  // ── Panel: opens from the launcher's corner, draggable by its header ─────
  const PANEL_W = 380;
  const PANEL_H = 560;
  let panelPos = $state<{ left: number; top: number } | null>(null);
  let panelDragging = $state(false);
  let panelDrag = { px: 0, py: 0, left: 0, top: 0 };

  // Re-origin from the bubble on every open (don't keep the last dragged spot).
  $effect(() => {
    if (assistant.open) panelPos = null;
  });

  // The corner nearest the launcher = where the panel docks and grows from.
  const panelAnchor = $derived.by(() => {
    const lw = launcherW();
    const lh = launcherH();
    const cx = pos ? pos.left + lw / 2 : vw - LAUNCH_MARGIN - lw / 2;
    const cy = pos ? pos.top + lh / 2 : vh - LAUNCH_MARGIN - lh / 2;
    const right = cx > vw / 2;
    const bottom = cy > vh / 2;
    return { right, bottom, origin: `${bottom ? 'bottom' : 'top'} ${right ? 'right' : 'left'}` };
  });
  const panelStyle = $derived.by(() => {
    const a = panelAnchor;
    if (panelDragging || panelPos) {
      const p = panelPos!;
      return `left:${p.left}px; top:${p.top}px; right:auto; bottom:auto; transform-origin:${a.origin};`;
    }
    const horiz = a.right ? 'right:20px; left:auto;' : 'left:20px; right:auto;';
    const vert = a.bottom ? 'bottom:20px; top:auto;' : 'top:20px; bottom:auto;';
    return `${horiz} ${vert} transform-origin:${a.origin}; animation: assistant-pop-in 240ms cubic-bezier(.2,.8,.2,1);`;
  });

  function onPanelHeaderPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return; // header buttons aren't drag handles
    const header = e.currentTarget as HTMLElement;
    const panel = header.parentElement as HTMLElement | null;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    panelPos = { left: r.left, top: r.top }; // freeze current spot → no jump
    panelDrag = { px: e.clientX, py: e.clientY, left: r.left, top: r.top };
    header.setPointerCapture(e.pointerId);
    panelDragging = true;
  }
  function onPanelHeaderPointerMove(e: PointerEvent) {
    if (!panelDragging) return;
    panelPos = {
      left: clampN(panelDrag.left + (e.clientX - panelDrag.px), 8, vw - PANEL_W - 8),
      top: clampN(panelDrag.top + (e.clientY - panelDrag.py), 8, vh - PANEL_H - 8),
    };
  }
  function onPanelHeaderPointerUp(e: PointerEvent) {
    if (!panelDragging) return;
    panelDragging = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  // Anchor by the half it sits in so hover-expand grows inward (never off-screen).
  const anchorRight = $derived(!!pos && pos.left + launcherW() / 2 > vw / 2);
  const launcherStyle = $derived.by(() => {
    if (!pos) return '';
    if (dragging) return `left:${pos.left}px; right:auto; top:${pos.top}px;`;
    const ease =
      'transition: left var(--duration-normal) var(--ease-standard), top var(--duration-normal) var(--ease-standard), right var(--duration-normal) var(--ease-standard);';
    const horiz = anchorRight
      ? `right:${Math.max(LAUNCH_MARGIN, vw - pos.left - launcherW())}px; left:auto;`
      : `left:${pos.left}px; right:auto;`;
    return `${horiz} top:${pos.top}px; ${ease}`;
  });
</script>

<!-- Pill (collapsed state) -->
{#if onMyAgentPage}
  <!-- redundant on /my-agent — the page hosts the same chat inline -->
{:else if callElsewhere && !assistant.open}
  <!-- Live-call status pill: keeps the call reachable after navigating away. -->
  <div
    class="fixed bottom-[max(var(--space-4,16px),env(safe-area-inset-bottom,0px))] right-[max(var(--space-4,16px),env(safe-area-inset-right,0px))] z-[var(--layer-popover,40)] flex items-center gap-2.5 pl-2 pr-2.5 py-2 rounded-full bg-bg2 border border-accent/40 shadow-[var(--shadow-elevation-3,var(--shadow-md))]"
  >
    <Button
      variant="ghost"
      size="xs"
      type="button"
      onclick={() => (assistant.open = true)}
      class="flex items-center gap-2 group"
      title={m.a11y3_openCallTranscript()}
    >
      <span
        class="w-7 h-7 rounded-full overflow-hidden bg-[var(--color-overlay)] ring-1 ring-accent/50 shrink-0"
      >
        <OpenHumanAvatar mouthRef={mouth} status={voiceCall.status} />
      </span>
      <span class="text-xs font-medium text-foreground tabular-nums">
        {CALL_STATUS_LABEL[voiceCall.status] ?? m.floatingAssistant_onCall()}
      </span>
    </Button>
    <Button
      variant="ghost"
      size="xs"
      type="button"
      onclick={toggleMute}
      class="w-7 h-7 flex items-center justify-center rounded-full border border-border hover:bg-bg3 transition-colors {voiceCall.muted
        ? 'text-accent border-accent/50'
        : 'text-foreground'}"
      title={voiceCall.muted ? m.a11y3_unmute() : m.a11y3_mute()}
      aria-pressed={voiceCall.muted}
    >
      {#if voiceCall.muted}<MicOff size={13} />{:else}<Mic size={13} />{/if}
    </Button>
    <Button
      variant="ghost"
      size="xs"
      type="button"
      onclick={endCall}
      class="w-7 h-7 flex items-center justify-center rounded-full border border-destructive/40 text-destructive hover:bg-destructive/15 transition-colors"
      title={m.a11y3_endCall()}
    >
      <PhoneOff size={13} />
    </Button>
  </div>
{:else if !assistant.open}
  <!-- `!fixed` / `!h-auto` below are load-bearing, not cosmetic: Button's base
         class hardcodes `relative` and `h-[var(--control-height-xs)]`, and Tailwind
         emits `.relative` AFTER `.fixed`, so class-attribute order does not
         decide the winner. Un-forced, the pill is position:relative — it renders
         at its static flow position (document bottom-left) and dragging writes
         left/top as RELATIVE offsets, throwing it off-screen. -->
  <Button
    variant="ghost"
    size="xs"
    type="button"
    {@attach (el: HTMLElement) => {
      launcherEl = el;
      measureLauncher();
    }}
    onpointerdown={onLauncherPointerDown}
    onpointermove={onLauncherPointerMove}
    onpointerup={onLauncherPointerUp}
    onclick={onLauncherClick}
    class="!fixed z-[var(--layer-popover,40)] !h-auto flex items-center gap-1.5 p-1.5 rounded-full bg-bg2 border border-border shadow-[var(--shadow-elevation-3,var(--shadow-md))] transition-colors hover:border-accent/50 hover:bg-bg3 group select-none touch-none {dragging
      ? 'cursor-grabbing shadow-[var(--shadow-elevation-4,var(--shadow-lg))]'
      : 'cursor-grab'} {pos ? '' : 'bottom-5 right-5'}"
    style={launcherStyle}
    aria-label={m.floatingAssistant_openLabel()}
    title={m.floatingAssistant_openTitle()}
  >
    <!-- Icon chip — pairs with the kbd as a balanced two-token collapsed pill. -->
    <span
      class="flex items-center justify-center w-7 h-7 shrink-0 rounded-full bg-accent/10 text-accent transition-colors group-hover:bg-accent/15"
    >
      <Sparkles size={16} />
    </span>
    <!-- Label reveals on hover. Grid 0fr→1fr animates to the text's exact width
             (no hardcoded max-width, no clipping). Flex items-center handles vertical
             centring; leading-tight + py-0.5 give descenders (g, y) room inside the clip. -->
    <span
      class="grid grid-cols-[0fr] transition-[grid-template-columns] duration-[var(--duration-normal)] ease-out {dragging
        ? ''
        : 'group-hover:grid-cols-[1fr]'}"
    >
      <span class="overflow-hidden min-w-0">
        <span
          class="block px-1 py-0.5 whitespace-nowrap text-[length:var(--font-size-body)] font-medium leading-tight text-foreground"
          >{m.floatingAssistant_askAnything()}</span
        >
      </span>
    </span>
    <kbd
      class="shrink-0 flex items-center h-5 px-1.5 rounded-md bg-bg3 text-[length:var(--font-size-telemetry)] font-medium font-mono leading-none text-muted-foreground border border-border"
      >{kbdToggle}</kbd
    >
  </Button>
{:else}
  <!-- Expanded panel — grows out of the launcher's corner, draggable by header -->
  <div
    class="fixed z-[var(--layer-popover,40)] w-[min(380px,calc(100vw-var(--space-page-gutter,16px)-var(--space-page-gutter,16px)))] h-[min(560px,calc(100dvh-var(--space-page-gutter,16px)-var(--space-page-gutter,16px)-env(safe-area-inset-bottom,0px)))] flex flex-col bg-bg2 border border-border rounded-xl shadow-[var(--shadow-overlay,var(--shadow-xl,var(--shadow-lg)))] overflow-hidden"
    style={panelStyle}
  >
    <!-- Header (drag handle) -->
    <div
      role="toolbar"
      tabindex="-1"
      aria-label={m.floatingAssistant_title()}
      class="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border bg-bg3/40 select-none touch-none {panelDragging
        ? 'cursor-grabbing'
        : 'cursor-grab'}"
      onpointerdown={onPanelHeaderPointerDown}
      onpointermove={onPanelHeaderPointerMove}
      onpointerup={onPanelHeaderPointerUp}
    >
      <Sparkles size={13} class="text-accent shrink-0 ml-1" />
      <span
        class="text-[length:var(--font-size-label)] font-semibold text-foreground flex-1 truncate"
        >{m.floatingAssistant_title()}</span
      >
      {#if !conn.connected && composerMode === 'chat'}
        <span
          class="shrink-0 w-1.5 h-1.5 rounded-full bg-warning"
          title={m.floatingAssistant_offline()}
        ></span>
      {/if}
      <Button
        variant="ghost"
        size="xs"
        type="button"
        onclick={newChat}
        class="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-bg3 transition-colors"
        aria-label={m.floatingAssistant_newChat()}
        title={m.floatingAssistant_newChat()}
      >
        <SquarePen size={14} />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        type="button"
        onclick={closeAssistant}
        class="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-bg3 transition-colors"
        aria-label={m.floatingAssistant_minimize()}
        title={m.floatingAssistant_minimize()}
      >
        <Minus size={15} />
      </Button>
    </div>

    {#if callElsewhere}
      <!-- Live-call strip: status + controls while the call runs in the background -->
      <div class="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-accent/30 bg-accent/5">
        <span
          class="w-7 h-7 rounded-full overflow-hidden bg-[var(--color-overlay)] ring-1 ring-accent/50 shrink-0"
        >
          <OpenHumanAvatar mouthRef={mouth} status={voiceCall.status} />
        </span>
        <span
          class="text-[length:var(--font-size-label)] font-medium text-foreground flex-1 tabular-nums"
        >
          On call · {CALL_STATUS_LABEL[voiceCall.status] ?? ''}
          {#if voiceCall.interim}<span class="text-muted-foreground italic"
              >“{voiceCall.interim}”</span
            >{/if}
        </span>
        <Button
          variant="ghost"
          size="xs"
          type="button"
          onclick={toggleMute}
          class="w-6 h-6 flex items-center justify-center rounded-md border border-border hover:bg-bg3 transition-colors {voiceCall.muted
            ? 'text-accent border-accent/50'
            : 'text-foreground'}"
          title={voiceCall.muted ? m.a11y3_unmute() : m.a11y3_mute()}
          aria-pressed={voiceCall.muted}
        >
          {#if voiceCall.muted}<MicOff size={12} />{:else}<Mic size={12} />{/if}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          type="button"
          onclick={endCall}
          class="w-6 h-6 flex items-center justify-center rounded-md border border-destructive/40 text-destructive hover:bg-destructive/15 transition-colors"
          title={m.a11y3_endCall()}
        >
          <PhoneOff size={12} />
        </Button>
      </div>
    {/if}

    <!-- Messages -->
    <div
      class="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0 [scrollbar-width:thin]"
      bind:this={messagesEl}
      onscroll={handleScroll}
    >
      {#if composerMode === 'factory'}
        <div
          class="h-full flex flex-col items-center justify-center text-center px-7 factory-welcome"
        >
          <div class="factory-welcome-mark"><Factory size={20} /></div>
          <h3>{m.factoryDesk_welcomeTitle()}</h3>
          <p>{m.factoryDesk_welcomeDescription()}</p>
        </div>
      {:else if assistant.loading}
        <div
          class="h-full flex items-center justify-center text-[length:var(--font-size-label)] text-muted-foreground"
        >
          {m.floatingAssistant_loading()}
        </div>
      {:else if assistant.error}
        <div class="h-full flex flex-col items-center justify-center text-center px-6">
          <AlertCircle size={20} class="text-destructive mb-2" />
          <p class="text-[length:var(--font-size-label)] text-muted-foreground">
            {assistant.error}
          </p>
        </div>
      {:else if !assistant.personalAgentId}
        <div
          class="h-full flex items-center justify-center text-[length:var(--font-size-label)] text-muted-foreground"
        >
          {m.floatingAssistant_connecting()}
        </div>
      {:else if messages.length === 0 && !chat?.loading && !stream}
        <div class="h-full flex flex-col items-center justify-center text-center px-6">
          <div
            class="w-12 h-12 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center mb-3"
          >
            <Sparkles size={20} class="text-accent" />
          </div>
          <h3 class="text-sm font-semibold text-foreground mb-1">{greeting}</h3>
          <p class="text-[length:var(--font-size-label)] text-muted-foreground leading-relaxed">
            {m.floatingAssistant_greeting()}
          </p>
        </div>
      {:else}
        {#each messages as msg, i (`${msgTs(msg) ?? ''}_${i}`)}
          {@const role = msgRole(msg)}
          {#if isToolResultOnly(msg)}
            <!-- tool-output carrier turn — folded into the matching tool card, not its own bubble -->
          {:else if role === 'user'}
            {@const text = cleanInboundForDisplay(extractText(msg) ?? '')}
            {#if text}
              <div class="flex flex-col gap-0.5 items-end">
                <div
                  class="max-w-[85%] rounded-lg px-3 py-2 text-[length:var(--font-size-label)] leading-relaxed break-words bg-accent/15 text-foreground border border-accent/20 whitespace-pre-wrap"
                >
                  {text}
                </div>
                {#if msgTs(msg)}
                  <span
                    class="text-[length:var(--font-size-telemetry)] text-muted-strong px-1 tabular-nums"
                  >
                    {fmtTime(msgTs(msg))}
                  </span>
                {/if}
              </div>
            {/if}
          {:else if assistantHasContent(msg)}
            <div class="flex flex-col gap-0.5 items-start">
              <ChatBlocks message={msg} toolResults={toolResultsById} compact />
              {#if msgTs(msg)}
                <span
                  class="text-[length:var(--font-size-telemetry)] text-muted-strong px-1 tabular-nums"
                >
                  {fmtTime(msgTs(msg))}
                </span>
              {/if}
            </div>
          {/if}
        {/each}

        {#if stream !== null && stream !== ''}
          <div class="flex flex-col gap-0.5 items-start">
            <div
              class="max-w-[85%] rounded-lg px-3 py-2 text-[length:var(--font-size-label)] leading-relaxed break-words bg-bg3 text-foreground border border-dashed border-border opacity-90"
            >
              <MarkdownMessage value={stripTtsTags(stream)} tone="assistant" />
            </div>
          </div>
        {:else if sending}
          <div
            class="flex items-center gap-2 px-3 py-2 text-[length:var(--font-size-label)] text-muted-foreground"
          >
            <span class="flex gap-1">
              <span class="w-1 h-1 rounded-full bg-accent animate-pulse"></span>
              <span
                class="w-1 h-1 rounded-full bg-accent animate-pulse"
                style="animation-delay: 100ms"
              ></span>
              <span
                class="w-1 h-1 rounded-full bg-accent animate-pulse"
                style="animation-delay: 200ms"
              ></span>
            </span>
            {m.floatingAssistant_thinking()}
          </div>
        {/if}

        {#if chat?.lastError}
          <div
            class="flex items-start gap-1.5 px-2 py-1.5 text-[length:var(--font-size-label)] text-destructive bg-destructive/10 border border-destructive/20 rounded-md"
          >
            <AlertCircle size={11} class="mt-0.5 shrink-0" />
            <span class="break-words">{chat.lastError}</span>
          </div>
        {/if}
      {/if}
    </div>

    {#if composerMode === 'factory' && (factorySending || factoryIntake || factoryError)}
      <FactoryIntakeCard intake={factoryIntake} pending={factorySending} error={factoryError} />
    {/if}

    <!-- Scope badge + input -->
    <div class="shrink-0 border-t border-border bg-bg3/40">
      {#if factoryAvailable}
        <div class="composer-modes" aria-label={m.factoryDesk_controlDesk()}>
          <Button
            variant="ghost"
            size="xs"
            type="button"
            class={composerMode === 'chat' ? 'active' : undefined}
            aria-pressed={composerMode === 'chat'}
            onclick={() => (modeChoice = 'chat')}
            ><MessageCircle size={11} /> {m.factoryDesk_modeChat()}</Button
          >
          <Button
            variant="ghost"
            size="xs"
            type="button"
            class={composerMode === 'factory' ? 'active' : undefined}
            aria-pressed={composerMode === 'factory'}
            onclick={() => (modeChoice = 'factory')}
            ><Factory size={11} /> {m.factoryDesk_modeFactory()}</Button
          >
          {#if composerMode === 'factory'}
            <span>{m.factoryDesk_factoryHint()}</span>
          {/if}
        </div>
      {/if}
      <div
        class="flex items-center gap-1.5 px-3 py-1.5 text-[length:var(--font-size-telemetry)] text-muted-foreground border-b border-border/60"
      >
        <span class="font-semibold uppercase tracking-wider">{m.floatingAssistant_viewing()}:</span>
        <span class="truncate flex-1">{scopeLabel}</span>
        <ChevronDown size={10} class="opacity-50" />
      </div>
      <div class="p-2.5">
        <div class="flex items-end gap-2">
          <textarea
            bind:this={inputEl}
            bind:value={draft}
            onkeydown={onInputKey}
            rows="1"
            placeholder={composerMode === 'factory'
              ? m.factoryDesk_placeholder()
              : canSend
                ? m.floatingAssistant_askAnything()
                : conn.connected
                  ? m.common_loading()
                  : m.floatingAssistant_offline()}
            disabled={!canSubmit}
            class="flex-1 min-w-0 resize-none bg-bg border border-border rounded-md px-2.5 py-1.5 text-[length:var(--font-size-label)] text-foreground placeholder:text-muted-strong focus:outline-none focus:border-accent/50 max-h-[120px] disabled:opacity-50"
          ></textarea>
          <Button
            variant="ghost"
            size="xs"
            type="button"
            onclick={send}
            disabled={!draft.trim() || !canSubmit}
            class="shrink-0 w-7 h-7 flex items-center justify-center rounded-md bg-accent text-bg hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            aria-label={composerMode === 'factory'
              ? m.factoryDesk_submit()
              : m.floatingAssistant_send()}
          >
            <Send size={12} />
          </Button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Grows out of the launcher: transform-origin is set inline to the bubble's
       corner, so scaling up reads as the chat window emerging from the pill. */
  @keyframes assistant-pop-in {
    from {
      opacity: 0;
      transform: scale(0.4);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
  .composer-modes {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 2rem;
    padding: var(--space-2);
    border-bottom: 1px solid color-mix(in srgb, var(--color-border) 65%, transparent);
  }
  .composer-modes :global(button) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-2);
    color: var(--color-muted-foreground);
    font-size: var(--font-size-telemetry);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .composer-modes :global(button:hover),
  .composer-modes :global(button:focus-visible) {
    color: var(--color-foreground);
    outline: none;
  }
  .composer-modes :global(button.active) {
    border-color: color-mix(in srgb, var(--color-accent) 35%, var(--color-border));
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }
  .composer-modes span {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    color: var(--color-muted-foreground);
    font-size: var(--font-size-telemetry);
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .factory-welcome-mark {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    margin-bottom: var(--space-3);
    border: 1px solid color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
    border-radius: var(--radius-xl);
    color: var(--color-accent);
    background: repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--color-accent) 9%, transparent) 0 5px,
      transparent 5px 10px
    );
    box-shadow: var(--shadow-status-glow);
  }
  .factory-welcome h3 {
    margin-top: var(--space-2);
    color: var(--color-foreground);
    font-size: var(--font-size-body);
    font-weight: 700;
  }
  .factory-welcome p {
    margin-top: var(--space-1);
    max-width: 17rem;
    color: var(--color-muted-foreground);
    font-size: var(--font-size-telemetry);
    line-height: 1.5;
  }
</style>
