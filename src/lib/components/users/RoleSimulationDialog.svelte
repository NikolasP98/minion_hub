<script lang="ts" module>
  import * as messages from '$lib/paraglide/messages';
  import { RoleSimulationClientError } from '$lib/services/role-simulation-client';

  export function simulationErrorMessage(error: unknown): string {
    const code = error instanceof RoleSimulationClientError ? error.code : 'unknown';
    if (code === 'dirty') return messages.roleSimulation_dirty();
    if (code === 'pending' || code === 'busy') return messages.roleSimulation_pending();
    if (code === 'attention') return messages.roleSimulation_attention();
    if (code === 'unknown' || code === 'stale') return messages.roleSimulation_unknown();
    return messages.roleSimulation_error();
  }
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { page } from '$app/state';
  import { Button, Input, Radio } from '@minion-stack/ui';
  import Sheet from '$lib/components/ui/foundations/Sheet.svelte';
  import { AUTHORITY_DIALOG_CLASS } from '$lib/components/layout/floating-assistant-modal';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { tryUseActions } from '$lib/services/actions/context';
  import { transitionRoleSimulation } from '$lib/services/role-simulation-client';
  import type { RoleSimulationState } from '$lib/role-simulation';
  import * as m from '$lib/paraglide/messages';

  let {
    open = $bindable(false),
    state: simulation,
  }: { open?: boolean; state: RoleSimulationState } = $props();
  const actions = tryUseActions();
  const groupName = $props.id();
  let query = $state('');
  let selected = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let uncertain = $state(false);
  let previousSession = '';
  let disposed = false;
  const filtered = $derived(
    simulation.roles.filter((role) =>
      `${role.name} ${role.key}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    ),
  );
  const selection = $derived(
    simulation.roles.find((role) => role.key === selected && role.selectable),
  );

  $effect(() => {
    const session = open ? `${simulation.orgId}:${simulation.generation}` : '';
    if (session !== previousSession) {
      previousSession = session;
      query = '';
      selected = '';
      error = null;
      uncertain = false;
    }
  });
  onDestroy(() => {
    disposed = true;
  });

  async function apply() {
    if (busy || !selection || uncertain || !simulation.eligible || simulation.active) return;
    const captured = simulation;
    busy = true;
    error = null;
    try {
      await transitionRoleSimulation({
        state: captured,
        roleKey: selection.key,
        returnTo: page.url.pathname + page.url.search + page.url.hash,
        actions,
      });
    } catch (failure) {
      if (
        disposed ||
        simulation.orgId !== captured.orgId ||
        simulation.generation !== captured.generation
      )
        return;
      error = simulationErrorMessage(failure);
      uncertain =
        failure instanceof RoleSimulationClientError && ['unknown', 'stale'].includes(failure.code);
    } finally {
      if (!disposed) busy = false;
    }
  }
</script>

<Sheet
  class={AUTHORITY_DIALOG_CLASS}
  bind:open
  title={m.roleSimulation_title()}
  description={simulation.orgName ?? undefined}
  guardDismiss={false}
  dismissible={!busy && !uncertain}
  hideClose={busy || uncertain}
  size="md"
  initialFocus="[data-role-simulation-search]"
>
  <div class="simulation-picker">
    <Input
      type="search"
      size="touch"
      label={m.roleSimulation_search()}
      bind:value={query}
      disabled={busy}
      data-role-simulation-search
      autocomplete="off"
    />
    <div role="radiogroup" aria-label={m.roleSimulation_choose()} class="roles">
      {#each filtered as role (role.key)}
        <div class:selected={selected === role.key} class="role-choice">
          <Radio
            bind:group={selected}
            name={groupName}
            value={role.key}
            label={role.name}
            disabled={!role.selectable || busy}
            helper={!role.selectable
              ? role.reason === 'owner'
                ? m.roleSimulation_owner()
                : m.roleSimulation_authority()
              : undefined}
          />
        </div>
      {:else}
        <EmptyState title={m.roleSimulation_noRoles()} compact />
      {/each}
    </div>
    {#if error}
      <p class="picker-error t-caption" role="alert">{error}</p>
    {/if}
  </div>
  {#snippet footer()}
    <div class="picker-footer">
      <p class="t-caption warning">{m.roleSimulation_warning()}</p>
      <div class="picker-actions">
        <Button
          size="touch"
          variant="ghost"
          disabled={busy || uncertain}
          onclick={() => {
            open = false;
          }}
        >
          {m.common_cancel()}
        </Button>
        {#if uncertain}
          <Button size="touch" variant="primary" onclick={() => window.location.reload()}>
            {m.roleSimulation_refresh()}
          </Button>
        {:else}
          <Button
            size="touch"
            variant="primary"
            loading={busy}
            disabled={!selection || !simulation.eligible || simulation.active}
            onclick={apply}
          >
            {m.roleSimulation_apply()}
          </Button>
        {/if}
      </div>
    </div>
  {/snippet}
</Sheet>

<style>
  .simulation-picker,
  .roles,
  .picker-footer {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-3);
  }
  .roles {
    gap: var(--space-1);
  }
  .role-choice {
    min-width: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    padding: var(--space-3);
  }
  .role-choice.selected {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, var(--color-overlay));
  }
  .role-choice :global([data-part='radio-label']) {
    min-height: var(--control-height-touch);
    display: flex;
    align-items: center;
    overflow-wrap: anywhere;
    cursor: pointer;
  }
  .role-choice :global([data-part='radio']) {
    margin-top: var(--space-3);
  }
  .role-choice :global([data-part='radio-field'] > div) {
    flex: 1;
  }
  .picker-error {
    color: var(--color-danger-fg);
    overflow-wrap: anywhere;
  }
  .picker-footer {
    width: 100%;
  }
  .warning {
    color: var(--color-text-secondary);
  }
  .picker-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    justify-content: flex-end;
  }
</style>
