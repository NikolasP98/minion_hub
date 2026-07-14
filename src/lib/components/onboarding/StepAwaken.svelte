<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { Button, Input } from '$lib/components/ui';

  type Personality = 'professional' | 'casual' | 'creative' | 'technical';

  interface Props {
    agentName: string;
    personality: Personality;
    next: () => void;
  }
  let { agentName = $bindable(''), personality = $bindable('casual'), next }: Props = $props();

  const vibes = [
    { id: 'professional', label: m.awaken_pro(), icon: '💼', desc: m.awaken_proDesc() },
    { id: 'casual', label: m.awaken_casual(), icon: '✌️', desc: m.awaken_casualDesc() },
    { id: 'creative', label: m.awaken_creative(), icon: '🎨', desc: m.awaken_creativeDesc() },
    { id: 'technical', label: m.awaken_technical(), icon: '⚡', desc: m.awaken_technicalDesc() },
  ];
  let nameError = $state('');

  function handleNext() {
    if (!agentName.trim()) {
      nameError = m.awaken_nameError();
      return;
    }
    nameError = '';
    next();
  }
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleNext();
  }
</script>

<div class="flex flex-col gap-6">
  <div class="flex flex-col gap-3">
    <div>
      <h2 class="text-base font-semibold text-foreground">{m.awaken_nameTitle()}</h2>
      <p class="mt-1 text-sm leading-relaxed text-muted-foreground">{m.awaken_nameSubtitle()}</p>
    </div>
    <Input
      type="text"
      label={m.awaken_nameTitle()}
      bind:value={agentName}
      placeholder={m.awaken_namePlaceholder()}
      maxlength={32}
      onkeydown={handleKeydown}
      error={nameError || undefined}
      size="touch"
    />
  </div>

  <div class="flex flex-col gap-3">
    <div>
      <h2 class="text-base font-semibold text-foreground">{m.awaken_natureTitle()}</h2>
      <p class="mt-1 text-sm leading-relaxed text-muted-foreground">{m.awaken_natureSubtitle()}</p>
    </div>

    <div
      class="grid grid-cols-1 gap-2 sm:grid-cols-2"
      role="group"
      aria-label={m.awaken_natureTitle()}
    >
      {#each vibes as vibe}
        <Button
          type="button"
          variant={personality === vibe.id ? 'outline' : 'secondary'}
          size="touch"
          class="h-auto min-h-[var(--control-height-touch)] w-full whitespace-normal py-3"
          aria-pressed={personality === vibe.id}
          onclick={() => (personality = vibe.id as Personality)}
        >
          <span class="flex min-w-0 flex-col items-center gap-1 text-center">
            <span class="text-lg" aria-hidden="true">{vibe.icon}</span>
            <span class="text-sm font-semibold text-foreground">{vibe.label}</span>
            <span class="text-xs leading-relaxed text-muted-foreground">{vibe.desc}</span>
          </span>
        </Button>
      {/each}
    </div>
  </div>

  <Button type="button" variant="primary" size="touch" onclick={handleNext} class="w-full">
    {m.awaken_continue()}
  </Button>
</div>
