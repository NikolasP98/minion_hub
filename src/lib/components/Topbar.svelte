<script lang="ts">
  import HostPill from './HostPill.svelte';
  import { conn } from '$lib/state/connection.svelte';
</script>

<header class="topbar">
  <HostPill />

  <div class="conn-led {conn.connected ? 'on' : conn.connecting ? 'connecting' : 'off'}"></div>
  <span class="conn-status">{conn.statusText}</span>

  <div class="logo" aria-label="Minion Hub">
    <span class="logo-pill">MINION</span><span class="logo-hub">hub</span>
  </div>

  <a href="/reliability" class="nav-link">Reliability</a>
  <a href="/sessions" class="nav-link">Sessions</a>
</header>

<style>
  .topbar {
    flex-shrink: 0;
    position: relative;
    z-index: 100;
    background: rgba(10, 14, 23, 0.95);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
    padding: 9px 18px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .conn-led {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: background 0.3s, box-shadow 0.3s;
  }
  .conn-led.off       { background: #475569; box-shadow: 0 0 4px #475569; }
  .conn-led.on        { background: var(--green); box-shadow: 0 0 8px var(--green); }
  .conn-led.connecting {
    background: var(--amber);
    box-shadow: 0 0 8px var(--amber);
    animation: led-pulse 1s infinite;
  }
  @keyframes led-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }

  .conn-status {
    font-size: 12px;
    color: var(--text2);
    white-space: nowrap;
  }

  /* ── Logo ── */
  .logo {
    margin-left: auto;
    margin-right: auto;
    display: flex;
    align-items: center;
    gap: 0;
    user-select: none;
    line-height: 1;
  }
  .logo-pill {
    background: var(--brand-pink);
    color: #000;
    font-weight: 900;
    font-size: 15px;
    letter-spacing: 0.5px;
    padding: 3px 10px 3px 10px;
    border-radius: 6px 0 0 6px;
    text-transform: uppercase;
  }
  .logo-hub {
    color: #fff;
    font-weight: 700;
    font-size: 15px;
    padding: 3px 8px;
    background: transparent;
    letter-spacing: 0;
  }

  .nav-link {
    font-size: 12px;
    color: var(--text2);
    text-decoration: none;
    padding: 4px 12px;
    border-radius: 14px;
    border: 1px solid var(--border);
    transition: background 0.15s, color 0.15s;
  }
  .nav-link:hover {
    background: var(--bg3);
    color: var(--text);
  }
</style>
