<script lang="ts">
  import { crtConfig, type CRTConfig } from '$lib/state/ui/crt-config.svelte';
  import { X, Settings } from 'lucide-svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();

  // Local working copy — only applied on save
  let local = $state<CRTConfig>({
    bloom:       crtConfig.bloom,
    scan:        crtConfig.scan,
    matrix:      crtConfig.matrix,
    subpixel:    crtConfig.subpixel,
    phosphorDots:crtConfig.phosphorDots,
    rgbFringe:   crtConfig.rgbFringe,
    warmAmbient: crtConfig.warmAmbient,
    vignette:    crtConfig.vignette,
    glass:       crtConfig.glass,
    flicker:     crtConfig.flicker,
  });

  const localDefaults = $derived.by<CRTConfig>(() => ({
    bloom:       crtConfig.bloom,
    scan:        crtConfig.scan,
    matrix:      crtConfig.matrix,
    subpixel:    crtConfig.subpixel,
    phosphorDots:crtConfig.phosphorDots,
    rgbFringe:   crtConfig.rgbFringe,
    warmAmbient: crtConfig.warmAmbient,
    vignette:    crtConfig.vignette,
    glass:       crtConfig.glass,
    flicker:     crtConfig.flicker,
  }));

  // Reset local to stored state whenever modal opens
  $effect(() => {
    if (open) {
      local = { ...localDefaults };
    }
  });

  function close() { open = false; }
  function save() { crtConfig.set(local); crtConfig.apply(); close(); }
  function handleKeydown(e: KeyboardEvent) { if (e.key === 'Escape') close(); }

  // Preview computed styles
  const scanlineStyle = $derived.by(() => {
    if (local.scan === 'off') return '';
    const alpha = local.scan === 'subtle' ? 0.18 : local.scan === 'heavy' ? 0.55 : 0.38;
    return `repeating-linear-gradient(0deg, transparent 0px, transparent 1px, rgba(0,0,0,${alpha}) 1px, rgba(0,0,0,${alpha}) 2px)`;
  });

  // Compute preview text-shadow based on bloom setting (avoids duplicate property in inline style)
  const previewTextShadow = $derived.by(() => {
    if (local.bloom === 'subtle')   return 'text-shadow: 0 0 4px rgba(255,190,64,0.35), 0 0 12px rgba(200,120,32,0.15);';
    if (local.bloom === 'deep')     return 'text-shadow: 0 0 2px rgba(255,246,208,0.8), 0 0 5px #ffd060, 0 0 10px rgba(255,224,96,0.95);';
    if (local.bloom === 'halation') return 'text-shadow: 0 0 2px rgba(255,246,208,0.9), 0 0 6px #ffd060, 0 0 14px rgba(255,224,96,1), 0 0 28px rgba(255,190,64,0.8);';
    return '';
  });

  const pixelRows = [
    { key: 'subpixel',    label: 'RGB Subpixels',  desc: 'R/G/B column fringing' },
    { key: 'matrix',      label: 'LCD Matrix',      desc: '3x3 pixel cell grid' },
    { key: 'phosphorDots',label: 'Phosphor Dots',   desc: 'Dot triad pattern' },
    { key: 'rgbFringe',   label: 'RGB Fringe',      desc: 'Chromatic scan bleed' },
  ];

  const atmosphereRows = [
    { key: 'warmAmbient', label: 'Warm Ambient',    desc: 'Amber backlight glow' },
    { key: 'vignette',    label: 'Vignette',         desc: 'Edge darkening' },
    { key: 'glass',       label: 'Glass Reflection', desc: 'Top surface sheen' },
    { key: 'flicker',     label: 'Screen Flicker',   desc: 'Subtle 60Hz flicker' },
  ];

  const bloomValues: CRTConfig['bloom'][] = ['none', 'subtle', 'deep', 'halation'];
  const scanValues: CRTConfig['scan'][] = ['off', 'subtle', 'default', 'heavy', 'cinematic'];
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={close}
    onkeydown={handleKeydown}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="relative w-[780px] max-w-[96vw] max-h-[90vh] bg-bg2 border border-border rounded-none flex flex-col overflow-hidden shadow-2xl"
      style="box-shadow: 0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04);"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <!-- Header -->
      <div class="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
        <Settings size={18} style="color: var(--crt-hot, #ffbe40);" />
        <div class="flex-1">
          <div class="text-sm font-semibold tracking-widest uppercase" style="color: var(--crt-hot, #ffbe40); font-family: 'Courier New', monospace;">
            CRT Effects
          </div>
          <div class="text-xs text-muted-foreground mt-0.5">Customize phosphor &amp; screen effects. Changes apply on save.</div>
        </div>
        <button
          type="button"
          onclick={close}
          class="w-7 h-7 flex items-center justify-center border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-all"
          style="border-radius: 0;"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      <!-- Body: controls + preview -->
      <div class="flex flex-1 min-h-0 overflow-hidden">

        <!-- Controls -->
        <div class="flex-1 overflow-y-auto p-5 flex flex-col gap-5 border-r border-border min-w-0">

          <!-- Phosphor Bloom -->
          <div class="flex flex-col gap-2">
            <div class="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground pb-1.5 border-b border-border">
              Phosphor Bloom
            </div>
            <div class="flex gap-0.5 bg-bg border border-border p-0.5">
              {#each bloomValues as val (val)}
                <button
                  type="button"
                  onclick={() => local = { ...local, bloom: val }}
                  class="flex-1 py-1.5 text-[11px] font-medium tracking-wider uppercase transition-all"
                  style={local.bloom === val
                    ? 'background: var(--color-bg2); color: var(--crt-hot, #ffbe40); border: 1px solid rgba(200,120,32,0.4); box-shadow: 0 0 6px rgba(200,120,32,0.15); font-family: Courier New, monospace;'
                    : 'color: var(--color-muted-foreground); background: transparent; border: 1px solid transparent;'}
                >
                  {val === 'halation' ? 'Halo' : val.charAt(0).toUpperCase() + val.slice(1)}
                </button>
              {/each}
            </div>
            <div class="text-[11px] text-muted-foreground">
              {local.bloom === 'none' ? 'No text glow' : local.bloom === 'subtle' ? 'Soft 2-layer glow around bright elements' : local.bloom === 'deep' ? 'Multi-layer phosphor bleed' : 'Wide halation corona around all text'}
            </div>
          </div>

          <!-- Scanlines -->
          <div class="flex flex-col gap-2">
            <div class="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground pb-1.5 border-b border-border">
              Scanlines
            </div>
            <div class="flex gap-0.5 bg-bg border border-border p-0.5">
              {#each scanValues as val (val)}
                <button
                  type="button"
                  onclick={() => local = { ...local, scan: val }}
                  class="flex-1 py-1.5 text-[11px] font-medium tracking-wider uppercase transition-all"
                  style={local.scan === val
                    ? 'background: var(--color-bg2); color: var(--crt-hot, #ffbe40); border: 1px solid rgba(200,120,32,0.4); box-shadow: 0 0 6px rgba(200,120,32,0.15); font-family: Courier New, monospace;'
                    : 'color: var(--color-muted-foreground); background: transparent; border: 1px solid transparent;'}
                >
                  {val === 'cinematic' ? 'Film' : val === 'default' ? 'Std' : val.charAt(0).toUpperCase() + val.slice(1)}
                </button>
              {/each}
            </div>
          </div>

          <!-- Pixel Structure -->
          <div class="flex flex-col gap-0">
            <div class="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground pb-1.5 border-b border-border mb-1">
              Pixel Structure
            </div>
            {#each pixelRows as row, i (row.key)}
              <button
                type="button"
                onclick={() => local = { ...local, [row.key]: !local[row.key as keyof CRTConfig] }}
                class="flex items-center gap-3 py-2 px-0 w-full text-left transition-colors {i > 0 ? 'border-t border-border' : ''}"
              >
                <div class="flex-1">
                  <div class="text-sm text-foreground">{row.label}</div>
                  <div class="text-[11px] text-muted-foreground">{row.desc}</div>
                </div>
                <!-- Toggle -->
                <div
                  class="w-9 h-5 shrink-0 relative transition-all duration-150"
                  style="border-radius: 10px; background: {local[row.key as keyof CRTConfig] ? 'var(--crt-base, #c87820)' : 'var(--color-border)'}; box-shadow: {local[row.key as keyof CRTConfig] ? '0 0 8px rgba(200,120,32,0.4)' : 'none'};"
                >
                  <div
                    class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-150"
                    style="left: {local[row.key as keyof CRTConfig] ? '18px' : '2px'};"
                  ></div>
                </div>
              </button>
            {/each}
          </div>

          <!-- Atmosphere -->
          <div class="flex flex-col gap-0">
            <div class="text-[10px] font-semibold tracking-widests uppercase text-muted-foreground pb-1.5 border-b border-border mb-1">
              Atmosphere
            </div>
            {#each atmosphereRows as row, i (row.key)}
              <button
                type="button"
                onclick={() => local = { ...local, [row.key]: !local[row.key as keyof CRTConfig] }}
                class="flex items-center gap-3 py-2 px-0 w-full text-left transition-colors {i > 0 ? 'border-t border-border' : ''}"
              >
                <div class="flex-1">
                  <div class="text-sm text-foreground">{row.label}</div>
                  <div class="text-[11px] text-muted-foreground">{row.desc}</div>
                </div>
                <div
                  class="w-9 h-5 shrink-0 relative transition-all duration-150"
                  style="border-radius: 10px; background: {local[row.key as keyof CRTConfig] ? 'var(--crt-base, #c87820)' : 'var(--color-border)'}; box-shadow: {local[row.key as keyof CRTConfig] ? '0 0 8px rgba(200,120,32,0.4)' : 'none'};"
                >
                  <div
                    class="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-150"
                    style="left: {local[row.key as keyof CRTConfig] ? '18px' : '2px'};"
                  ></div>
                </div>
              </button>
            {/each}
          </div>

        </div>

        <!-- Live Preview -->
        <div class="w-[280px] shrink-0 flex flex-col bg-bg">
          <div class="px-3.5 py-2.5 text-[10px] font-semibold tracking-widest uppercase text-muted-foreground border-b border-border shrink-0">
            Live Preview
          </div>
          <div class="flex-1 p-4 flex items-start">
            <!-- CRT mini preview -->
            <div
              class="w-full border-2 relative overflow-hidden"
              style="
                border-color: #4a3008;
                box-shadow: 0 0 20px rgba(200,120,32,0.15), 0 0 0 1px #2e1e04;
                height: 200px;
                background: #070501;
                font-family: 'Courier New', monospace;
                font-size: 9px;
                letter-spacing: 0.07em;
              "
            >
              <!-- Scanlines overlay -->
              {#if local.scan !== 'off'}
                <div
                  class="absolute inset-0 pointer-events-none"
                  style="z-index: 22; background: {scanlineStyle};"
                ></div>
              {/if}

              <!-- Subpixel overlay -->
              {#if local.subpixel}
                <div
                  class="absolute inset-0 pointer-events-none"
                  style="z-index: 20; background-image: repeating-linear-gradient(90deg, rgba(255,80,0,0.06) 0px, rgba(255,80,0,0.06) 1px, rgba(255,200,0,0.04) 1px, rgba(255,200,0,0.04) 2px, rgba(180,60,0,0.03) 2px, rgba(180,60,0,0.03) 3px, transparent 3px, transparent 4px);"
                ></div>
              {/if}

              <!-- Warm ambient overlay -->
              {#if local.warmAmbient}
                <div
                  class="absolute inset-0 pointer-events-none"
                  style="z-index: 1; background: radial-gradient(ellipse 85% 80% at 50% 35%, rgba(90,45,0,0.18) 0%, transparent 100%);"
                ></div>
              {/if}

              <!-- Content -->
              <div
                class="relative"
                style="z-index: 5; animation: {local.flicker ? 'crt-screen-flicker 5s ease-in-out infinite' : 'none'}; {previewTextShadow}"
              >
                <!-- Topbar -->
                <div style="height:18px; background:rgba(8,5,0,.95); border-bottom: 1px solid #4a3008; display:flex; align-items:center; padding:0 8px; gap:6px;">
                  <span style="font-size:8px; font-weight:bold; letter-spacing:.2em; color:#ffbe40;">[MINION]</span>
                  <div style="width:4px; height:4px; background:#40c840; box-shadow: 0 0 4px #40c840; margin-left:auto; animation: crt-led-pulse 2s ease-in-out infinite;"></div>
                </div>
                <!-- Cards -->
                <div style="padding: 8px; display:flex; flex-direction:column; gap:5px;">
                  <div style="background:#0e0a02; border: 1px solid #2e1e04; padding:5px 7px; display:flex; align-items:center; gap:6px; box-shadow: 2px 2px 0 #040300;">
                    <div style="width:16px; height:16px; background:#c87820; color:#040300; font-size:6px; font-weight:bold; display:flex; align-items:center; justify-content:center; flex-shrink:0;">AG</div>
                    <div>
                      <div style="font-size:8px; letter-spacing:.1em; color:#ffbe40; text-transform:uppercase;">AGENT_01</div>
                      <div style="font-size:6px; color:#6b4010;">idle · 0 sessions</div>
                    </div>
                    <div style="font-size:6px; letter-spacing:.1em; padding:1px 4px; background:rgba(68,221,68,.08); border:1px solid rgba(68,221,68,.4); color:#40c840; margin-left:auto;">ON</div>
                  </div>
                  <div style="background:#040300; border: 1px solid #2e1e04; padding:5px 7px; font-size:7px; line-height:1.8; color:#6b4010;">
                    <span style="color:#e8a030;">gateway</span> <span style="color:#ffbe40;">connected</span><br>
                    <span style="color:#e8a030;">agents</span> <span style="color:#ffbe40;">3</span> / <span style="color:#6b4010;">active</span><br>
                    <span style="display:inline-block; width:5px; height:9px; background:#ffbe40; vertical-align:text-bottom; animation: crt-cursor-blink 1s step-end infinite;"></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- Footer -->
      <div class="flex items-center gap-2.5 px-5 py-3 border-t border-border shrink-0">
        <div class="flex-1 text-[11px] text-muted-foreground">Changes apply on save</div>
        <button
          type="button"
          onclick={() => { local = { bloom: 'subtle', scan: 'default', matrix: false, subpixel: true, phosphorDots: false, rgbFringe: false, warmAmbient: true, vignette: false, glass: false, flicker: true }; }}
          class="px-3 py-1.5 text-[11px] text-muted-foreground border border-border hover:text-foreground hover:border-muted-foreground transition-all"
          style="border-radius: 0;"
        >
          Reset
        </button>
        <button
          type="button"
          onclick={close}
          class="px-3 py-1.5 text-[11px] text-muted-foreground border border-border hover:text-foreground hover:border-muted-foreground transition-all"
          style="border-radius: 0;"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={save}
          class="px-4 py-1.5 text-[11px] font-medium uppercase tracking-widest transition-all"
          style="background: var(--crt-base, #c87820); color: #000; font-family: 'Courier New', monospace; border: none; box-shadow: 0 0 8px rgba(200,120,32,0.4); border-radius: 0;"
        >
          Apply
        </button>
      </div>

    </div>
  </div>
{/if}
