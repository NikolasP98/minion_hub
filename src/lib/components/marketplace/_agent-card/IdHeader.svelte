<script lang="ts">
  interface Props {
    initials: string;
  }
  let { initials }: Props = $props();
</script>

<div class="id-header">
  <span class="initials">{initials}</span>
  <div class="header-glow"></div>
</div>

<style>
  .id-header {
    background: linear-gradient(90deg, #1c1c1e, #2c2c2e, #1c1c1e);
    border-radius: 8px;
    padding: 8px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: relative;
    overflow: hidden;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    z-index: 3;
  }

  .initials {
    font-family: 'JetBrains Mono NF', monospace;
    font-weight: 700;
    font-size: var(--font-size-caption, 12px);
    color: #fafafa;
    letter-spacing: 0.15em;
    z-index: 2;
  }

  .header-glow {
    position: absolute;
    right: 10px;
    width: 40px;
    height: 40px;
    background: radial-gradient(
      circle,
      hsl(calc(var(--mx, 0.5) * 120deg + 300deg) 75% 60% / 0.55) 0%,
      transparent 70%
    );
    filter: blur(3px);
    -webkit-mask-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='0.55' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 7 -2.5'/></filter><rect width='100%25' height='100%25' filter='url(%23f)'/></svg>");
    mask-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><filter id='f'><feTurbulence type='fractalNoise' baseFrequency='0.55' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 7 -2.5'/></filter><rect width='100%25' height='100%25' filter='url(%23f)'/></svg>");
    -webkit-mask-size: 40px 40px;
    mask-size: 40px 40px;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
  }
</style>
