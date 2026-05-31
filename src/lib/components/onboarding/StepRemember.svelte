<script lang="ts">
  interface Props {
    userName: string; timezone: string; language: string;
    userContext: string; next: () => void; prev: () => void;
  }
  let { userName = $bindable(''), timezone = $bindable('America/Lima'),
        language = $bindable('es'), userContext = $bindable(''),
        next, prev }: Props = $props();

  const timezones = [
    'America/Lima','America/Bogota','America/Mexico_City','America/Argentina/Buenos_Aires',
    'America/Santiago','America/New_York','America/Chicago','America/Los_Angeles',
    'Europe/London','Europe/Madrid','Europe/Paris','Europe/Berlin',
    'Asia/Tokyo','Asia/Shanghai','Asia/Kolkata',
  ];
  const languages = [
    { id: 'es', label: 'Español' },{ id: 'en', label: 'English' },
    { id: 'pt', label: 'Português' },{ id: 'fr', label: 'Français' },{ id: 'de', label: 'Deutsch' },
  ];

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); next(); }
  }
</script>

<div class="step">
  <h2>Tell Your Agent About You</h2>
  <p class="subtitle">This helps your agent understand who you are and how to work with you.</p>

  <div class="field">
    <label for="uname">Your Name</label>
    <input id="uname" type="text" bind:value={userName} placeholder="How should your agent call you?" maxlength={64} class="input" />
  </div>
  <div class="row">
    <div class="field">
      <label for="tz">Timezone</label>
      <select id="tz" bind:value={timezone} class="input">
        {#each timezones as tz}<option value={tz}>{tz.replace('America/','').replace('Europe/','').replace('Asia/','').replace('_',' ')}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="lang">Language</label>
      <select id="lang" bind:value={language} class="input">
        {#each languages as lang}<option value={lang.id}>{lang.label}</option>{/each}
      </select>
    </div>
  </div>
  <div class="field">
    <label for="ctx">Context (optional)</label>
    <textarea id="ctx" bind:value={userContext} placeholder="I run a clinic and multiple businesses. I need help with scheduling, client follow-ups, financial tracking..." rows={4} maxlength={500} class="input textarea" onkeydown={handleKeydown}></textarea>
    <span class="charcount">{userContext.length}/500</span>
  </div>
  <div class="buttons">
    <button class="btn-secondary" onclick={prev}>← Back</button>
    <button class="btn-primary" onclick={next}>Continue →</button>
  </div>
</div>

<style>
  .step { display: flex; flex-direction: column; gap: 1rem; }
  h2 { font-size: 1.1rem; font-weight: 600; color: var(--color-foreground); margin: 0; }
  .subtitle { font-size: 0.8rem; color: var(--color-muted-foreground); margin: 0; line-height: 1.4; }
  .field { display: flex; flex-direction: column; gap: 0.3rem; flex: 1; }
  label { font-size: 0.75rem; font-weight: 500; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .input {
    background: var(--color-bg3); border: 1px solid var(--color-border);
    border-radius: var(--radius-lg); padding: 0.7rem 0.85rem;
    color: var(--color-foreground); font-size: 0.9rem; font-family: inherit;
    outline: none; transition: border-color var(--duration-fast);
  }
  .input:focus { border-color: var(--color-accent); }
  .input::placeholder { color: var(--color-muted-foreground); }
  select.input { cursor: pointer; appearance: none; }
  select.input option { background: var(--color-bg2); color: var(--color-foreground); }
  .textarea { resize: vertical; min-height: 80px; line-height: 1.5; }
  .charcount { font-size: 0.65rem; color: var(--color-muted-foreground); text-align: right; }
  .row { display: flex; gap: 0.75rem; }
  .buttons { display: flex; gap: 0.75rem; margin-top: 0.5rem; }
  .btn-primary {
    background: var(--color-accent); color: var(--color-accent-foreground);
    border: none; border-radius: var(--radius-lg); padding: 0.85rem 1.5rem;
    font-size: 0.95rem; font-weight: 600; cursor: pointer; flex: 1;
    transition: opacity var(--duration-fast), transform var(--duration-fast);
  }
  .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
  .btn-secondary {
    background: var(--color-bg3); color: var(--color-muted);
    border: 1px solid var(--color-border); border-radius: var(--radius-lg);
    padding: 0.85rem 1.5rem; font-size: 0.95rem; font-weight: 500;
    cursor: pointer; transition: background var(--duration-fast);
  }
  .btn-secondary:hover { background: var(--color-bg2); }
</style>