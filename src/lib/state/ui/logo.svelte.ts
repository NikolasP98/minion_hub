// Logo state module - manages site identity/logo presets
// Includes squid-inspired design from WhatsApp profile pic

export interface LogoPreset {
  id: string;
  name: string;
  description: string;
  /** Primary color for the logo */
  primaryColor: string;
  /** Secondary/accent color */
  secondaryColor: string;
  /** Background color for the logo badge */
  bgColor: string;
  /** Whether this is a dark-on-light or light-on-dark logo */
  variant: 'dark' | 'light';
}

export const LOGO_PRESETS: LogoPreset[] = [
  {
    id: 'minion',
    name: 'Minion',
    description: 'Classic minion goggles - the original',
    primaryColor: '#0a0a0a',
    secondaryColor: '#e8547a',
    bgColor: '#e8547a',
    variant: 'dark',
  },
  {
    id: 'squid',
    name: 'Squid',
    description: 'Cephalopod-inspired with textured skin and large eyes',
    primaryColor: '#e8d5d5',
    secondaryColor: '#1a1a2e',
    bgColor: '#c45c5c',
    variant: 'dark',
  },
  {
    id: 'agent',
    name: 'Agent',
    description: 'Abstract agent node with connection points',
    primaryColor: '#fafafa',
    secondaryColor: '#3b82f6',
    bgColor: '#18181b',
    variant: 'light',
  },
  {
    id: 'orbital',
    name: 'Orbital',
    description: 'Planetary rings around a central core',
    primaryColor: '#f0f0f0',
    secondaryColor: '#a855f7',
    bgColor: '#0a0a0a',
    variant: 'light',
  },
  {
    id: 'hex',
    name: 'Hex',
    description: 'Geometric hexagon with inner pattern',
    primaryColor: '#fafafa',
    secondaryColor: '#22c55e',
    bgColor: '#0c0c0e',
    variant: 'light',
  },
];

const LOGO_STORAGE_KEY = 'minion-hub-logo';

interface LogoConfig {
  presetId: string;
}

function loadConfig(): LogoConfig {
  if (typeof localStorage === 'undefined') return { presetId: 'minion' };
  try {
    const raw = localStorage.getItem(LOGO_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { presetId: 'minion' };
}

function saveConfig(cfg: LogoConfig) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LOGO_STORAGE_KEY, JSON.stringify(cfg));
}

// Initialize state
const initial = loadConfig();
let presetId = $state(initial.presetId);

const preset = $derived(LOGO_PRESETS.find((p) => p.id === presetId) ?? LOGO_PRESETS[0]);

export const logoState = {
  get presetId() { return presetId; },
  get preset() { return preset; },
  get presets() { return LOGO_PRESETS; },

  setPreset(id: string) {
    presetId = id;
    saveConfig({ presetId });
    // Update favicon when logo changes
    updateFavicon(id);
  },

  // Get SVG content for current preset (for favicon generation)
  getSvgForPreset(id: string): string {
    return getLogoSvg(id);
  },
};

/** Generate SVG string for a given logo preset */
function getLogoSvg(id: string): string {
  switch (id) {
    case 'squid':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
        <defs>
          <radialGradient id="squid-skin" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#d47474"/>
            <stop offset="70%" stop-color="#b85c5c"/>
            <stop offset="100%" stop-color="#9c4444"/>
          </radialGradient>
          <filter id="texture">
            <feTurbulence type="fractalNoise" baseFrequency="0.15" numOctaves="2" result="noise"/>
            <feDiffuseLighting in="noise" lighting-color="#ffffff" surfaceScale="1" result="light">
              <feDistantLight azimuth="45" elevation="60"/>
            </feDiffuseLighting>
            <feBlend in="SourceGraphic" in2="light" mode="multiply"/>
          </filter>
        </defs>
        <rect width="32" height="32" rx="7" fill="url(#squid-skin)"/>
        <!-- Skin texture dots -->
        <circle cx="6" cy="8" r="0.8" fill="#a04040" opacity="0.4"/>
        <circle cx="10" cy="5" r="0.6" fill="#a04040" opacity="0.3"/>
        <circle cx="24" cy="7" r="0.7" fill="#a04040" opacity="0.4"/>
        <circle cx="20" cy="10" r="0.5" fill="#a04040" opacity="0.3"/>
        <circle cx="8" cy="22" r="0.6" fill="#a04040" opacity="0.3"/>
        <circle cx="26" cy="20" r="0.8" fill="#a04040" opacity="0.4"/>
        <!-- Left eye -->
        <ellipse cx="10" cy="14" rx="5" ry="6" fill="#f5f5f5"/>
        <ellipse cx="10" cy="14" rx="5" ry="6" fill="none" stroke="#1a1a2e" stroke-width="1.5"/>
        <ellipse cx="10" cy="14" rx="2.5" ry="3.5" fill="#1a1a2e"/>
        <circle cx="11" cy="12.5" r="1" fill="white" opacity="0.6"/>
        <!-- Right eye -->
        <ellipse cx="22" cy="14" rx="5" ry="6" fill="#f5f5f5"/>
        <ellipse cx="22" cy="14" rx="5" ry="6" fill="none" stroke="#1a1a2e" stroke-width="1.5"/>
        <ellipse cx="22" cy="14" rx="2.5" ry="3.5" fill="#1a1a2e"/>
        <circle cx="23" cy="12.5" r="1" fill="white" opacity="0.6"/>
        <!-- Subtle mouth -->
        <path d="M14 24 Q16 26 18 24" stroke="#8b4040" stroke-width="1" fill="none" stroke-linecap="round"/>
      </svg>`;

    case 'agent':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
        <rect width="32" height="32" rx="7" fill="#18181b"/>
        <!-- Central node -->
        <circle cx="16" cy="16" r="5" fill="#3b82f6"/>
        <!-- Orbiting nodes -->
        <circle cx="16" cy="6" r="2.5" fill="#60a5fa"/>
        <circle cx="25" cy="22" r="2.5" fill="#60a5fa"/>
        <circle cx="7" cy="22" r="2.5" fill="#60a5fa"/>
        <!-- Connection lines -->
        <path d="M16 11 L16 8.5 M20.5 19 L23 20.5 M11.5 19 L9 20.5" stroke="#3b82f6" stroke-width="1.5" stroke-linecap="round"/>
      </svg>`;

    case 'orbital':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
        <rect width="32" height="32" rx="7" fill="#0a0a0a"/>
        <!-- Planet -->
        <circle cx="16" cy="16" r="6" fill="#a855f7"/>
        <circle cx="14" cy="14" r="2" fill="#c084fc" opacity="0.5"/>
        <!-- Ring -->
        <ellipse cx="16" cy="16" rx="12" ry="4" fill="none" stroke="#a855f7" stroke-width="1.5" transform="rotate(-20 16 16)"/>
        <!-- Moons -->
        <circle cx="24" cy="10" r="1.5" fill="#d8b4fe"/>
        <circle cx="8" cy="22" r="1.5" fill="#d8b4fe"/>
      </svg>`;

    case 'hex':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
        <rect width="32" height="32" rx="7" fill="#0c0c0e"/>
        <!-- Outer hexagon -->
        <polygon points="16,4 26,9 26,23 16,28 6,23 6,9" fill="none" stroke="#22c55e" stroke-width="2"/>
        <!-- Inner hexagon -->
        <polygon points="16,10 21,13 21,19 16,22 11,19 11,13" fill="#22c55e" opacity="0.3"/>
        <!-- Center dot -->
        <circle cx="16" cy="16" r="2" fill="#22c55e"/>
      </svg>`;

    case 'minion':
    default:
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
        <rect width="32" height="32" rx="7" fill="#e8547a"/>
        <g transform="translate(4, 4)">
          <circle cx="6" cy="8" r="4" fill="none" stroke="#0a0a0a" stroke-width="2.5"/>
          <circle cx="6" cy="8" r="1.5" fill="#0a0a0a"/>
          <circle cx="18" cy="8" r="4" fill="none" stroke="#0a0a0a" stroke-width="2.5"/>
          <circle cx="18" cy="8" r="1.5" fill="#0a0a0a"/>
          <path d="M10 8h4" stroke="#0a0a0a" stroke-width="2.5" stroke-linecap="round"/>
          <path d="M6 15c2.5 2 7.5 2 10 0" stroke="#0a0a0a" stroke-width="2" stroke-linecap="round" fill="none"/>
        </g>
      </svg>`;
  }
}

/** Update the favicon dynamically */
function updateFavicon(presetId: string) {
  if (typeof document === 'undefined') return;

  const svg = getLogoSvg(presetId);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  // Find existing favicon or create new one
  let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }

  // Revoke old URL to prevent memory leaks
  if (link.href && link.href.startsWith('blob:')) {
    URL.revokeObjectURL(link.href);
  }

  link.type = 'image/svg+xml';
  link.href = url;
}
