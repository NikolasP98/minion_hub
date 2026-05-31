<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import OrbAnimation from '$lib/components/onboarding/OrbAnimation.svelte';

  const name = page.url.searchParams.get('name') ?? 'Your Agent';
  const vibe = page.url.searchParams.get('vibe') ?? 'casual';

  let message = $state('');
  const fullMessage = "I'm alive. Let's get to work.";

  onMount(() => {
    let i = 0;
    const interval = setInterval(() => {
      if (i < fullMessage.length) {
        message += fullMessage[i];
        i++;
      } else {
        clearInterval(interval);
      }
    }, 40);
    return () => clearInterval(interval);
  });
</script>

<svelte:head>
  <title>{name} is Alive — Minion Hub</title>
</svelte:head>

<div class="complete">
  <OrbAnimation phase="connecting" agentName={name} />

  <div class="card">
    <h1>{name} is alive.</h1>
    <p class="agent-message">{message}<span class="cursor">|</span></p>
    <a href="/" class="btn-primary">Enter the Hub →</a>
  </div>
</div>

<style>
  .complete {
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
    border: 1px solid rgba(99, 102, 241, 0.3);
    border-radius: 16px;
    padding: 2.5rem 2rem;
    width: 100%;
    text-align: center;
    backdrop-filter: blur(20px);
    box-shadow: 0 0 60px rgba(99, 102, 241, 0.12);
  }

  h1 {
    font-size: 1.6rem;
    font-weight: 700;
    color: #e0e0f0;
    margin: 0 0 1.5rem;
  }

  .agent-message {
    font-size: 1.05rem;
    color: #a5b4fc;
    min-height: 2rem;
    margin-bottom: 2rem;
    font-style: italic;
  }

  .cursor {
    animation: blink 1s step-end infinite;
    color: #6366f1;
    font-style: normal;
  }

  @keyframes blink {
    50% { opacity: 0; }
  }

  .btn-primary {
    display: inline-block;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: white;
    border: none;
    border-radius: 10px;
    padding: 0.85rem 2rem;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    transition: opacity 0.2s, transform 0.15s;
  }
  .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
</style>