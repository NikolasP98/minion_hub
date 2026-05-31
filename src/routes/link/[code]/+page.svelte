<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form: { success?: boolean } | undefined } = $props();

  let submitted = $state(false);
</script>

<svelte:head>
  <title>Link Your Channel — Minion Hub</title>
</svelte:head>

<div class="link-page">
  {#if form?.success}
    <div class="success-card">
      <h1>Linked!</h1>
      <p>
        Your {data.channelLabel} number <strong>{data.channelUserId}</strong>
        is now linked to <strong>{data.userEmail}</strong>.
      </p>
      <p>Go back to {data.channelLabel} and ask the bot for your Google data — it will work now.</p>
      <a href="/settings" class="btn">Go to Settings</a>
    </div>
  {:else}
    <div class="link-card">
      <h1>Link Your Channel</h1>
      <p>
        Link your <strong>{data.channelLabel}</strong> number
        <code>{data.channelUserId}</code> to your account
        <strong>{data.userEmail}</strong>?
      </p>
      <p class="hint">
        Once linked, the bot can access your Google Drive, Gmail, Calendar, and more
        when you message from this number.
      </p>
      <form method="POST" use:enhance={() => { submitted = true; }}>
        <button type="submit" class="btn primary" disabled={submitted}>
          {submitted ? 'Linking...' : 'Yes, Link My Channel'}
        </button>
      </form>
    </div>
  {/if}
</div>

<style>
  .link-page {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 60vh;
    padding: 2rem;
  }

  .link-card, .success-card {
    background: var(--surface, #1a1a2e);
    border: 1px solid var(--border, #333);
    border-radius: 12px;
    padding: 2rem;
    max-width: 480px;
    width: 100%;
    text-align: center;
  }

  .success-card {
    border-color: var(--success, #22c55e);
  }

  h1 {
    font-size: 1.5rem;
    margin-bottom: 1rem;
    color: var(--text, #e0e0e0);
  }

  p {
    color: var(--text-secondary, #a0a0a0);
    margin-bottom: 1rem;
    line-height: 1.5;
  }

  code {
    background: var(--code-bg, #2a2a3e);
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-size: 0.9em;
  }

  .hint {
    font-size: 0.85rem;
    color: var(--text-muted, #707070);
  }

  .btn {
    display: inline-block;
    padding: 0.75rem 1.5rem;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    border: none;
    text-decoration: none;
    transition: opacity 0.2s;
  }

  .btn.primary {
    background: var(--primary, #6366f1);
    color: white;
  }

  .btn.primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn:hover:not(:disabled) {
    opacity: 0.9;
  }
</style>
