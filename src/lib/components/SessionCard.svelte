<script lang="ts">
  import { fmtTimeAgo, truncKey } from '$lib/utils/format';

  let { session, status }: { session: unknown; status: string } = $props();

  const s = $derived(session as {
    sessionKey?: string;
    label?: string;
    model?: string;
    lastActiveAt?: number;
    createdAt?: number;
  });
</script>

<div class="sess-card">
  <div class="sess-key-row">
    <span class="sess-dot {status}"></span>
    <span class="sess-key">{truncKey(s.sessionKey)}</span>
  </div>
  {#if s.label}
    <div class="sess-label">{s.label}</div>
  {/if}
  <div class="sess-meta">
    {#if s.model}
      <span class="sess-model">{s.model}</span>
    {/if}
    <span class="sess-time">{fmtTimeAgo(s.lastActiveAt ?? s.createdAt)}</span>
  </div>
</div>

<style>
  .sess-card {
    background: var(--bg3); border: 1px solid var(--border);
    border-radius: 5px; padding: 7px 8px; margin-bottom: 5px;
    font-size: 11px;
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    transition: border-color 0.2s;
  }
  .sess-card:hover { border-color: var(--accent); }
  .sess-key-row { display: flex; align-items: center; gap: 5px; }
  .sess-dot {
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  }
  .sess-dot.running  { background: var(--status-running); box-shadow: 0 0 5px var(--status-running); }
  .sess-dot.thinking { background: var(--status-thinking); animation: dot-pulse 0.8s ease infinite; }
  .sess-dot.idle     { background: var(--status-idle); }
  .sess-dot.aborted  { background: var(--status-aborted); }
  @keyframes dot-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
  }
  .sess-key {
    color: var(--text); font-weight: 500;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0;
  }
  .sess-label {
    color: var(--text2); font-size: 10px; margin-top: 2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .sess-meta { color: var(--text3); margin-top: 3px; display: flex; gap: 6px; align-items: center; }
  .sess-model { color: var(--accent); font-size: 10px; }
  .sess-time  { font-size: 10px; }
</style>
