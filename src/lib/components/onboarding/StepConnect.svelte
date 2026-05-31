<script lang="ts">
  interface Props { onsubmit: () => void; prev: () => void; error: string; }
  let { onsubmit, prev, error }: Props = $props();

  const channels = [
    { id: 'whatsapp', label: 'WhatsApp', icon: '📱', desc: 'The bot works on your WhatsApp number. Send it a message to verify.', action: 'Message the bot on WhatsApp to link.', color: '#25D366' },
    { id: 'telegram', label: 'Telegram', icon: '✈️', desc: 'Connect via Telegram for fast, secure messaging.', action: 'Start a chat with @minion_bot and send /start.', color: '#0088cc' },
    { id: 'discord', label: 'Discord', icon: '🎮', desc: 'Add the bot to your Discord server.', action: 'Invite the bot to your server, then type /link in the bot channel.', color: '#5865F2' },
  ];
</script>

<div class="step">
  <h2>Connect Your Channels</h2>
  <p class="subtitle">Link at least one messaging channel so your agent can talk to you. You can add more later in Settings.</p>

  <div class="channels">
    {#each channels as ch}
      <div class="channel-card" style="--ch-color: {ch.color}">
        <div class="ch-header">
          <span class="ch-icon">{ch.icon}</span>
          <span class="ch-label">{ch.label}</span>
        </div>
        <p class="ch-desc">{ch.desc}</p>
        <p class="ch-action">{ch.action}</p>
      </div>
    {/each}
  </div>

  {#if error}<div class="error-banner">{error}</div>{/if}

  <div class="buttons">
    <button class="btn-secondary" onclick={prev}>← Back</button>
    <button class="btn-primary" onclick={onsubmit}>Finish ✨</button>
  </div>
</div>

<style>
  .step { display: flex; flex-direction: column; gap: 1rem; }
  h2 { font-size: 1.1rem; font-weight: 600; color: var(--color-foreground); margin: 0; }
  .subtitle { font-size: 0.8rem; color: var(--color-muted-foreground); margin: 0; line-height: 1.4; }
  .channels { display: flex; flex-direction: column; gap: 0.75rem; }
  .channel-card {
    background: var(--color-bg3);
    border: 1px solid var(--color-border);
    border-left: 3px solid var(--ch-color);
    border-radius: var(--radius-lg);
    padding: 1rem;
    transition: background var(--duration-fast);
  }
  .channel-card:hover { background: var(--color-bg2); }
  .ch-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }
  .ch-icon { font-size: 1.3rem; }
  .ch-label { font-weight: 600; font-size: 0.9rem; color: var(--color-foreground); }
  .ch-desc { font-size: 0.78rem; color: var(--color-muted); margin: 0; line-height: 1.4; }
  .ch-action { font-size: 0.72rem; color: var(--color-muted-foreground); margin: 0.5rem 0 0 0; font-style: italic; }
  .error-banner {
    background: color-mix(in srgb, var(--color-destructive) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-destructive) 30%, transparent);
    border-radius: var(--radius-lg); padding: 0.75rem;
    font-size: 0.8rem; color: var(--color-destructive);
  }
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