/**
 * Builds the document an element runs in (contract §4).
 *
 * The iframe is `sandbox="allow-scripts"` with no `allow-same-origin`, so the
 * element has a null origin: no hub DOM, no cookies, and a credential-less
 * origin. The CSP meta below closes the rest — `connect-src 'none'` means the
 * element cannot reach the network at all, and `script-src` allows only inline
 * code (eval included — same capability) plus the hub's own allowlisted vendor
 * assets.
 */
import { BRIDGE_SCRIPT } from './bridge';
import type { VendorUrls } from './vendor';

/** Semantic tokens copied into the element's `:root` (design-token contract). */
export const SANDBOX_THEME_TOKENS = [
  '--color-canvas',
  '--color-surface-1',
  '--color-surface-2',
  '--color-surface-3',
  '--color-overlay',
  '--color-border-subtle',
  '--color-border-default',
  '--color-border-strong',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-tertiary',
  '--color-text-disabled',
  '--color-accent',
  '--color-on-accent',
  '--color-success-fg',
  '--color-success-surface',
  '--color-success-border',
  '--color-warning-fg',
  '--color-warning-surface',
  '--color-warning-border',
  '--color-danger-fg',
  '--color-danger-surface',
  '--color-danger-border',
  '--color-info-fg',
  '--color-info-surface',
  '--color-info-border',
  '--color-purple',
  '--color-pink',
  '--color-cyan',
  '--color-emerald',
  '--color-neutral',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--font-family-sans',
  '--font-family-mono',
] as const;

export interface SandboxSrcdocElement {
  id: string;
  title: string;
  html: string;
  css: string;
  js: string;
}

export interface SandboxSrcdocInput {
  element: SandboxSrcdocElement;
  /** Hub origin — the only script source the CSP allows besides inline code. */
  origin: string;
  themeVars: Record<string, string>;
  vendorUrls: VendorUrls;
  size?: { w: number; h: number };
  /** Bumped by `host.reload(id)` to force a fresh document. */
  version?: number;
}

/** Resolve the element theme from the live document. Browser only. */
export function readThemeVars(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const computed = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const token of SANDBOX_THEME_TOKENS) {
    const value = computed.getPropertyValue(token).trim();
    if (value) vars[token] = value;
  }
  return vars;
}

/** `</script>` inside a JSON blob would close the host script tag. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function themeCss(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([name, value]) => `${name}:${value};`)
    .join('');
}

export function buildSrcdoc(input: SandboxSrcdocInput): string {
  const { element, origin, themeVars, vendorUrls, size, version } = input;
  const config = jsonForScript({
    elementId: element.id,
    vendor: vendorUrls,
    theme: themeVars,
    size: size ?? { w: 0, h: 0 },
    version: version ?? 0,
  });
  return (
    '<!doctype html>' +
    // 'unsafe-eval': echarts-gl (claygl) builds its compositor parameters with
    // `new Function` and throws "Invalid expression." without it. It grants the
    // element nothing its own inline script does not already have — the CSP's
    // job here is sources (hub-origin scripts only) and `connect-src 'none'`.
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${origin}; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'">` +
    `<style>:root{${themeCss(themeVars)}}` +
    'html,body{margin:0;height:100%;background:var(--color-surface-1);color:var(--color-text-primary);' +
    'font-family:var(--font-family-sans);font-size:0.875rem;box-sizing:border-box}' +
    '*,*::before,*::after{box-sizing:inherit}' +
    'pre.minion-error{position:absolute;left:0;right:0;bottom:0;margin:0;padding:0.5rem;white-space:pre-wrap;' +
    'font-family:var(--font-family-mono);font-size:0.75rem;color:var(--color-danger-fg);' +
    'background:var(--color-danger-surface);border-top:1px solid var(--color-danger-border)}' +
    '</style>' +
    `<style>${element.css}</style>` +
    `<body>${element.html}</body>` +
    `<script>window.__MINION_SANDBOX__=${config};</script>` +
    `<script>${BRIDGE_SCRIPT}</script>` +
    `<script>${element.js}</script>`
  );
}
