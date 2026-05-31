<script lang="ts">
</script>

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
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    background: radial-gradient(ellipse at 50% 40%, #0f0f23 0%, #060612 70%);
    padding: 2rem;
  }

  .card {
    background: rgba(20, 20, 40, 0.9);
    border: 1px solid rgba(34, 197, 94, 0.2);
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

  p {
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.6);
    line-height: 1.5;
  }

  .hint {
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.35);
    margin-top: 1rem;
  }
</style>
