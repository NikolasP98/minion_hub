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
    <div class="icon">🔐</div>
    <h1>Request Access</h1>
    <p class="subtitle">
      Your account <strong>{data.email}</strong> isn't a member of any organization yet.
      Submit a request and the admin will review it.
    </p>

    <form method="POST" use:enhance>
      <div class="field">
        <label for="message">Message (optional)</label>
        <textarea
          id="message"
          name="message"
          bind:value={message}
          placeholder="Tell the admin who you are and why you need access..."
          rows={4}
          maxlength={500}
        ></textarea>
        <span class="charcount">{message.length}/500</span>
      </div>

      <button type="submit" class="btn-primary">Submit Request</button>
    </form>

    {#if form?.error}
      <p class="error">{form.error}</p>
    {/if}
  </div>
</div>

<style>
  .page {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    min-height: 100dvh;
    background: radial-gradient(ellipse at 50% 40%, #0f0f23 0%, #060612 70%);
    padding: 2rem;
  }

  .card {
    background: rgba(20, 20, 40, 0.9);
    border: 1px solid rgba(99, 102, 241, 0.15);
    border-radius: 16px;
    padding: 2.5rem;
    max-width: 480px;
    width: 100%;
    text-align: center;
    backdrop-filter: blur(20px);
  }

  .icon { font-size: 3rem; margin-bottom: 0.5rem; }

  h1 {
    font-size: 1.4rem;
    font-weight: 700;
    color: #e0e0f0;
    margin: 0 0 0.75rem;
  }

  .subtitle {
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.5);
    line-height: 1.5;
    margin: 0 0 1.5rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    text-align: left;
    margin-bottom: 1rem;
  }

  label {
    font-size: 0.75rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  textarea {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    padding: 0.75rem 0.85rem;
    color: #e0e0f0;
    font-size: 0.9rem;
    font-family: inherit;
    outline: none;
    resize: vertical;
    line-height: 1.5;
  }
  textarea:focus { border-color: #6366f1; }
  textarea::placeholder { color: rgba(255, 255, 255, 0.2); }

  .charcount {
    font-size: 0.65rem;
    color: rgba(255, 255, 255, 0.25);
    text-align: right;
  }

  .btn-primary {
    width: 100%;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: white;
    border: none;
    border-radius: 10px;
    padding: 0.85rem;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .btn-primary:hover { opacity: 0.9; }

  .error {
    font-size: 0.8rem;
    color: #fca5a5;
    margin-top: 1rem;
  }
</style>
