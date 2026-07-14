<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import OrbAnimation from '$lib/components/onboarding/OrbAnimation.svelte';
  import { Button } from '$lib/components/ui';
  import { PublicTaskShell } from '$lib/components/ui/foundations';
  import { Sparkles } from 'lucide-svelte';

  const name = page.url.searchParams.get('name') ?? 'Your Agent';
  let message = $state('');
  let showBubble = $state(false);
  let showCTA = $state(false);
  const fullMessage = "I'm alive. Let's get to work.";

  onMount(() => {
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    let ctaTimer: ReturnType<typeof setTimeout> | undefined;
    let typingTimer: ReturnType<typeof setInterval> | undefined;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    revealTimer = setTimeout(() => {
      showBubble = true;
      if (reducedMotion) {
        message = fullMessage;
        showCTA = true;
        return;
      }
      let i = 0;
      typingTimer = setInterval(() => {
        if (i < fullMessage.length) {
          message += fullMessage[i];
          i++;
        } else {
          clearInterval(typingTimer);
          ctaTimer = setTimeout(() => (showCTA = true), 400);
        }
      }, 50);
    }, 800);

    return () => {
      clearTimeout(revealTimer);
      clearTimeout(ctaTimer);
      clearInterval(typingTimer);
    };
  });
</script>

<svelte:head>
  <title>{name} is Alive — Minion Hub</title>
</svelte:head>

{#snippet taskIcon()}<Sparkles size={20} />{/snippet}

<PublicTaskShell
  eyebrow="Personal agent online"
  title={`${name} is alive`}
  description="Your personal agent is configured and ready to enter the workspace."
  tone="success"
  icon={taskIcon}
  size="medium"
>
  <div class="flex flex-col items-center gap-4 text-center">
    <div class="-my-8" aria-hidden="true">
      <OrbAnimation phase="connecting" agentName={name} />
    </div>
    {#if showBubble}
      <blockquote
        class="w-full rounded-[var(--radius-xl)] border border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)] bg-[var(--elevation-3-bg)] px-4 py-3 text-sm italic leading-relaxed text-accent shadow-[var(--shadow-elevation-2)]"
        aria-live="polite"
      >
        {message}<span class="ml-0.5 text-accent" aria-hidden="true">|</span>
      </blockquote>
    {/if}
    {#if showCTA}
      <Button href="/" variant="primary" size="touch" class="w-full">Enter the Hub →</Button>
    {/if}
  </div>
</PublicTaskShell>
