// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { portal } from './layer';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('portal layer action', () => {
  it('moves content to a target and restores its source position', () => {
    const origin = document.createElement('div');
    const target = document.createElement('div');
    const node = document.createElement('div');
    document.body.append(origin, target);
    origin.append(node);
    const action = portal(node, { target });
    expect(target.contains(node)).toBe(true);
    action.destroy();
    expect(origin.contains(node)).toBe(true);
  });

  it('fails loudly when a requested portal target does not exist', () => {
    const node = document.createElement('div');
    document.body.append(node);
    expect(() => portal(node, { target: '#missing-overlay-root' })).toThrow(/not found/i);
  });
});
