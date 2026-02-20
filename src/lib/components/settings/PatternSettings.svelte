<script lang="ts">
  import * as slider from '@zag-js/slider';
  import { normalizeProps, useMachine } from '@zag-js/svelte';
  import { bgPattern, PATTERN_OPTIONS, type PatternType } from '$lib/state/bg-pattern.svelte';

  // ─── Opacity slider (0–100) ───
  const [opState, opSend] = useMachine(
    slider.machine({
      id: 'opacity-slider',
      name: 'opacity',
      min: 0,
      max: 40,
      step: 1,
      value: [bgPattern.opacity],
      onValueChange(detail) {
        bgPattern.setOpacity(detail.value[0]);
      },
    }),
  );
  const opApi = $derived(slider.connect(opState, opSend, normalizeProps));

  // ─── Size slider (8–48) ───
  const [szState, szSend] = useMachine(
    slider.machine({
      id: 'size-slider',
      name: 'size',
      min: 6,
      max: 48,
      step: 1,
      value: [bgPattern.size],
      onValueChange(detail) {
        bgPattern.setSize(detail.value[0]);
      },
    }),
  );
  const szApi = $derived(slider.connect(szState, szSend, normalizeProps));
</script>

<section class="space-y-6">
  <h2 class="text-sm font-semibold text-foreground uppercase tracking-wider">Background Pattern</h2>

  <!-- Pattern type selector -->
  <div class="flex gap-2">
    {#each PATTERN_OPTIONS as opt (opt.id)}
      <button
        type="button"
        class="flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-lg border transition-all cursor-pointer min-w-[60px]
          {bgPattern.pattern === opt.id
            ? 'border-accent bg-accent/8 text-accent'
            : 'border-border bg-card text-muted-foreground hover:border-muted hover:text-foreground'}"
        onclick={() => bgPattern.setPattern(opt.id)}
      >
        <span class="text-lg font-mono leading-none">{opt.icon}</span>
        <span class="text-[10px] font-medium tracking-wide">{opt.label}</span>
      </button>
    {/each}
  </div>

  <!-- Sliders row -->
  {#if bgPattern.pattern !== 'none'}
    <div class="grid grid-cols-2 gap-8">

      <!-- Opacity knob -->
      <div class="space-y-3">
        <div class="flex items-baseline justify-between">
          <span class="text-xs text-muted-foreground font-medium">Opacity</span>
          <span class="text-xs font-mono text-accent tabular-nums">{bgPattern.opacity}%</span>
        </div>
        <div {...opApi.getRootProps()} class="relative group">
          <div {...opApi.getControlProps()} class="relative flex items-center h-10 cursor-pointer">
            <div {...opApi.getTrackProps()} class="relative w-full h-1 bg-bg3 rounded-full overflow-hidden">
              <div {...opApi.getRangeProps()} class="absolute h-full bg-accent rounded-full transition-[width] duration-75"></div>
            </div>
            {#each opApi.value as _, index}
              <div {...opApi.getThumbProps({ index })} class="absolute w-5 h-5 -translate-x-1/2 -translate-y-1/2 top-1/2">
                <div class="w-5 h-5 rounded-full bg-bg border-2 border-accent shadow-[0_0_8px_var(--color-accent)] transition-shadow group-hover:shadow-[0_0_14px_var(--color-accent)] flex items-center justify-center">
                  <div class="w-1.5 h-1.5 rounded-full bg-accent"></div>
                </div>
                <input {...opApi.getHiddenInputProps({ index })} />
              </div>
            {/each}
          </div>
          <!-- Tick marks -->
          <div class="flex justify-between px-[10px] -mt-1">
            {#each [0, 10, 20, 30, 40] as tick}
              <div class="w-px h-1.5 bg-border {bgPattern.opacity >= tick ? 'bg-accent/40' : ''}"></div>
            {/each}
          </div>
        </div>
      </div>

      <!-- Size knob -->
      <div class="space-y-3">
        <div class="flex items-baseline justify-between">
          <span class="text-xs text-muted-foreground font-medium">Size</span>
          <span class="text-xs font-mono text-accent tabular-nums">{bgPattern.size}px</span>
        </div>
        <div {...szApi.getRootProps()} class="relative group">
          <div {...szApi.getControlProps()} class="relative flex items-center h-10 cursor-pointer">
            <div {...szApi.getTrackProps()} class="relative w-full h-1 bg-bg3 rounded-full overflow-hidden">
              <div {...szApi.getRangeProps()} class="absolute h-full bg-accent rounded-full transition-[width] duration-75"></div>
            </div>
            {#each szApi.value as _, index}
              <div {...szApi.getThumbProps({ index })} class="absolute w-5 h-5 -translate-x-1/2 -translate-y-1/2 top-1/2">
                <div class="w-5 h-5 rounded-full bg-bg border-2 border-accent shadow-[0_0_8px_var(--color-accent)] transition-shadow group-hover:shadow-[0_0_14px_var(--color-accent)] flex items-center justify-center">
                  <div class="w-1.5 h-1.5 rounded-full bg-accent"></div>
                </div>
                <input {...szApi.getHiddenInputProps({ index })} />
              </div>
            {/each}
          </div>
          <!-- Tick marks -->
          <div class="flex justify-between px-[10px] -mt-1">
            {#each [6, 16, 27, 37, 48] as tick}
              <div class="w-px h-1.5 bg-border {bgPattern.size >= tick ? 'bg-accent/40' : ''}"></div>
            {/each}
          </div>
        </div>
      </div>

    </div>

    <!-- Live preview strip -->
    <div class="relative h-12 rounded-lg border border-border overflow-hidden bg-bg">
      <svg class="absolute inset-0 w-full h-full" style="opacity:{bgPattern.opacity / 100}" aria-hidden="true">
        <defs>
          {#if bgPattern.pattern === 'dots'}
            <pattern id="preview-pat" width={bgPattern.size} height={bgPattern.size} patternUnits="userSpaceOnUse">
              <circle cx={bgPattern.size / 2} cy={bgPattern.size / 2} r={Math.max(0.8, bgPattern.size / 12)} fill="var(--color-accent)" />
            </pattern>
          {:else if bgPattern.pattern === 'grid'}
            <pattern id="preview-pat" width={bgPattern.size} height={bgPattern.size} patternUnits="userSpaceOnUse">
              <path d="M {bgPattern.size} 0 L 0 0 0 {bgPattern.size}" fill="none" stroke="var(--color-accent)" stroke-width="0.5" />
            </pattern>
          {:else if bgPattern.pattern === 'crosses'}
            {@const s = bgPattern.size}
            {@const c = s / 2}
            {@const arm = s / 6}
            <pattern id="preview-pat" width={s} height={s} patternUnits="userSpaceOnUse">
              <line x1={c - arm} y1={c} x2={c + arm} y2={c} stroke="var(--color-accent)" stroke-width="0.6" />
              <line x1={c} y1={c - arm} x2={c} y2={c + arm} stroke="var(--color-accent)" stroke-width="0.6" />
            </pattern>
          {:else if bgPattern.pattern === 'diagonal'}
            <pattern id="preview-pat" width={bgPattern.size} height={bgPattern.size} patternUnits="userSpaceOnUse">
              <line x1="0" y1={bgPattern.size} x2={bgPattern.size} y2="0" stroke="var(--color-accent)" stroke-width="0.4" />
            </pattern>
          {:else if bgPattern.pattern === 'hexagons'}
            {@const s = bgPattern.size}
            {@const h = s * 0.866}
            {@const w = s}
            {@const cx = w * 0.75}
            {@const cy = h}
            {@const r = s * 0.42}
            <pattern id="preview-pat" width={w * 1.5} height={h * 2} patternUnits="userSpaceOnUse">
              <polygon
                points="{cx + r},{cy} {cx + r * 0.5},{cy - r * 0.866} {cx - r * 0.5},{cy - r * 0.866} {cx - r},{cy} {cx - r * 0.5},{cy + r * 0.866} {cx + r * 0.5},{cy + r * 0.866}"
                fill="none" stroke="var(--color-accent)" stroke-width="0.5"
              />
            </pattern>
          {/if}
        </defs>
        <rect width="100%" height="100%" fill="url(#preview-pat)" />
      </svg>
      <span class="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground/60 uppercase tracking-widest font-medium">Preview</span>
    </div>
  {/if}
</section>
