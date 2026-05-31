<script lang="ts">
  interface Props { agentName: string; personality: string; next: () => void; }
  let { agentName = $bindable(''), personality = $bindable('casual'), next }: Props = $props();

  const vibes = [
    { id: 'professional', label: 'Pro', icon: '💼', desc: 'Precise, formal, business-ready' },
    { id: 'casual', label: 'Casual', icon: '✌️', desc: 'Relaxed, friendly, conversational' },
    { id: 'creative', label: 'Creative', icon: '🎨', desc: 'Inventive, bold, outside-the-box' },
    { id: 'direct', label: 'Direct', icon: '⚡', desc: 'Blunt, efficient, no fluff' },
  ];
  let nameError = $state('');

  function handleNext() {
    if (!agentName.trim()) { nameError = 'Give your agent a name.'; return; }
    nameError = ''; next();
  }
  function handleKeydown(e: KeyboardEvent) { if (e.key === 'Enter') handleNext(); }
</script>

<div class="step">
  <h2>Name Your Agent</h2>
  <p class="subtitle">This is the entity that will work for you. Give it a name that resonates.</p>

  <div class="field">
    <input type="text" bind:value={agentName} placeholder="e.g. Aria, Nexus, Panik..." maxlength={32} onkeydown={handleKeydown} class="name-input" />
    {#if nameError}<span class="error">{nameError}</span>{/if}
  </div>

  <h2>Choose Its Nature</h2>
  <p class="subtitle">This shapes how your agent thinks and responds.</p>

  <div class="vibes">
    {#each vibes as vibe}
      <button class="vibe-card" class:selected={personality === vibe.id} onclick={() => personality = vibe.id}>
        <span class="vibe-icon">{vibe.icon}</span>
        <span class="vibe-label">{vibe.label}</span>
        <span class="vibe-desc">{vibe.desc}</span>
      </button>
    {/each}
  </div>

  <button class="btn-primary" onclick={handleNext}>Continue →</button>
</div>

<style>
  .step { display: flex; flex-direction: column; gap: 1rem; }
  h2 { font-size: 1.1rem; font-weight: 600; color: var(--color-foreground); margin: 0; }
  .subtitle { font-size: 0.8rem; color: var(--color-muted-foreground); margin: 0; line-height: 1.4; }
  .field { display: flex; flex-direction: column; gap: 0.3rem; }

  .name-input {
    background: var(--color-bg3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: 0.85rem 1rem;
    color: var(--color-foreground);
    font-size: 1.1rem; font-family: inherit; outline: none;
    transition: border-color var(--duration-fast) var(--ease-standard);
  }
  .name-input:focus { border-color: var(--color-accent); }
  .name-input::placeholder { color: var(--color-muted-foreground); }
  .error { font-size: 0.75rem; color: var(--color-destructive); }

  .vibes { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  .vibe-card {
    display: flex; flex-direction: column; align-items: center; gap: 0.2rem;
    padding: 0.8rem 0.5rem;
    background: var(--color-bg3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    cursor: pointer;
    transition: all var(--duration-fast) var(--ease-standard);
    color: inherit; font-family: inherit;
  }
  .vibe-card:hover { background: var(--color-bg3); border-color: color-mix(in srgb, var(--color-accent) 40%, transparent); }
  .vibe-card.selected {
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    border-color: var(--color-accent);
    box-shadow: 0 0 16px color-mix(in srgb, var(--color-accent) 15%, transparent);
  }
  .vibe-icon { font-size: 1.4rem; }
  .vibe-label { font-size: 0.85rem; font-weight: 600; color: var(--color-foreground); }
  .vibe-desc { font-size: 0.65rem; color: var(--color-muted-foreground); text-align: center; }

  .btn-primary {
    background: var(--color-accent);
    color: var(--color-accent-foreground);
    border: none; border-radius: var(--radius-lg);
    padding: 0.85rem; font-size: 0.95rem; font-weight: 600;
    cursor: pointer;
    transition: opacity var(--duration-fast), transform var(--duration-fast);
    margin-top: 0.5rem;
  }
  .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
</style>