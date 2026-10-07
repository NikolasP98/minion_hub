import './fixture.css';
import { mount } from 'svelte';
import ChatMessage from '../../../../src/lib/components/chat/ChatMessage.svelte';
import { renderMention } from '../../../../src/lib/utils/mention';
import { getAliases } from './stubs/aliases';
import { applyTheme } from '../../../../src/lib/themes/runtime';
import { PRESETS, ACCENT_OPTIONS } from '../../../../src/lib/themes/presets';
import { composite, contrast, parseCssColor, toHex, type Rgba } from '../css-color';

const list = document.getElementById('list')!;
const TEXT = 'Ping @ana and @luis about the 15:30 booking';

function row(surface: string): HTMLElement {
  const el = document.createElement('div');
  el.dataset.surface = surface;
  el.className = 'flex flex-col';
  list.appendChild(el);
  return el;
}

// ordinary: the global .mention rule on plain panel text (the FlowCopilotPanel/any-consumer default)
row('ordinary').innerHTML = `<div class="text-xs leading-relaxed">${renderMention(TEXT, getAliases())}</div>`;
// user bubble (HC-042 accepted surface) and error bubble: the real component
mount(ChatMessage, { target: row('user'), props: { message: { role: 'user', content: TEXT, timestamp: Date.now() } } });
mount(ChatMessage, { target: row('error'), props: { message: { role: 'assistant', content: `Error: ${TEXT}` }, error: true } });

/** Chromium-native cross-check: canvas resolves the OPAQUE colour string to 8-bit sRGB. */
function canvasRgb(color: string): [number, number, number] {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = color.replace(/\s*\/\s*[0-9.%]+\s*\)$/, ')').replace(/^rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)$/, 'rgb($1,$2,$3)');
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

export function measure() {
  const out: Record<string, unknown>[] = [];
  for (const host of Array.from(list.querySelectorAll<HTMLElement>('[data-surface]'))) {
    const el = host.querySelector<HTMLElement>('.mention')!;
    const cs = getComputedStyle(el);
    const layers: { el: string; css: string; rgba: Rgba; canvas?: [number, number, number]; canvasDelta?: number }[] = [];
    let node: Element | null = el;
    while (node) {
      const css = getComputedStyle(node).backgroundColor;
      const rgba = parseCssColor(css);
      const entry: (typeof layers)[number] = { el: node.tagName.toLowerCase() + (node.className && typeof node.className === 'string' ? '.' + node.className.split(' ').slice(0, 2).join('.') : ''), css, rgba };
      if (rgba[3] > 0) {
        entry.canvas = canvasRgb(css);
        entry.canvasDelta = Math.max(...entry.canvas.map((v, i) => Math.abs(v - rgba[i])));
      }
      layers.push(entry);
      node = node.parentElement;
    }
    const fg = parseCssColor(cs.color);
    const bg = composite(layers.map((l) => l.rgba));
    out.push({
      surface: host.dataset.surface,
      theme: document.documentElement.getAttribute('data-minion-theme'),
      accent: document.documentElement.style.getPropertyValue('--color-accent'),
      text: el.textContent,
      fgCss: cs.color,
      fg: toHex([fg[0], fg[1], fg[2]]),
      bg: toHex(bg),
      ratio: contrast([fg[0], fg[1], fg[2]], bg),
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      textDecorationLine: cs.textDecorationLine,
      tabIndex: el.tabIndex,
      canvasMaxDelta: Math.max(0, ...layers.map((l) => l.canvasDelta ?? 0)),
      layers: layers.map((l) => `${l.el}: ${l.css}`),
    });
  }
  return out;
}

export function measureAllThemes() {
  const rows: unknown[] = [];
  for (const preset of PRESETS) for (const accent of ACCENT_OPTIONS) {
    applyTheme(preset, accent.value);
    for (const m of measure()) rows.push({ ...m, theme: preset.id, accentId: accent.id });
  }
  return rows;
}

export function setTheme(presetId: string, accentId: string) {
  const preset = PRESETS.find((p) => p.id === presetId)!;
  const accent = ACCENT_OPTIONS.find((a) => a.id === accentId)!;
  applyTheme(preset, accent.value);
}

Object.assign(window, { __hc043: { measure, measureAllThemes, setTheme } });
setTheme('new-york', 'blue');
