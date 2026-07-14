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
    ok: { bg: 'bg-success/10', fg: 'text-success', dot: 'bg-success', text: 'Configured' },
    invalid: { bg: 'bg-destructive/10', fg: 'text-destructive', dot: 'bg-destructive', text: 'Invalid' },
    missing: { bg: 'bg-muted/10', fg: 'text-muted-foreground', dot: 'bg-muted-foreground', text: 'Missing' },
    unknown: { bg: 'bg-warning/10', fg: 'text-warning', dot: 'bg-warning', text: 'Unchecked' },
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
