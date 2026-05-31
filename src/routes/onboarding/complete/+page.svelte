<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import OrbAnimation from '$lib/components/onboarding/OrbAnimation.svelte';

  const name = page.url.searchParams.get('name') ?? 'Your Agent';
  let message = $state('');
  let showBubble = $state(false);
  let showCTA = $state(false);
  const fullMessage = "I'm alive. Let's get to work.";

  onMount(() => {
    setTimeout(() => {
      showBubble = true;
      let i = 0;
      const interval = setInterval(() => {
        if (i < fullMessage.length) { message += fullMessage[i]; i++; }
        else { clearInterval(interval); setTimeout(() => showCTA = true, 400); }
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
        <div class="bubble-tail"></div>
      </div>
    {/if}
  </div>
  {#if showCTA}
    <a href="/" class="btn-primary">Enter the Hub →</a>
  {/if}
</div>

<style>
  .complete { display: flex; flex-direction: column; align-items: center; gap: 3rem; width: 100%; max-width: 520px; padding: 3rem 1rem; z-index: 1; }
  .orb-area { position: relative; display: flex; flex-direction: column; align-items: center; }
  .chat-bubble {
    position: absolute; top: -60px; left: 50%; transform: translateX(-25%);
    background: var(--elevation-3-bg);
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
    border-radius: var(--radius-xl) var(--radius-xl) var(--radius-sm) var(--radius-xl);
    padding: 0.85rem 1.2rem; max-width: 260px;
    animation: bubble-in var(--duration-slow) var(--ease-out);
    box-shadow: var(--shadow-md);
  }
  @keyframes bubble-in {
    from { opacity: 0; transform: translateX(-25%) translateY(8px) scale(0.9); }
    to { opacity: 1; transform: translateX(-25%) translateY(0) scale(1); }
  }
  .bubble-tail {
    position: absolute; bottom: -8px; right: 20px;
    width: 16px; height: 16px;
    background: var(--elevation-3-bg);
    border-right: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
    transform: rotate(45deg); border-radius: 0 0 var(--radius-sm) 0;
  }
  .bubble-text { font-size: 0.95rem; color: var(--color-purple); margin: 0; line-height: 1.5; font-style: italic; }
  .cursor { animation: blink 1s step-end infinite; color: var(--color-accent); font-style: normal; }
  @keyframes blink { 50% { opacity: 0; } }
  .btn-primary {
    display: inline-block;
    background: var(--color-accent); color: var(--color-accent-foreground);
    border: none; border-radius: var(--radius-lg); padding: 0.85rem 2rem;
    font-size: 0.95rem; font-weight: 600; cursor: pointer; text-decoration: none;
    transition: opacity var(--duration-fast), transform var(--duration-fast);
    animation: fade-in-up var(--duration-slow) var(--ease-out);
  }
  .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
  @keyframes fade-in-up { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
</style>