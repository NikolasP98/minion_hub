<script lang="ts">
  import type { SecretsProbeStatus } from '$lib/types/secrets';

  interface Props {
    status: SecretsProbeStatus;
    label?: string;
    message?: string | null;
  }

  let { status, label, message }: Props = $props();

  const palette: Record<
    SecretsProbeStatus,
    { bg: string; fg: string; dot: string; text: string }
  > = {
    ok: { bg: 'bg-emerald-500/10', fg: 'text-emerald-300', dot: 'bg-emerald-400', text: 'Configured' },
    invalid: { bg: 'bg-rose-500/10', fg: 'text-rose-300', dot: 'bg-rose-400', text: 'Invalid' },
    missing: { bg: 'bg-zinc-500/10', fg: 'text-zinc-300', dot: 'bg-zinc-400', text: 'Missing' },
    unknown: { bg: 'bg-amber-500/10', fg: 'text-amber-300', dot: 'bg-amber-400', text: 'Unchecked' },
  };

  const p = $derived(palette[status]);
</script>

<span
  class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs {p.bg} {p.fg}"
  title={message ?? ''}
>
  <span class="size-1.5 rounded-full {p.dot}"></span>
  {label ?? p.text}
</span>
