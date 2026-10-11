// @vitest-environment happy-dom
/**
 * Module-level `$state` only (no `$effect`), so it is safe to call directly
 * without an owning `$effect.root`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { registerLayer, tooltipAllowed } from './floating-layer.svelte';

const release: Array<() => void> = [];

function layer(): HTMLElement {
  const el = document.createElement('div');
  document.body.append(el);
  release.push(registerLayer(el));
  return el;
}

afterEach(() => {
  while (release.length) release.pop()?.();
  document.body.innerHTML = '';
});

describe('floating-layer registry', () => {
  it('allows a tooltip while nothing is floating', () => {
    expect(tooltipAllowed(document.createElement('button'))).toBe(true);
    expect(tooltipAllowed(null)).toBe(true);
  });

  it('denies a tooltip whose trigger is outside every open layer', () => {
    layer();
    const outside = document.createElement('button');
    document.body.append(outside);
    expect(tooltipAllowed(outside)).toBe(false);
    // An unresolvable trigger (already suppressed, so the Zag id is gone from
    // the DOM) stays suppressed rather than flashing back open.
    expect(tooltipAllowed(null)).toBe(false);
  });

  it('allows a tooltip nested INSIDE an open layer', () => {
    const panel = layer();
    const inside = document.createElement('button');
    panel.append(inside);
    expect(tooltipAllowed(inside)).toBe(true);
  });

  it('allows a tooltip whose OWN panel hosts the open layer', () => {
    // An `interactive` tooltip that raises a menu from inside its own card:
    // the layer descends from the tooltip's panel, so it is not a rival.
    const panel = document.createElement('div');
    document.body.append(panel);
    const trigger = document.createElement('button');
    document.body.append(trigger);
    const nestedPanel = document.createElement('div');
    panel.append(nestedPanel);
    release.push(registerLayer(nestedPanel));

    expect(tooltipAllowed(trigger, panel)).toBe(true);
    expect(tooltipAllowed(trigger, null)).toBe(false);
    // The tooltip's panel is not its own layer.
    expect(tooltipAllowed(trigger, nestedPanel)).toBe(false);
  });

  it('allows tooltips again once every layer has unregistered', () => {
    layer();
    const unregisterSecond = registerLayer(document.createElement('div'));
    const outside = document.createElement('button');
    document.body.append(outside);
    expect(tooltipAllowed(outside)).toBe(false);

    unregisterSecond();
    expect(tooltipAllowed(outside)).toBe(false); // first layer still open
    release.pop()?.();
    expect(tooltipAllowed(outside)).toBe(true);
  });
});
