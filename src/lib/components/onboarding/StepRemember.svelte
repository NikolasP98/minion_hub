<script lang="ts">
  interface Props {
    userName: string;
    timezone: string;
    language: string;
    userContext: string;
    next: () => void;
    prev: () => void;
  }

  let {
    userName = $bindable(''),
    timezone = $bindable('America/Lima'),
    language = $bindable('es'),
    userContext = $bindable(''),
    next,
    prev,
  }: Props = $props();

  const timezones = [
    'America/Lima', 'America/Bogota', 'America/Mexico_City', 'America/Argentina/Buenos_Aires',
    'America/Santiago', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
    'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'Europe/Berlin',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata',
  ];

  const languages = [
    { id: 'es', label: 'Español' },
    { id: 'en', label: 'English' },
    { id: 'pt', label: 'Português' },
    { id: 'fr', label: 'Français' },
    { id: 'de', label: 'Deutsch' },
  ];

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); next(); }
  }
</script>

<div class="step">
  <h2>Tell Your Agent About You</h2>
  <p class="subtitle">This helps your agent understand who you are and how to work with you.</p>

  <div class="field">
    <label>Your Name</label>
    <input type="text" bind:value={userName} placeholder="How should your agent call you?" maxlength={64} class="input" />
  </div>

  <div class="row">
    <div class="field">
      <label>Timezone</label>
      <select bind:value={timezone} class="input">
        {#each timezones as tz}
          <option value={tz}>{tz.replace('America/', '').replace('Europe/', '').replace('Asia/', '').replace('_', ' ')}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label>Language</label>
      <select bind:value={language} class="input">
        {#each languages as lang}
          <option value={lang.id}>{lang.label}</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="field">
    <label>Context (optional)</label>
    <textarea
      bind:value={userContext}
      placeholder="I run a clinic and multiple businesses. I need help with scheduling, client follow-ups, financial tracking..."
      rows={4}
      maxlength={500}
      class="input textarea"
      onkeydown={handleKeydown}
    ></textarea>
    <span class="charcount">{userContext.length}/500</span>
  </div>

  <div class="buttons">
    <button class="btn-secondary" onclick={prev}>← Back</button>
    <button class="btn-primary" onclick={next}>Continue →</button>
  </div>
</div>

<style>
  .step { display: flex; flex-direction: column; gap: 1rem; }
  h2 { font-size: 1.1rem; font-weight: 600; color: #e0e0f0; margin: 0; }
  .subtitle { font-size: 0.8rem; color: rgba(255, 255, 255, 0.45); margin: 0; line-height: 1.4; }

  .field { display: flex; flex-direction: column; gap: 0.3rem; flex: 1; }
  label { font-size: 0.75rem; font-weight: 500; color: rgba(255, 255, 255, 0.5); text-transform: uppercase; letter-spacing: 0.04em; }

  .input {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    padding: 0.7rem 0.85rem;
    color: #e0e0f0;
    font-size: 0.9rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s;
  }
  .input:focus { border-color: #6366f1; }
  .input::placeholder { color: rgba(255, 255, 255, 0.2); }
  select.input { cursor: pointer; appearance: none; }
  select.input option { background: #1a1a30; color: #e0e0f0; }

  .textarea { resize: vertical; min-height: 80px; line-height: 1.5; }
  .charcount { font-size: 0.65rem; color: rgba(255, 255, 255, 0.25); text-align: right; }

  .row { display: flex; gap: 0.75rem; }

  .buttons { display: flex; gap: 0.75rem; margin-top: 0.5rem; }

  .btn-primary {
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: white; border: none; border-radius: 10px;
    padding: 0.85rem 1.5rem; font-size: 0.95rem; font-weight: 600;
    cursor: pointer; transition: opacity 0.2s, transform 0.15s; flex: 1;
  }
  .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }

  .btn-secondary {
    background: rgba(255, 255, 255, 0.06); color: rgba(255, 255, 255, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px;
    padding: 0.85rem 1.5rem; font-size: 0.95rem; font-weight: 500;
    cursor: pointer; transition: background 0.2s;
  }
  .btn-secondary:hover { background: rgba(255, 255, 255, 0.1); }
</style>