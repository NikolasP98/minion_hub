<script lang="ts">
  import { Plus, Trash2, RefreshCw, History } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Popover, Button } from '$lib/components/ui';
  import { resolvePluginIcon } from '$lib/plugins/icon-map';
  import { iconComp } from '$lib/components/my-agent/note-icons';
  import type { ArtifactDescriptor } from '$lib/agents/artifacts';

  // Icon values can be: `lucide:<Name>` (shared picker), an emoji char (shared
  // picker), or a bare lucide name (legacy / built-ins). Resolve all three.
  const EMOJI_RE = /\p{Extended_Pictographic}/u;

  let {
    artifacts,
    canAdd = false,
    onopen,
    oncreate,
    ondelete,
    onregenerate,
    onhistory,
  }: {
    artifacts: ArtifactDescriptor[];
    canAdd?: boolean;
    onopen: (a: ArtifactDescriptor) => void;
    oncreate?: () => void;
    ondelete?: (a: ArtifactDescriptor) => void;
    onregenerate?: (a: ArtifactDescriptor) => void;
    onhistory?: (a: ArtifactDescriptor) => void;
  } = $props();
</script>

<div class="border-t border-border pt-3">
  <p
    class="mb-1.5 text-[length:var(--font-size-telemetry)] font-medium uppercase tracking-wide text-[var(--color-text-disabled)]"
  >
    {m.artifacts_label()}
  </p>
  <div class="flex flex-wrap items-center gap-2">
    {#each artifacts as a (a.id)}
      {@const lucide = a.icon?.startsWith('lucide:') ? iconComp(a.icon.slice(7)) : null}
      {@const isEmoji = !!a.icon && !a.icon.startsWith('lucide:') && EMOJI_RE.test(a.icon)}
      {@const Icon = lucide ?? (isEmoji ? null : resolvePluginIcon(a.icon))}
      <Popover placement="top">
        {#snippet trigger()}
          <Button
            variant="ghost"
            type="button"
            onclick={() => onopen(a)}
            aria-label={a.title}
            class="grid size-11 place-items-center rounded-lg border border-border bg-foreground/[0.03] text-muted transition-colors hover:border-[var(--color-border-strong)] hover:bg-foreground/10 hover:text-foreground"
          >
            {#if isEmoji}<span class="text-lg leading-none">{a.icon}</span
              >{:else if Icon && typeof Icon !== 'string'}<Icon size={18} />{/if}
          </Button>
        {/snippet}
        <div class="max-w-56 p-1">
          <p class="text-xs font-semibold text-foreground">{a.title}</p>
          <p
            class="mt-0.5 text-[length:var(--font-size-caption)] leading-snug text-muted-foreground"
          >
            {a.description}
          </p>
          {#if a.deletable && canAdd}
            <div class="mt-1.5 flex flex-col gap-0.5">
              <Button
                variant="ghost"
                type="button"
                onclick={() => onregenerate?.(a)}
                class="flex items-center gap-1 text-[length:var(--font-size-caption)] text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw size={11} />
                {m.artifact_regenerate()}
              </Button>
              <Button
                variant="ghost"
                type="button"
                onclick={() => onhistory?.(a)}
                class="flex items-center gap-1 text-[length:var(--font-size-caption)] text-muted-foreground hover:text-foreground transition-colors"
              >
                <History size={11} />
                {m.artifact_history()}
              </Button>
              <Button
                variant="ghost"
                type="button"
                onclick={() => ondelete?.(a)}
                class="flex items-center gap-1 text-[length:var(--font-size-caption)] text-[var(--color-danger-fg)] hover:text-[var(--color-danger-fg)] transition-colors"
              >
                <Trash2 size={11} />
                {m.artifact_delete()}
              </Button>
            </div>
          {/if}
        </div>
      </Popover>
    {/each}

    {#if canAdd}
      <Button
        variant="ghost"
        type="button"
        aria-label={m.artifact_add()}
        onclick={() => oncreate?.()}
        class="grid size-11 place-items-center rounded-lg border border-dashed border-[var(--color-border-strong)] text-foreground/40 transition-colors hover:border-foreground/40 hover:text-muted"
      >
        <Plus size={18} />
      </Button>
    {/if}
  </div>
</div>
