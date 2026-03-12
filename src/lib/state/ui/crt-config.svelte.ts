const STORAGE_KEY = 'minion-hub-crt-config';

export interface CRTConfig {
  bloom: 'none' | 'subtle' | 'deep' | 'halation';
  scan: 'off' | 'subtle' | 'default' | 'heavy' | 'cinematic';
  matrix: boolean;
  subpixel: boolean;
  phosphorDots: boolean;
  rgbFringe: boolean;
  warmAmbient: boolean;
  vignette: boolean;
  glass: boolean;
  flicker: boolean;
}

const DEFAULT_CRT_CONFIG: CRTConfig = {
  bloom: 'subtle',
  scan: 'default',
  matrix: false,
  subpixel: true,
  phosphorDots: false,
  rgbFringe: false,
  warmAmbient: true,
  vignette: false,
  glass: false,
  flicker: true,
};

function loadCRTConfig(): CRTConfig {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_CRT_CONFIG };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CRT_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_CRT_CONFIG };
}

function saveCRTConfig(cfg: CRTConfig) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

let config = $state<CRTConfig>(loadCRTConfig());

export const crtConfig = {
  get bloom()       { return config.bloom; },
  get scan()        { return config.scan; },
  get matrix()      { return config.matrix; },
  get subpixel()    { return config.subpixel; },
  get phosphorDots(){ return config.phosphorDots; },
  get rgbFringe()   { return config.rgbFringe; },
  get warmAmbient() { return config.warmAmbient; },
  get vignette()    { return config.vignette; },
  get glass()       { return config.glass; },
  get flicker()     { return config.flicker; },

  set(updates: Partial<CRTConfig>) {
    config = { ...config, ...updates };
    saveCRTConfig(config);
  },

  reset() {
    config = { ...DEFAULT_CRT_CONFIG };
    saveCRTConfig(config);
  },

  /** Apply data attributes to <html> for CSS to respond to */
  apply() {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    html.dataset.crtBloom     = config.bloom;
    html.dataset.crtScan      = config.scan;
    html.dataset.crtSubpixel  = String(config.subpixel);
    html.dataset.crtWarm      = String(config.warmAmbient);
    html.dataset.crtFlicker   = String(config.flicker);
    html.dataset.crtVignette  = String(config.vignette);
    html.dataset.crtGlass     = String(config.glass);
    html.dataset.crtMatrix    = String(config.matrix);
    html.dataset.crtPhosphor  = String(config.phosphorDots);
    html.dataset.crtRgbfringe = String(config.rgbFringe);
  },

  /** Remove all CRT data attributes when switching away from CRT theme */
  cleanup() {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    for (const k of ['crtBloom', 'crtScan', 'crtSubpixel', 'crtWarm',
      'crtFlicker', 'crtVignette', 'crtGlass', 'crtMatrix', 'crtPhosphor', 'crtRgbfringe'])
      delete html.dataset[k];
  },
};
