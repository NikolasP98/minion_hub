<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import OrbAnimation from '$lib/components/onboarding/OrbAnimation.svelte';

  const name = page.url.searchParams.get('name') ?? 'Your Agent';
  const vibe = page.url.searchParams.get('vibe') ?? 'casual';

  let message = $state('');
  let showBubble = $state(false);
  let showCTA = $state(false);
  const fullMessage = "I'm alive. Let's get to work.";

  onMount(() => {
    // Start typing after a short delay
    setTimeout(() => {
      showBubble = true;
      let i = 0;
      const interval = setInterval(() => {
        if (i < fullMessage.length) {
          message += fullMessage[i];
          i++;
        } else {
          clearInterval(interval);
          setTimeout(() => showCTA = true, 400);
        }
      }, 50);
      return () => clearInterval(interval);
    }, 800);
  });
</script>

<svelte:head>
  <title>{name} is Alive — Minion Hub</title>
</svelte:head>

<div class="complete">
  <div class="orb-area">
    <OrbAnimation phase="connecting" agentName={name} />

    {#if showBubble}
      <div class="chat-bubble">
        <p class="bubble-text">{message}<span class="cursor">|</span></p>
        <!-- Bubble tail pointing to orb -->
        <div class="bubble-tail"></div>
      </div>
    {/if}
  </div>

  {#if showCTA}
    <a href="/" class="btn-primary">Enter the Hub →</a>
  {/if}
</div>

<style>
  .complete {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3rem;
    width: 100%;
    max-width: 520px;
    padding: 3rem 1rem;
    z-index: 1;
  }

  .orb-area {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  /* Chat bubble coming from the orb */
  .chat-bubble {
    position: absolute;
    top: -60px;
    left: 50%;
    transform: translateX(-25%);
    background: rgba(30, 30, 60, 0.95);
    border: 1px solid rgba(99, 102, 241, 0.3);
    border-radius: 16px 16px 4px 16px;
    padding: 0.85rem 1.2rem;
    max-width: 260px;
    animation: bubble-in 0.4s ease-out;
    box-shadow: 0 4px 20px rgba(99, 102, 241, 0.15);
  }

  @keyframes bubble-in {
    from { opacity: 0; transform: translateX(-25%) translateY(8px) scale(0.9); }
    to { opacity: 1; transform: translateX(-25%) translateY(0) scale(1); }
  }

  .bubble-tail {
    position: absolute;
    bottom: -8px;
    right: 20px;
    width: 16px;
    height: 16px;
    background: rgba(30, 30, 60, 0.95);
    border-right: 1px solid rgba(99, 102, 241, 0.3);
    border-bottom: 1px solid rgba(99, 102, 241, 0.3);
    transform: rotate(45deg);
    border-radius: 0 0 4px 0;
  }

  .bubble-text {
    font-size: 0.95rem;
    color: #c7d2fe;
    margin: 0;
    line-height: 1.5;
    font-style: italic;
  }

  .cursor {
    animation: blink 1s step-end infinite;
    color: #818cf8;
    font-style: normal;
  }

  @keyframes blink { 50% { opacity: 0; } }

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
    animation: fade-in-up 0.5s ease-out;
  }

  .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }

  @keyframes fade-in-up {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>