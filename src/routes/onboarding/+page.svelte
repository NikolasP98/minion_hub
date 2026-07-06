<script lang="ts">
  import { goto, invalidate } from '$app/navigation';
  import { createHotkey } from '$lib/hotkeys';
  import * as m from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import OrbAnimation from '$lib/components/onboarding/OrbAnimation.svelte';
  import StepAwaken from '$lib/components/onboarding/StepAwaken.svelte';
  import StepRemember from '$lib/components/onboarding/StepRemember.svelte';
  import StepConnect from '$lib/components/onboarding/StepConnect.svelte';
  import StepIndicator from '$lib/components/onboarding/StepIndicator.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { toastAsync } from '$lib/state/ui/toast.svelte';


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

  // Bare arrows are input-safe by lib default — won't fire while typing in
  // this page's text fields (name, timezone, etc.).
  createHotkey('ArrowRight', next, {
    meta: { name: m.shortcuts_onboardingNext() },
  });
  createHotkey('ArrowLeft', prev, {
    meta: { name: m.shortcuts_onboardingPrev() },
  });

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
      await toastAsync(
        (async () => {
          // Provisioning (agents.create + config.patch) requires the
          // operator.admin gateway scope, which member users don't have. The
          // hub performs those privileged calls server-side with the system
          // gateway credentials, gated to this user's own pending personal
          // agent — see POST /api/personal-agent/create.
          const res = await fetch('/api/personal-agent/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, personality, personalityText: personalityText() }),
          });
          if (!res.ok) {
            const d = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(d.error ?? `Provisioning failed (${res.status})`);
          }
          await invalidate('app:personalAgent');
          goto(`/onboarding/complete?name=${encodeURIComponent(name)}&vibe=${encodeURIComponent(personality)}`);
        })(),
        {
          loading: 'Creating your personal agent…',
          getOutcome: () => ({ type: 'success', title: 'Agent created' }),
          onError: (err: unknown) => ({
            title: 'Failed to create agent',
            description: err instanceof Error ? err.message : String(err),
          }),
        },
      );
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
