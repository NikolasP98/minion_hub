<script lang="ts">
  import { Badge, SegmentedControl } from '$lib/components/ui';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { configState, loadBaseHash, beginRestart } from '$lib/state/config/config.svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import {
    INHERIT,
    effectiveMode,
    historySyncPatch,
    readAccountHistorySync,
    readGlobalHistorySync,
    selectedChoice,
    type HistorySyncChoice,
    type HistorySyncMode,
  } from './history-sync';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    /** WhatsApp accountId for the per-account override; omit for the global default. */
    accountId?: string | null;
  }
  let { accountId = null }: Props = $props();

  const scope = $derived(accountId ? ('account' as const) : ('global' as const));

  // Module-scope `m.x()` in a const SSR-bakes locale 'en' — keep these as lazy refs.
  const MODE_LABELS: Record<HistorySyncMode, () => string> = {
    full: () => m.channelHistory_optionFull(),
    recent: () => m.channelHistory_optionRecent(),
    off: () => m.channelHistory_optionOff(),
  };
  const MODE_HINTS: Record<HistorySyncMode, () => string> = {
    full: () => m.channelHistory_hintFull(),
    recent: () => m.channelHistory_hintRecent(),
    off: () => m.channelHistory_hintOff(),
  };

  // The config snapshot is loaded once per page by ChannelsTab; this component
  // only ever asks the gateway for a fresh baseHash (never config.schema).
  const globalMode = $derived(readGlobalHistorySync(configState.current));
  const override = $derived(readAccountHistorySync(configState.current, accountId));

  /** Last successfully applied choice — the snapshot in `configState` is not
   *  refreshed here (a patch usually restarts the gateway), so this keeps the
   *  control showing what the user just saved. */
  let applied = $state<HistorySyncChoice | null>(null);
  let saving = $state(false);

  const choice = $derived(applied ?? selectedChoice(scope, globalMode, override));
  const effective = $derived(effectiveMode(choice, globalMode));
  const inheriting = $derived(scope === 'account' && choice === INHERIT);

  const items = $derived([
    ...(scope === 'account'
      ? [
          {
            value: INHERIT,
            label: m.channelHistory_optionDefault(),
            title: m.channelHistory_optionDefaultHint(),
          },
        ]
      : []),
    { value: 'full', label: MODE_LABELS.full(), title: MODE_HINTS.full() },
    { value: 'recent', label: MODE_LABELS.recent(), title: MODE_HINTS.recent() },
    { value: 'off', label: MODE_LABELS.off(), title: MODE_HINTS.off() },
  ]);

  /** config.patch needs a baseHash and ONLY a baseHash — loadBaseHash asks for
   *  config.get alone. loadConfig() also fires config.schema, whose gateway-side
   *  work regularly blows its 8s deadline and starves config.get on the same socket. */
  async function ensureBaseHash(): Promise<boolean> {
    if (configState.baseHash) return true;
    return !!(await loadBaseHash());
  }

  async function apply(next: string) {
    if (saving) return;
    const value = next as HistorySyncChoice;
    // Optimistic: SegmentedControl already moved its pill, so the parent's
    // `value` prop must move too — otherwise a failed save leaves the control
    // showing a setting the gateway never took.
    const prev = choice;
    applied = value;
    saving = true;
    try {
      if (!(await ensureBaseHash())) {
        // loadBaseHash stores the real cause — surface it instead of a generic string.
        applied = prev;
        toastError(
          m.channelHistory_saveFailed(),
          conn.connected
            ? (configState.loadError ?? m.channelHistory_configUnavailable())
            : m.channelHistory_disconnected(),
        );
        return;
      }
      const result = (await sendRequest('config.patch', {
        raw: JSON.stringify(historySyncPatch(accountId, value)),
        baseHash: configState.baseHash,
        note: `Set historySync=${value} for ${accountId ?? 'gateway default'} via Hub`,
      })) as { reloadMode?: string } | undefined;
      if ((result?.reloadMode ?? 'restart') === 'restart') {
        beginRestart();
        return;
      }
      await loadBaseHash(); // refresh baseHash for a follow-up patch (schema not needed)
      toastSuccess(m.channelHistory_saved());
    } catch (e) {
      const msg = (e as Error).message ?? '';
      if (msg.includes('closed') || msg.includes('not connected')) {
        beginRestart(); // the patch may well have landed — keep the new value
      } else {
        applied = prev;
        await loadBaseHash(); // a stale baseHash must not poison the retry
        toastError(m.channelHistory_saveFailed(), msg || m.channelHistory_configUnavailable());
      }
    } finally {
      saving = false;
    }
  }
</script>

<div>
  <div class="flex items-center gap-2 mb-2 flex-wrap">
    <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
      {scope === 'account' ? m.channelHistory_title() : m.channelHistory_globalTitle()}
    </h4>
    {#if scope === 'account'}
      <Badge variant="semantic" value={inheriting ? 'info' : 'accent'} size="sm">
        {inheriting
          ? m.channelHistory_inheriting({ mode: MODE_LABELS[effective]() })
          : m.channelHistory_overriding()}
      </Badge>
    {/if}
  </div>

  <SegmentedControl
    {items}
    value={choice}
    aria-label={scope === 'account' ? m.channelHistory_title() : m.channelHistory_globalTitle()}
    onValueChange={(v) => {
      if (!saving) void apply(v);
    }}
  />

  <p class="text-xs text-muted-foreground mt-1.5">
    {scope === 'account' ? MODE_HINTS[effective]() : m.channelHistory_globalHint()}
  </p>
  {#if scope === 'global'}
    <p class="text-xs text-muted-foreground mt-1">{MODE_HINTS[effective]()}</p>
  {/if}
</div>
