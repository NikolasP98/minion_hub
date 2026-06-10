<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';
  let { data, form }: { data: PageData; form: any } = $props();
  let message = $state('');
</script>

<svelte:head>
  <title>Request Access — Minion Hub</title>
</svelte:head>

<div class="page">
  <div class="card">
    {#if data.mode === 'link'}
      {#if data.linkError}
        <div class="icon">⚠️</div>
        <h1>Invite Unavailable</h1>
        <p class="subtitle">{data.linkError}</p>
        <a href="/join" class="btn-primary linklike">Request access instead</a>
      {:else}
        <div class="icon">🎟️</div>
        <h1>Join {data.orgName}</h1>
        <p class="subtitle">
          You've been invited to join <strong>{data.orgName}</strong> as <strong>{data.role}</strong>.
        </p>
        <form method="POST" action="?/consume" use:enhance>
          <input type="hidden" name="token" value={data.token} />
          <button type="submit" class="btn-primary">Join {data.orgName}</button>
        </form>
        {#if form?.error}<p class="error">{form.error}</p>{/if}
      {/if}
    {:else}
      <div class="icon">🔐</div>
      <h1>Request Access</h1>
      <p class="subtitle">
        Your account <strong>{data.email}</strong> isn't a member of any organization yet.
        Submit a request and the admin will review it.
      </p>
      <form method="POST" action="?/request" use:enhance>
        <div class="field">
          <label for="msg">Message (optional)</label>
          <textarea id="msg" name="message" bind:value={message} placeholder="Tell the admin who you are and why you need access..." rows={4} maxlength={500}></textarea>
          <span class="charcount">{message.length}/500</span>
        </div>
        <button type="submit" class="btn-primary">Submit Request</button>
      </form>
      {#if form?.error}<p class="error">{form.error}</p>{/if}
    {/if}
  </div>
</div>

<style>
  .page {
    display: flex; justify-content: center; align-items: center;
    min-height: 100vh; min-height: 100dvh;
    background: radial-gradient(ellipse at 50% 40%, var(--color-bg2) 0%, var(--color-bg) 70%);
    padding: 2rem;
  }
  .card {
    background: var(--elevation-2-bg);
    border: 1px solid var(--elevation-2-border);
    border-radius: var(--radius-xl); padding: 2.5rem;
    max-width: 480px; width: 100%; text-align: center;
    backdrop-filter: blur(20px);
  }
  .icon { font-size: 3rem; margin-bottom: 0.5rem; }
  h1 { font-size: 1.4rem; font-weight: 700; color: var(--color-foreground); margin: 0 0 0.75rem; }
  .subtitle { font-size: 0.85rem; color: var(--color-muted); line-height: 1.5; margin: 0 0 1.5rem; }
  .field { display: flex; flex-direction: column; gap: 0.3rem; text-align: left; margin-bottom: 1rem; }
  label { font-size: 0.75rem; font-weight: 500; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  textarea {
    background: var(--color-bg3); border: 1px solid var(--color-border);
    border-radius: var(--radius-lg); padding: 0.75rem 0.85rem;
    color: var(--color-foreground); font-size: 0.9rem; font-family: inherit;
    outline: none; resize: vertical; line-height: 1.5;
  }
  textarea:focus { border-color: var(--color-accent); }
  textarea::placeholder { color: var(--color-muted-foreground); }
  .charcount { font-size: 0.65rem; color: var(--color-muted-foreground); text-align: right; }
  .btn-primary {
    width: 100%; background: var(--color-accent); color: var(--color-accent-foreground);
    border: none; border-radius: var(--radius-lg); padding: 0.85rem;
    font-size: 0.95rem; font-weight: 600; cursor: pointer;
    transition: opacity var(--duration-fast);
  }
  .btn-primary:hover { opacity: 0.9; }
  .btn-primary.linklike { display: inline-block; text-decoration: none; box-sizing: border-box; }
  .error { font-size: 0.8rem; color: var(--color-destructive); margin-top: 1rem; }
</style>