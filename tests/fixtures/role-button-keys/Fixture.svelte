<script lang="ts">
  // HC-027 Chromium fixture: representative role="button" sites with synthetic
  // props. Activation counters live on window.__hc027 for the CDP driver.
  import AgentGroupHeader from '$lib/components/agents/AgentGroupHeader.svelte';
  import AgentDashboard from '$lib/components/agents/AgentDashboard.svelte';
  import EmailCard from '$lib/components/my-agent/EmailCard.svelte';
  import AgentCard from '$lib/components/marketplace/AgentCard.svelte';
  import PortalOverlay from '$lib/components/workshop/PortalOverlay.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';

  conn.connected = false;
  const counters = { groupToggle: 0, groupDelete: 0, emailOpen: 0, portalClose: 0 };
  Object.assign(window, { __hc027: counters, __hc027ui: ui });
  Object.assign(globalThis, { confirm: () => true });

  let portal = $state(false);
</script>

<main>
  <h1>HC-027 role="button" keyboard fixture</h1>
  <section id="group" style="width: 320px">
    <AgentGroupHeader
      group={{ id: 'g1', name: 'Group', sortOrder: 0, memberAgentIds: [] }}
      onToggle={() => counters.groupToggle++}
      onRename={() => {}}
      onDelete={() => counters.groupDelete++}
      onDrop={() => {}}
      onDragOver={() => {}}
      onDragLeave={() => {}}
    />
  </section>
  <section id="dashboard" style="width: 900px">
    <AgentDashboard agentId="agent-alpha" agent={{ id: 'agent-alpha', name: 'Alpha' } as never} />
  </section>
  <section id="email" style="width: 420px">
    <EmailCard
      item={{
        id: 'e1',
        sourceEmail: 'me@x',
        from: 'Ana <ana@x>',
        fromName: 'Ana',
        subject: 'Booking',
        date: '',
        receivedAt: null,
        snippet: 'See you',
        labels: [],
      } as never}
      onopen={() => counters.emailOpen++}
      nowMs={0}
    />
  </section>
  <section id="card" style="width: 320px">
    <AgentCard
      agent={{
        id: 'm1',
        name: 'Card Agent',
        role: 'Analyst',
        catchphrase: 'Hi',
        description: 'desc',
        tags: '[]',
        category: 'ops',
        version: '1',
        installCount: 0,
        avatarSeed: 'seed',
        archetype: 'copilot',
      } as never}
    />
  </section>
  <section id="portal-host">
    <button id="open-portal" onclick={() => (portal = true)}>Open portal overlay</button>
  </section>
</main>

{#if portal}
  <PortalOverlay
    elementId="el"
    onClose={() => {
      counters.portalClose++;
      portal = false;
    }}
  />
{/if}
