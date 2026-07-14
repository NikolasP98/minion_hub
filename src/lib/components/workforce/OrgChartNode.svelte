<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';

  export type OrgNodeData = {
    name: string;
    role: string;
    status: string;
    title?: string | null;
    adapterType?: string | null;
    isRoot?: boolean;
    orientation?: 'vertical' | 'horizontal';
    avatarUrl?: string | null;
  };

  let { data }: NodeProps & { data: OrgNodeData } = $props();

  // Fall back to initials if the DiceBear avatar fails to load (e.g. offline).
  let avatarFailed = $state(false);

  // Handles follow the tree orientation so edges leave/enter the correct side:
  // vertical tree flows top→bottom, horizontal tree flows left→right.
  const targetPos = $derived(data.orientation === 'horizontal' ? Position.Left : Position.Top);
  const sourcePos = $derived(data.orientation === 'horizontal' ? Position.Right : Position.Bottom);

  const STATUS_DOT: Record<string, string> = {
    active: 'var(--color-success)',
    running: 'var(--color-accent)',
    paused: 'var(--color-warning)',
    error: 'var(--color-brand)',
    idle: 'var(--color-muted-foreground)',
  };
  const dot = $derived(STATUS_DOT[data.status] ?? 'var(--color-muted-foreground)');
  const initials = $derived(
    data.name
      .split(' ')
      .map((w) => w[0])
      .slice(0, 2)
      .join(''),
  );
  const roleLabel = $derived(
    data.role.charAt(0).toUpperCase() + data.role.slice(1).replaceAll('_', ' '),
  );
</script>

<!-- Inbound handle for everyone but a root (top for vertical, left for horizontal) -->
{#if !data.isRoot}
  <Handle type="target" position={targetPos} class="!h-2 !w-2 !border-2 !border-border !bg-muted" />
{/if}

<div
  class="bg-card border-border hover:border-foreground/30 flex min-h-[88px] w-[220px] select-none rounded-lg border shadow-sm transition-[box-shadow,border-color] duration-[var(--duration-fast)] hover:shadow-md"
>
  <div class="flex w-full items-center gap-3 px-4 py-3">
    <div class="relative shrink-0">
      <div
        class="bg-muted text-foreground/70 flex h-10 w-10 items-center justify-center overflow-hidden rounded-full text-sm font-semibold"
      >
        {#if data.avatarUrl && !avatarFailed}
          <img
            src={data.avatarUrl}
            alt={data.name}
            class="h-full w-full object-cover"
            loading="lazy"
            onerror={() => (avatarFailed = true)}
          />
        {:else}
          {initials}
        {/if}
      </div>
      <span
        class="border-card absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2"
        style="background:{dot}"
        title={data.status}
      ></span>
    </div>
    <div class="flex min-w-0 flex-1 flex-col items-start">
      <span class="text-foreground w-full truncate text-sm font-semibold leading-tight">
        {data.name}
      </span>
      <span
        class="text-muted-foreground mt-0.5 text-[length:var(--font-size-caption)] leading-tight"
      >
        {data.title ?? roleLabel}
      </span>
      {#if data.adapterType}
        <span
          class="text-muted-strong mt-1 font-mono text-[length:var(--font-size-telemetry)] leading-tight"
        >
          {data.adapterType}
        </span>
      {/if}
    </div>
  </div>
</div>

<!-- Outbound handle to reports (bottom for vertical, right for horizontal) -->
<Handle type="source" position={sourcePos} class="!h-2 !w-2 !border-2 !border-border !bg-muted" />
