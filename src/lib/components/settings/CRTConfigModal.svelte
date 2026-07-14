<script lang="ts">
  import { Button, Toggle } from '$lib/components/ui';
  import { Dialog } from '$lib/components/ui/foundations';
  import { crtConfig, type CRTConfig } from '$lib/state/ui/crt-config.svelte';
  import * as m from '$lib/paraglide/messages';

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

  const pixelRows = $derived([
    { key: 'subpixel',    label: m.crt_subpixelLabel(),    desc: m.crt_subpixelDesc() },
    { key: 'matrix',      label: m.crt_matrixLabel(),      desc: m.crt_matrixDesc() },
    { key: 'phosphorDots',label: m.crt_phosphorDotsLabel(), desc: m.crt_phosphorDotsDesc() },
    { key: 'rgbFringe',   label: m.crt_rgbFringeLabel(),   desc: m.crt_rgbFringeDesc() },
  ]);

  const atmosphereRows = $derived([
    { key: 'warmAmbient', label: m.crt_warmAmbientLabel(), desc: m.crt_warmAmbientDesc() },
    { key: 'vignette',    label: m.crt_vignetteLabel(),    desc: m.crt_vignetteDesc() },
    { key: 'glass',       label: m.crt_glassLabel(),       desc: m.crt_glassDesc() },
    { key: 'flicker',     label: m.crt_flickerLabel(),     desc: m.crt_flickerDesc() },
  ]);

  const bloomValues: CRTConfig['bloom'][] = ['none', 'subtle', 'deep', 'halation'];
  const scanValues: CRTConfig['scan'][] = ['off', 'subtle', 'default', 'heavy', 'cinematic'];
</script>

<Dialog bind:open title={m.crt_title()} description={m.crt_subtitle()} size="xl" variant="crt">
  <!-- Body: controls + preview -->
  <div class="flex min-h-0 overflow-hidden max-md:flex-col">

        <!-- Controls -->
        <div class="flex-1 overflow-y-auto p-5 flex flex-col gap-5 border-r border-border min-w-0">

          <!-- Phosphor Bloom -->
          <div class="flex flex-col gap-2">
            <div class="t-label pb-1.5 border-b border-border">
              {m.crt_phosphorBloom()}
            </div>
            <div class="flex gap-0.5 bg-bg border border-border p-0.5">
              {#each bloomValues as val (val)}
                <Button
                  type="button"
                  onclick={() => local = { ...local, bloom: val }}
                  variant={local.bloom === val ? 'primary' : 'secondary'}
                  size="sm"
                  class="flex-1 uppercase"
                  aria-pressed={local.bloom === val}
                >
                  {val === 'halation' ? 'Halo' : val.charAt(0).toUpperCase() + val.slice(1)}
                </Button>
              {/each}
            </div>
            <div class="t-caption">
              {local.bloom === 'none' ? m.crt_bloomNone() : local.bloom === 'subtle' ? m.crt_bloomSubtle() : local.bloom === 'deep' ? m.crt_bloomDeep() : m.crt_bloomHalation()}
            </div>
          </div>

          <!-- Scanlines -->
          <div class="flex flex-col gap-2">
            <div class="t-label pb-1.5 border-b border-border">
              {m.crt_scanlines()}
            </div>
            <div class="flex gap-0.5 bg-bg border border-border p-0.5">
              {#each scanValues as val (val)}
                <Button
                  type="button"
                  onclick={() => local = { ...local, scan: val }}
                  variant={local.scan === val ? 'primary' : 'secondary'}
                  size="sm"
                  class="flex-1 uppercase"
                  aria-pressed={local.scan === val}
                >
                  {val === 'cinematic' ? 'Film' : val === 'default' ? 'Std' : val.charAt(0).toUpperCase() + val.slice(1)}
                </Button>
              {/each}
            </div>
          </div>

          <!-- Pixel Structure -->
          <div class="flex flex-col gap-0">
            <div class="t-label pb-1.5 border-b border-border mb-1">
              {m.crt_pixelStructure()}
            </div>
            {#each pixelRows as row, i (row.key)}
              <div class="flex items-center gap-3 py-2 w-full {i > 0 ? 'border-t border-border' : ''}">
                <div class="flex-1">
                  <div class="text-sm text-foreground">{row.label}</div>
                  <div class="t-caption">{row.desc}</div>
                </div>
                <Toggle
                  checked={Boolean(local[row.key as keyof CRTConfig])}
                  ariaLabel={row.label}
                  onchange={(checked) => local = { ...local, [row.key]: checked }}
                />
              </div>
            {/each}
          </div>

          <!-- Atmosphere -->
          <div class="flex flex-col gap-0">
            <div class="t-label pb-1.5 border-b border-border mb-1">
              {m.crt_atmosphere()}
            </div>
            {#each atmosphereRows as row, i (row.key)}
              <div class="flex items-center gap-3 py-2 w-full {i > 0 ? 'border-t border-border' : ''}">
                <div class="flex-1">
                  <div class="text-sm text-foreground">{row.label}</div>
                  <div class="t-caption">{row.desc}</div>
                </div>
                <Toggle
                  checked={Boolean(local[row.key as keyof CRTConfig])}
                  ariaLabel={row.label}
                  onchange={(checked) => local = { ...local, [row.key]: checked }}
                />
              </div>
            {/each}
          </div>

        </div>

        <!-- Live Preview -->
        <div class="w-72 shrink-0 flex flex-col bg-bg max-md:w-full">
          <div class="px-3.5 py-2.5 t-label border-b border-border shrink-0">
            {m.crt_livePreview()}
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
  </div>

  {#snippet footer()}
        <div class="mr-auto t-caption">{m.crt_changesApplyOnSave()}</div>
        <Button variant="outline" size="sm"
          type="button"
          onclick={() => { local = { bloom: 'subtle', scan: 'default', matrix: false, subpixel: true, phosphorDots: false, rgbFringe: false, warmAmbient: true, vignette: false, glass: false, flicker: true }; }}
        >
          {m.common_reset()}
        </Button>
        <Button variant="ghost" size="sm"
          type="button"
          onclick={close}
        >
          {m.common_cancel()}
        </Button>
        <Button variant="primary" size="sm"
          type="button"
          onclick={save}
        >
          {m.crt_apply()}
        </Button>
  {/snippet}
</Dialog>
