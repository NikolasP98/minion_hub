/**
 * HC-043 — static resolution of the shipped `.mention` foreground against the
 * generated theme tokens, for every supported preset × runtime accent × mention
 * surface. Mirrors what the browser does: tokens.css supplies the theme block,
 * `applyTheme()` then writes the chosen accent pair inline on <html>.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PRESETS, ACCENT_OPTIONS } from '../../../src/lib/themes/presets';
import { onAccentFor } from '../../../src/lib/themes/contrast';
import { composite, contrast, parseCssColor, toHex, type Rgba } from './css-color';

const ROOT = path.resolve(import.meta.dirname, '../../..');
export const APP_CSS = path.join(ROOT, 'src/app.css');
export const TOKENS_CSS = path.join(ROOT, 'node_modules/@minion-stack/design-tokens/tokens.css');
export const CHAT_MESSAGE = path.join(ROOT, 'src/lib/components/chat/ChatMessage.svelte');

export type Declarations = Record<string, string>;

/** `selector { decls }` → declaration map for the FIRST block whose selector matches exactly. */
export function ruleDeclarations(css: string, selector: string): Declarations | null {
  const re = new RegExp(`(^|[}\\n])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm');
  const m = re.exec(css);
  if (!m) return null;
  const out: Declarations = {};
  for (const line of m[2].split(';')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** Per-theme custom-property maps from the generated tokens.css (`@theme static` = new-york base). */
export function themeTokens(): Record<string, Declarations> {
  const css = readFileSync(TOKENS_CSS, 'utf8');
  const blocks: Record<string, Declarations> = {};
  const re = /(@theme static|:root(?:\[data-minion-theme='([a-z-]+)'\])?)[^{]*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const id = m[2] ?? 'new-york';
    const decls = (blocks[id] ??= {});
    for (const line of m[3].split(';')) {
      const i = line.indexOf(':');
      if (i === -1) continue;
      const name = line.slice(0, i).trim();
      if (name.startsWith('--')) decls[name] = line.slice(i + 1).trim();
    }
  }
  // Non-default themes only override; everything else falls through to :root.
  for (const id of Object.keys(blocks)) if (id !== 'new-york') blocks[id] = { ...blocks['new-york'], ...blocks[id] };
  return blocks;
}

/** Resolve `var(--x)` chains to a parsed colour. Throws on cycles/unknown tokens. */
export function resolveColor(value: string, vars: Declarations, depth = 0): Rgba {
  if (depth > 12) throw new Error(`var() chain too deep: ${value}`);
  const v = value.trim();
  const m = /^var\((--[a-z0-9-]+)\)$/i.exec(v);
  if (m) {
    const next = vars[m[1]];
    if (next === undefined) throw new Error(`unknown token ${m[1]}`);
    return resolveColor(next, vars, depth + 1);
  }
  return parseCssColor(v);
}

export type Surface = 'ordinary' | 'error' | 'user';
export const SURFACES: Surface[] = ['ordinary', 'error', 'user'];
/** Opaque hosts a chat panel can sit on; the live DetailPanel host is surface-2. */
export const HOSTS = ['--color-canvas', '--color-surface-1', '--color-surface-2', '--color-surface-3'] as const;

/**
 * Hosts where the SURFACE'S OWN text already fails AA, so an inheriting mention can
 * only match it. Both are token/surface defects outside the mention rule; neither is
 * a chat host (DetailPanel = surface-2, FlowCopilotPanel = surface-1).
 * TODO(handoff): solarized-light `--color-text-primary` #586e75 on `--color-surface-3`
 * #eee8d5 = 4.39:1 (meta packages/design-tokens/contract.json only gates text against
 * canvas); gruvbox-light `text-destructive` on `bg-destructive/15` over surface-3 =
 * 3.86:1 (ChatMessage error bubble). Remove an entry once its surface clears 4.5:1.
 */
export const KNOWN_SURFACE_TEXT_GAPS = new Set([
  'solarized-light|ordinary|--color-surface-3',
  'gruvbox-light|error|--color-surface-3',
]);

export interface Measurement {
  theme: string;
  accent: string; // accent option id, or 'theme-default' (tokens.css value, no runtime override)
  surface: Surface;
  host: string;
  fg: string;
  bg: string;
  ratio: number;
  surfaceTextRatio: number; // the host surface's own text on the same background
  fgSource: string; // which declaration decided the foreground
}

/** The mention foreground on a surface whose own text colour is `hostFg`. */
function mentionFg(decl: Declarations | null, hostFg: Rgba, vars: Declarations): { fg: Rgba; source: string } {
  const color = decl?.color;
  if (!color || color === 'inherit' || color === 'currentcolor') return { fg: hostFg, source: `${color ?? 'unset'} → surface text` };
  return { fg: resolveColor(color, vars), source: color };
}

/**
 * Measure every preset × accent × surface × host with the rules currently on disk.
 * `userScoped` is ChatMessage's `.chat-user-message :global(.mention)` block (HC-042);
 * when absent the global rule applies to the user bubble too.
 */
export function measureAll(): Measurement[] {
  const app = readFileSync(APP_CSS, 'utf8');
  const chat = readFileSync(CHAT_MESSAGE, 'utf8');
  const global = ruleDeclarations(app, '.mention');
  if (!global) throw new Error('src/app.css has no .mention rule');
  const userScoped = ruleDeclarations(chat, '.chat-user-message :global(.mention)');
  const tokens = themeTokens();
  const out: Measurement[] = [];

  for (const preset of PRESETS) {
    const base = tokens[preset.id];
    if (!base) throw new Error(`tokens.css has no block for ${preset.id}`);
    const accents = [
      { id: 'theme-default', vars: base },
      ...ACCENT_OPTIONS.map((a) => ({
        id: a.id,
        vars: { ...base, '--color-accent': a.value, '--color-on-accent': onAccentFor(a.value) },
      })),
    ];
    for (const { id: accentId, vars } of accents) {
      for (const host of HOSTS) {
        const hostBg = resolveColor(`var(${host})`, vars);
        const canvas = resolveColor('var(--color-canvas)', vars);
        const textPrimary = resolveColor('var(--color-text-primary)', vars);
        const dangerFg = resolveColor('var(--color-destructive)', vars);
        const accent = resolveColor('var(--color-accent)', vars);
        const onAccent = resolveColor('var(--color-on-accent)', vars);

        const surfaces: Record<Surface, { hostFg: Rgba; layers: Rgba[]; decl: Declarations | null }> = {
          // plain text on the host (body colour = --color-foreground → text-primary)
          ordinary: { hostFg: textPrimary, layers: [hostBg, canvas], decl: global },
          // ChatMessage error bubble: `bg-destructive/15 text-destructive` = danger-fg @ 0.15 over host
          error: { hostFg: dangerFg, layers: [[dangerFg[0], dangerFg[1], dangerFg[2], 0.15], hostBg, canvas], decl: global },
          // ChatMessage user bubble: `bg-accent text-[var(--color-on-accent)]`, scoped rule wins when present
          user: { hostFg: onAccent, layers: [accent, hostBg, canvas], decl: userScoped ? { ...global, ...userScoped } : global },
        };
        for (const surface of SURFACES) {
          const s = surfaces[surface];
          const { fg, source } = mentionFg(s.decl, s.hostFg, vars);
          const bg = composite(s.layers);
          const fgOpaque: [number, number, number] = [fg[0], fg[1], fg[2]];
          const hostText: [number, number, number] = [s.hostFg[0], s.hostFg[1], s.hostFg[2]];
          out.push({ theme: preset.id, accent: accentId, surface, host, fg: toHex(fgOpaque), bg: toHex(bg), ratio: contrast(fgOpaque, bg), surfaceTextRatio: contrast(hostText, bg), fgSource: source });
        }
      }
    }
  }
  return out;
}
