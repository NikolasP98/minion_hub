<script lang="ts">
  import { goto, invalidate } from '$app/navigation';
  import type { PageData } from './$types';
  import OrbAnimation from '$lib/components/onboarding/OrbAnimation.svelte';
  import StepAwaken from '$lib/components/onboarding/StepAwaken.svelte';
  import StepRemember from '$lib/components/onboarding/StepRemember.svelte';
  import StepConnect from '$lib/components/onboarding/StepConnect.svelte';
  import StepIndicator from '$lib/components/onboarding/StepIndicator.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';


  let { data }: { data: PageData } = $props();

  let step = $state(1);
  const totalSteps = 3;

  let agentName = $state('');
  let personality = $state<'professional' | 'casual' | 'creative' | 'technical'>('casual');
  // svelte-ignore state_referenced_locally
  let userName = $state(data.user.displayName ?? '');
  let timezone = $state('America/Lima');
  let language = $state('es');
  let userContext = $state('');
  let creating = $state(false);
  let createError = $state('');

  let orbPhase = $derived(
    step === 1 ? ('awakening' as const) :
    step === 2 ? ('forming' as const) :
    step === 3 ? ('connecting' as const) :
    ('dormant' as const)
  );

  function next() { if (step < totalSteps) step++; }
  function prev() { if (step > 1 && !creating) step--; }

  function personalityText(): string {
    const vibe = {
      professional: 'Precise, formal, business-ready, and careful with commitments.',
      casual: 'Relaxed, friendly, conversational, and easy to work with.',
      creative: 'Inventive, bold, proactive, and comfortable brainstorming outside the box.',
      technical: 'Direct, efficient, technically sharp, and concise. Avoid fluff.',
    }[personality];

    const parts = [
      vibe,
      userName.trim() ? `Call the user ${userName.trim()}.` : '',
      `Preferred language: ${language}.`,
      `User timezone: ${timezone}.`,
      userContext.trim() ? `User context: ${userContext.trim()}` : '',
    ];
    return parts.filter(Boolean).join('\n');
  }

  async function createPersonalAgent() {
    if (creating) return;
    createError = '';
    if (!conn.connected) {
      createError = 'Connect to a gateway before creating your personal agent.';
      return;
    }

    const name = agentName.trim();
    if (!name) {
      step = 1;
      createError = 'Give your agent a name first.';
      return;
    }

    creating = true;
    try {
      const provisionRes = await fetch('/api/personal-agent/provision');
      if (!provisionRes.ok) {
        throw new Error(`Provisioning check failed (${provisionRes.status})`);
      }
      const provision = (await provisionRes.json()) as {
        needsProvisioning?: boolean;
        payload?: { name: string; workspace: string };
      };
      if (!provision.needsProvisioning || !provision.payload) {
        throw new Error('No pending personal agent was found for this user. Refresh and try again.');
      }
      const createPayload = provision.payload;
      const createResult = (await sendRequest('agents.create', createPayload)) as { agentId?: string } | null;
      const agentId = createResult?.agentId ?? createPayload.name;

      await sendRequest('config.patch', {
        raw: JSON.stringify({
          agents: {
            list: [
              {
                id: agentId,
                name,
                identity: { name },
                personality: {
                  preset: personality,
                  configured: true,
                  conversationName: name,
                  text: personalityText(),
                },
                contextMode: 'personal',
                systemPromptUserAwareness: 'full',
              },
            ],
          },
        }),
        note: `Create personal agent ${agentId} from onboarding`,
      });

      await fetch('/api/personal-agent/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      await invalidate('app:personalAgent');
      goto(`/onboarding/complete?name=${encodeURIComponent(name)}&vibe=${encodeURIComponent(personality)}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      createError = message;
      await fetch('/api/personal-agent/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'error', error: message }),
      }).catch(() => {});
    } finally {
      creating = false;
    }
  }
</script>

<svelte:head>
  <title>Awaken Your Agent — Minion Hub</title>
</svelte:head>

<div class="wizard">
  <OrbAnimation phase={orbPhase} agentName={agentName} />

  <div class="card">
    <StepIndicator {step} {totalSteps} />

    {#if step === 1}
      <StepAwaken bind:agentName bind:personality {next} />
    {:else if step === 2}
      <StepRemember bind:userName bind:timezone bind:language bind:userContext {next} {prev} />
    {:else if step === 3}
      <StepConnect
        userId={data.user.id}
        identities={data.identities}
        onfinish={createPersonalAgent}
        {prev}
        busy={creating}
        error={createError}
      />
    {/if}
  </div>
</div>

<style>
  .wizard {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2rem;
    width: 100%;
    max-width: 640px;
    padding: 2rem 1rem;
    z-index: 1;
  }

  .card {
    background: var(--elevation-2-bg);
    border: 1px solid var(--elevation-2-border);
    border-radius: var(--radius-xl);
    padding: 2rem;
    width: 100%;
    backdrop-filter: blur(20px);
    box-shadow: var(--shadow-lg);
  }
</style>
