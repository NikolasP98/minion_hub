<script lang="ts">
  interface Props {
    name: string;
    role: string;
    catchphrase?: string | null;
    description: string;
  }
  let { name, role, catchphrase, description }: Props = $props();
</script>

<div class="agent-info">
  <h3 class="agent-name">{name}</h3>
  <p class="agent-role">{role}</p>

  {#if catchphrase}
    <p class="agent-tagline">"{catchphrase}"</p>
  {:else}
    <p class="agent-tagline">
      {description.slice(0, 60)}...
    </p>
  {/if}
</div>

<style>
  .agent-info {
    text-align: center;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    position: relative;
    z-index: 3;
  }

  .agent-name {
    font-size: var(--font-size-body, 14px);
    font-weight: 700;
    color: #18181b;
    margin: 0;
    line-height: 1.2;
    letter-spacing: -0.01em;
  }

  .agent-role {
    font-size: var(--font-size-caption, 12px);
    color: #71717a;
    margin: 4px 0 0;
    font-weight: 500;
  }

  .agent-tagline {
    font-size: var(--font-size-caption, 12px);
    color: #a1a1aa;
    font-style: italic;
    margin: 8px 0 0;
    line-height: 1.4;
    padding: 0 8px;
  }
</style>
