<script lang="ts">
  import { iconSizes, Button } from '$lib/components/ui';
  import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';
  import {
    AiReasoning,
    AiToolCall,
    AiSources,
    turnSources,
    type AIToolStatus,
  } from '$lib/components/ai';
  import { normalizeBlocks, type ChatBlock, type ToolResult } from './blocks';
  import { stripTtsTags } from '$lib/utils/text';
  import { toolCatalog, ensureToolCatalogLoaded } from '$lib/state/agents/tool-catalog.svelte';
  import { isToolPermissionAllowed, toolPermissionLabel } from '$lib/utils/tool-permission-chip';
  import type { ToolPermission } from '$lib/types/tools';
  import * as m from '$lib/paraglide/messages';

  interface ArtifactButton {
    text: string;
    callback_data: string;
    style?: 'danger' | 'success' | 'primary';
  }
  interface ArtifactInput {
    title?: string;
    html: string;
    buttons?: ArtifactButton[][];
  }

  interface Props {
    /** Message-shaped object whose `content` carries the block array. */
    message: { content?: unknown };
    /** tool_use_id → result, collected across the whole thread by the parent. */
    toolResults?: Record<string, ToolResult>;
    /** True while this turn is still streaming (affects tool/"thinking" labels). */
    streaming?: boolean;
    /**
     * When set, render THIS text as the answer instead of the message's own
     * text blocks — used during streaming to show the smoothed (typewriter)
     * reveal while reasoning/tool meta still come from `message`, or by
     * consumers (ChatMessage.svelte) that apply their own text cleanup
     * pipeline before display.
     */
    textOverride?: string;
    /** Tones down chrome for small surfaces (floating assistant, drawers). */
    compact?: boolean;
    /**
     * Sends a `chat_artifact` button's `callback_data` as the user's next chat
     * message (same path as ChatInput/handleSubmit). Absent on surfaces that
     * don't own a send path (SessionMonitor, floating assistant history) —
     * artifact buttons render disabled there instead of silently no-op'ing.
     */
    onArtifactCallback?: (callbackData: string) => void;
    /** Sends a `ui.choice` button's label as the next chat message (same send path). */
    onChoice?: (text: string) => void;
  }

  const {
    message,
    toolResults = {},
    streaming = false,
    textOverride,
    compact = false,
    onArtifactCallback,
    onChoice,
  }: Props = $props();

  // Permission badges (chat provenance) reuse the same tools.status data
  // /capabilities loads — fetched once per session, fail-silent on older
  // gateways that don't send `permission` yet.
  $effect(() => {
    ensureToolCatalogLoaded();
  });

  function toolPermission(name: string): ToolPermission | undefined {
    return toolCatalog.byId[name]?.permission;
  }
  function permissionTitle(perm: ToolPermission): string {
    const label = toolPermissionLabel(perm);
    return isToolPermissionAllowed(perm)
      ? m.chat_tool_permissionAllowed({ perm: label })
      : m.chat_tool_permissionDenied({ perm: label });
  }

  // ── chat_artifact (C6): interactive card rendered from a tool_use block ──
  function isArtifactButton(v: unknown): v is ArtifactButton {
    return (
      !!v &&
      typeof v === 'object' &&
      typeof (v as ArtifactButton).text === 'string' &&
      typeof (v as ArtifactButton).callback_data === 'string'
    );
  }

  function artifactInput(input: unknown): ArtifactInput | null {
    if (!input || typeof input !== 'object') return null;
    const obj = input as Record<string, unknown>;
    if (typeof obj.html !== 'string') return null;
    // Models emit both row form ([[btn,btn]]) and flat form ([btn,btn]) —
    // normalize to rows and drop malformed entries.
    let buttons: ArtifactButton[][] | undefined;
    if (Array.isArray(obj.buttons)) {
      const raw = obj.buttons as unknown[];
      const rows = raw.every(Array.isArray) ? (raw as unknown[][]) : [raw];
      const clean = rows.map((row) => row.filter(isArtifactButton)).filter((row) => row.length > 0);
      buttons = clean.length > 0 ? clean : undefined;
    }
    return {
      title: typeof obj.title === 'string' ? obj.title : undefined,
      html: obj.html,
      buttons,
    };
  }

  /** Inline the hub's current --color-* custom props so the sandboxed iframe themes to match. */
  function themedSrcdoc(html: string): string {
    if (typeof document === 'undefined') return html;
    const vars: string[] = [];
    const seen = new Set<string>();
    const collect = (style: CSSStyleDeclaration) => {
      for (let i = 0; i < style.length; i++) {
        const k = style[i];
        if (k.startsWith('--') && !seen.has(k)) {
          seen.add(k);
          vars.push(`${k}:${style.getPropertyValue(k)}`);
        }
      }
    };
    collect(document.documentElement.style);
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText === ':root') collect(rule.style);
      }
    }
    return `<style>:root{${vars.join(';')}}</style>${html}`;
  }

  let clickedArtifacts = $state(new Set<string>());
  function handleArtifactClick(blockId: string, callbackData: string) {
    if (!onArtifactCallback || clickedArtifacts.has(blockId)) return;
    clickedArtifacts = new Set(clickedArtifacts).add(blockId);
    onArtifactCallback(callbackData);
  }

  const blocks = $derived(normalizeBlocks(message.content));

  // Reasoning + tool activity render OUTSIDE the answer bubble (so a sequence of
  // tool calls reads as a quiet list above the reply); text/images are the reply.
  const bodyBlocks = $derived(blocks.filter((b) => b.kind === 'text' || b.kind === 'image'));

  // Consecutive tool calls collapse into ONE "N tool uses" row (level 1) that
  // expands to the per-tool rows (level 2), each expanding to input/output
  // (level 3). Reasoning is not a tool — it breaks the grouping.
  type ToolBlock = Extract<ChatBlock, { kind: 'tool' }>;
  type MetaGroup =
    | { kind: 'thinking'; text: string }
    | { kind: 'tools'; tools: ToolBlock[] }
    | { kind: 'artifact'; block: ToolBlock };
  const metaGroups = $derived.by<MetaGroup[]>(() => {
    const groups: MetaGroup[] = [];
    for (const b of blocks) {
      if (b.kind === 'thinking') {
        groups.push({ kind: 'thinking', text: b.text });
      } else if (b.kind === 'tool') {
        // chat_artifact (C6) is never collapsed into the "N tool uses" group —
        // it's an interactive card, not a quiet tool row.
        if (b.name === 'chat_artifact') {
          groups.push({ kind: 'artifact', block: b });
          continue;
        }
        const last = groups.at(-1);
        if (last?.kind === 'tools') last.tools.push(b);
        else groups.push({ kind: 'tools', tools: [b] });
      }
    }
    return groups;
  });

  // TODO(handoff): the live turn only knows results that reached committed
  // history, so a tool that finished mid-stream keeps spinning until the turn
  // commits (same as the old Loader). Feed chat.liveTools completion in.
  // Ledger: meta proposals/2026-10-17-hub-ai-chat-kit-followups.md item 2.
  function toolStatus(block: ToolBlock): AIToolStatus {
    const r = block.id ? toolResults[block.id] : undefined;
    if (r) return r.isError ? 'error' : 'success';
    return streaming ? 'running' : 'idle';
  }
  function groupStatus(tools: ToolBlock[]): AIToolStatus {
    const all = tools.map(toolStatus);
    if (all.includes('running')) return 'running';
    if (all.includes('error')) return 'error';
    return all.every((x) => x === 'success') ? 'success' : 'idle';
  }

  // The answer has started once any reply text is on screen; until then the
  // newest reasoning trace is the thing being produced.
  const answerStarted = $derived(
    textOverride !== undefined ? textOverride.length > 0 : bodyBlocks.length > 0,
  );
  const sources = $derived(turnSources(blocks, toolResults));

  function fmtInput(input: unknown): string {
    if (input === undefined || input === null) return '';
    if (typeof input === 'string') return input;
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }
  function preview(input: unknown): string {
    const s = typeof input === 'string' ? input : fmtInput(input).replace(/\s+/g, ' ');
    return s.length > 56 ? s.slice(0, 56) + '…' : s;
  }
</script>

{#snippet toolRow(block: ToolBlock)}
  {@const result = block.id ? toolResults[block.id] : undefined}
  {@const perm = toolPermission(block.name)}
  <AiToolCall
    name={block.name}
    status={toolStatus(block)}
    input={fmtInput(block.input) || undefined}
    result={result?.content}
    summary={preview(block.input) || undefined}
    {compact}
  >
    {#snippet meta()}
      {#if perm}
        <span class="perm-chip" title={permissionTitle(perm)}>{toolPermissionLabel(perm)}</span>
      {/if}
    {/snippet}
  </AiToolCall>
{/snippet}

{#snippet artifactBlock(block: ToolBlock)}
  {@const data = artifactInput(block.input)}
  {#if data}
    {@const clicked = clickedArtifacts.has(block.id)}
    <div class="artifact-block">
      {#if data.title}<div class="artifact-title">{data.title}</div>{/if}
      <!-- Buttons-only artifacts (a choice prompt) skip the empty frame. -->
      {#if data.html.trim()}
        <iframe
          class="artifact-frame"
          sandbox="allow-scripts"
          srcdoc={themedSrcdoc(data.html)}
          title={data.title ?? m.chat_artifact_title()}
        ></iframe>
      {/if}
      {#if data.buttons?.length}
        <div class="artifact-buttons">
          {#each data.buttons as row, ri (ri)}
            <div class="artifact-button-row">
              {#each row as btn, bi (bi)}
                <Button
                  variant="ghost"
                  type="button"
                  class="artifact-btn {btn.style ?? 'primary'}"
                  disabled={clicked || !onArtifactCallback}
                  onclick={() => handleArtifactClick(block.id, btn.callback_data)}
                >
                  {btn.text}
                </Button>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <div class="artifact-error">{m.chat_artifact_invalid()}</div>
  {/if}
{/snippet}

<div class="turn" class:compact>
  {#each metaGroups as group, i (i)}
    {#if group.kind === 'thinking'}
      <AiReasoning
        text={group.text}
        active={streaming && !answerStarted && i === metaGroups.length - 1}
        {compact}
      />
    {:else if group.kind === 'artifact'}
      {@render artifactBlock(group.block)}
    {:else if group.tools.length === 1}
      {@render toolRow(group.tools[0])}
    {:else}
      <AiToolCall
        name={m.ai_toolUses({ count: group.tools.length })}
        mono={false}
        status={groupStatus(group.tools)}
        summary={[...new Set(group.tools.map((t) => t.name))].join(' · ')}
        {compact}
      >
        <div class="group-body">
          {#each group.tools as block, j (j)}
            {@render toolRow(block)}
          {/each}
        </div>
      </AiToolCall>
    {/if}
  {/each}

  {#if textOverride !== undefined}
    {#if textOverride.length > 0}
      <div class="answer" class:streaming class:compact>
        <MarkdownMessage value={stripTtsTags(textOverride)} tone="assistant" {onChoice} />
      </div>
    {/if}
  {:else if bodyBlocks.length > 0}
    <div class="answer" class:streaming class:compact>
      {#each bodyBlocks as block, i (i)}
        {#if block.kind === 'text'}
          <MarkdownMessage value={stripTtsTags(block.text)} tone="assistant" {onChoice} />
        {:else if block.kind === 'image'}
          <div class="img-chip">🖼 Image</div>
        {/if}
      {/each}
    </div>
  {/if}

  {#if sources.length > 0 && (!streaming || answerStarted)}
    <AiSources {sources} />
  {/if}
</div>

<style>
  .turn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    width: 100%;
    min-width: 0;
  }

  /* Permission provenance chip on a tool row (chat_tool). */
  .perm-chip {
    flex-shrink: 0;
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-telemetry);
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 12%, transparent);
    color: color-mix(in srgb, var(--color-foreground) 45%, transparent);
  }

  /* ── chat_artifact (C6): sandboxed interactive card ── */
  .artifact-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
    max-width: 85%;
  }
  .turn.compact .artifact-block {
    max-width: 100%;
  }
  .artifact-title {
    font-size: var(--font-size-caption);
    font-weight: 600;
    color: color-mix(in srgb, var(--color-foreground) 80%, transparent);
  }
  .artifact-frame {
    width: 100%;
    height: 260px;
    min-height: 120px;
    max-height: 420px;
    border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-foreground) 2%, transparent);
  }
  .artifact-buttons {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .artifact-button-row {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  :global(.artifact-btn) {
    font: inherit;
    font-size: var(--font-size-caption);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 12%, transparent);
    background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
    color: var(--color-foreground);
    cursor: pointer;
    transition: filter 120ms var(--ease-standard);
  }
  :global(.artifact-btn:hover:not(:disabled)) {
    filter: brightness(1.1);
  }
  :global(.artifact-btn:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  :global(.artifact-btn.primary) {
    border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
    color: var(--color-accent);
  }
  :global(.artifact-btn.success) {
    border-color: color-mix(
      in srgb,
      var(--color-success, var(--color-success-fg)) 40%,
      transparent
    );
    color: var(--color-success, var(--color-success-fg));
  }
  :global(.artifact-btn.danger) {
    border-color: var(--color-danger-border);
    color: var(--color-danger-fg);
  }
  .artifact-error {
    font-size: var(--font-size-caption);
    font-style: italic;
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
  }

  /* Level-2 list inside a collapsed "N tool uses" group. */
  /* Level-2 rows sit inside the group's own indented body. */
  .group-body {
    margin-left: calc(var(--space-4) * -1);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  /* ── The answer bubble (text only) ── */
  .answer {
    max-width: 85%;
    border-radius: var(--radius-lg);
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-size-body);
    line-height: 1.5;
    color: color-mix(in srgb, var(--color-foreground) 90%, transparent);
    background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
    word-break: break-word;
  }
  .answer.compact {
    max-width: 100%;
    padding: var(--space-2) var(--space-2);
    font-size: var(--font-size-caption);
  }
  .answer.streaming {
    border-style: dashed;
    opacity: 0.92;
  }

  .img-chip {
    display: inline-block;
    font-size: var(--font-size-caption);
    color: color-mix(in srgb, var(--color-foreground) 55%, transparent);
    padding: var(--space-1) var(--space-2);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
    border-radius: var(--radius-md);
  }
</style>
