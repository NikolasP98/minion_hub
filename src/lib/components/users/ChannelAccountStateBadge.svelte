<script lang="ts">
  import { iconSizes, Spinner } from '$lib/components/ui';
  import {
    AlertTriangle,
    CircleCheck,
    CircleOff,
    Link2,
    PauseCircle,
    RefreshCw,
  } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import type { ChannelAccountUiState } from './channel-account-state';

  let { state }: { state: ChannelAccountUiState } = $props();

  const presentation = $derived.by(() => {
    switch (state) {
      case 'unlinked':
        return {
          label: m.usersui_channelStateUnlinked(),
          tone: 'border-border bg-surface-3 text-muted-foreground',
          icon: CircleOff,
        };
      case 'claimed':
        return {
          label: m.usersui_channelStateClaimed(),
          tone: 'border-info/30 bg-info/15 text-info',
          icon: Link2,
        };
      case 'syncing':
        return {
          label: m.usersui_channelStateSyncing(),
          tone: 'border-info/30 bg-info/15 text-info',
          icon: null,
        };
      case 'sync-paused':
        return {
          label: m.usersui_channelStateSyncPaused(),
          tone: 'border-warning/30 bg-warning/15 text-warning',
          icon: PauseCircle,
        };
      case 'reconnecting':
        return {
          label: m.usersui_channelStateReconnecting(),
          tone: 'border-warning/30 bg-warning/15 text-warning',
          icon: RefreshCw,
        };
      case 'sync-offline':
        return {
          label: m.usersui_channelStateSyncOffline(),
          tone: 'border-warning/30 bg-warning/15 text-warning',
          icon: CircleOff,
        };
      case 'connection-issue':
        return {
          label: m.usersui_channelStateConnectionIssue(),
          tone: 'border-destructive/30 bg-destructive/15 text-destructive',
          icon: AlertTriangle,
        };
      default:
        return {
          label: m.usersui_channelStateSyncActive(),
          tone: 'border-success/30 bg-success/15 text-success',
          icon: CircleCheck,
        };
    }
  });
</script>

<span
  class="t-telemetry inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 font-medium {presentation.tone}"
  data-account-state={state}
>
  {#if state === 'syncing'}
    <Spinner size="xs" label={presentation.label} />
  {:else if presentation.icon}
    {@const Icon = presentation.icon}
    <Icon size={iconSizes.xs} />
  {/if}
  {presentation.label}
</span>
