<script lang="ts"></script>

<svelte:head>
  <title>Request Sent — Minion Hub</title>
</svelte:head>

<div class="page">
  <div class="card">
    <div class="icon">📨</div>
    <h1>Request Sent</h1>
    <p>Your access request has been submitted. The admin will review it shortly.</p>
    <p class="hint">You'll receive access once your request is approved. Check back later.</p>
  </div>
</div>

<style>
  .page {
    display: flex; justify-content: center; align-items: center;
    min-height: 100vh;
    background: radial-gradient(ellipse at 50% 40%, var(--color-bg2) 0%, var(--color-bg) 70%);
    padding: 2rem;
  }
  .card {
    background: var(--elevation-2-bg);
    border: 1px solid color-mix(in srgb, var(--color-success) 20%, transparent);
    border-radius: var(--radius-xl); padding: 2.5rem;
    max-width: 480px; width: 100%; text-align: center;
    backdrop-filter: blur(20px);
  }
  .icon { font-size: 3rem; margin-bottom: 0.5rem; }
  h1 { font-size: 1.4rem; font-weight: 700; color: var(--color-foreground); margin: 0 0 0.75rem; }
  p { font-size: 0.9rem; color: var(--color-muted); line-height: 1.5; }
  .hint { font-size: 0.8rem; color: var(--color-muted-foreground); margin-top: 1rem; }
</style>