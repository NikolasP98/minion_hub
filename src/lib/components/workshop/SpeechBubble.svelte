<script lang="ts">
  let { message, agentName, screenX, screenY, onFaded }: {
    message: string;
    agentName: string;
    screenX: number;
    screenY: number;
    onFaded: () => void;
  } = $props();
</script>

<div
  class="speech-bubble absolute pointer-events-auto max-w-[200px] rounded-lg border border-border bg-bg3 px-2.5 py-1.5"
  style="left: {screenX}px; top: {screenY - 80}px; transform: translateX(-50%);"
  onanimationend={onFaded}
>
  <div class="text-muted text-[9px] leading-tight">{agentName}</div>
  <div class="text-foreground text-[11px] leading-snug truncate">{message}</div>
  <div class="triangle"></div>
</div>

<style>
  .speech-bubble {
    animation: bubble-fade 5s forwards;
  }

  .triangle {
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 6px solid var(--color-bg3);
    filter: drop-shadow(0 1px 0 var(--color-border));
  }

  @keyframes bubble-fade {
    0% { opacity: 1; transform: translateX(-50%) translateY(0); }
    80% { opacity: 1; transform: translateX(-50%) translateY(0); }
    100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
  }
</style>
