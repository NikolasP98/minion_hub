<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';
  import OrbAnimation from '$lib/components/onboarding/OrbAnimation.svelte';
  import StepAwaken from '$lib/components/onboarding/StepAwaken.svelte';
  import StepRemember from '$lib/components/onboarding/StepRemember.svelte';
  import StepConnect from '$lib/components/onboarding/StepConnect.svelte';
  import StepIndicator from '$lib/components/onboarding/StepIndicator.svelte';

  let { data, form }: { data: PageData; form: any } = $props();

  let step = $state(1);
  const totalSteps = 3;

  let agentName = $state('');
  let personality = $state<'professional' | 'casual' | 'creative' | 'direct'>('casual');
  let userName = $state('');
  let timezone = $state('America/Lima');
  let language = $state('es');
  let userContext = $state('');

  let orbPhase = $derived(
    step === 1 ? ('awakening' as const) :
    step === 2 ? ('forming' as const) :
    step === 3 ? ('connecting' as const) :
    ('dormant' as const)
  );

  function next() { if (step < totalSteps) step++; }
  function prev() { if (step > 1) step--; }
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
      <form method="POST" action="?/complete" use:enhance>
        <input type="hidden" name="agentName" value={agentName} />
        <input type="hidden" name="personality" value={personality} />
        <input type="hidden" name="userName" value={userName} />
        <input type="hidden" name="timezone" value={timezone} />
        <input type="hidden" name="language" value={language} />
        <input type="hidden" name="userContext" value={userContext} />
        <StepConnect onsubmit={() => {}} {prev} error="" />
      </form>
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
    max-width: 520px;
    padding: 2rem 1rem;
    z-index: 1;
  }

  .card {
    background: rgba(20, 20, 40, 0.85);
    border: 1px solid rgba(99, 102, 241, 0.2);
    border-radius: 16px;
    padding: 2rem;
    width: 100%;
    backdrop-filter: blur(20px);
    box-shadow: 0 0 40px rgba(99, 102, 241, 0.08);
  }
</style>