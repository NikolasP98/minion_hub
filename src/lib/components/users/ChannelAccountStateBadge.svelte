<script lang="ts">
  import { Badge } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type { ChannelAccountUiState } from './channel-account-state';

  let { state }: { state: ChannelAccountUiState } = $props();

  const presentation = $derived.by(() => {
    switch (state) {
      case 'unlinked':
        return {
          label: m.usersui_channelStateUnlinked(),
          variant: 'neutral' as const,
          value: undefined,
          pulse: false,
        };
      case 'claimed':
        return {
          label: m.usersui_channelStateClaimed(),
          variant: 'semantic' as const,
          value: 'info' as const,
          pulse: false,
        };
      case 'syncing':
        return {
          label: m.usersui_channelStateSyncing(),
          variant: 'semantic' as const,
          value: 'info' as const,
          pulse: true,
        };
      case 'sync-paused':
        return {
          label: m.usersui_channelStateSyncPaused(),
          variant: 'semantic' as const,
          value: 'warning' as const,
          pulse: false,
        };
      case 'reconnecting':
        return {
          label: m.usersui_channelStateReconnecting(),
          variant: 'semantic' as const,
          value: 'warning' as const,
          pulse: true,
        };
      case 'sync-offline':
        return {
          label: m.usersui_channelStateSyncOffline(),
          variant: 'semantic' as const,
          value: 'warning' as const,
          pulse: false,
        };
      case 'connection-issue':
        return {
          label: m.usersui_channelStateConnectionIssue(),
          variant: 'semantic' as const,
          value: 'error' as const,
          pulse: false,
        };
      default:
        return {
          label: m.usersui_channelStateSyncActive(),
          variant: 'semantic' as const,
          value: 'success' as const,
          pulse: false,
        };
    }
  });
</script>

<Badge
  variant={presentation.variant}
  value={presentation.value}
  size="sm"
  dot
  pulse={presentation.pulse}
  class="!rounded-full"
>
  {presentation.label}
</Badge>
