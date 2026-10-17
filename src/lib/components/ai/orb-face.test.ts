// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import AiOrbFace from './AiOrbFace.svelte';
import {
  EXPRESSIONS,
  chatFaceState,
  eyeGeometry,
  gazeFor,
  resolveExpression,
  voiceFaceState,
} from './orb-face';

afterEach(cleanup);

describe('orb face geometry', () => {
  it('keeps an eye centred as it closes and rounds it into a lozenge', () => {
    const open = eyeGeometry(EXPRESSIONS.neutral.left, -1);
    const shut = eyeGeometry(EXPRESSIONS.content.left, -1);
    expect(shut.cy).toBeCloseTo(open.cy + 2, 5); // content sits 2 lower, otherwise same centre
    expect(shut.rx).toBe(shut.height / 2);
    expect(open.x).toBeLessThan(50);
    expect(eyeGeometry(EXPRESSIONS.neutral.right, 1).x).toBeGreaterThan(50);
  });

  it('caps the gaze at its range and points it at the cursor', () => {
    const far = gazeFor(1000, 0);
    expect(far.x).toBeCloseTo(5.5, 5);
    expect(far.y).toBeCloseTo(0, 5);
    expect(Math.hypot(gazeFor(30, 40).x, gazeFor(30, 40).y)).toBeCloseTo((50 / 220) * 5.5, 5);
  });

  it('maps call and chat state onto expressions', () => {
    expect(voiceFaceState('speaking')).toBe('streaming');
    expect(voiceFaceState('listening')).toBe('listening');
    expect(chatFaceState({ sending: true, stream: null })).toBe('thinking');
    expect(chatFaceState({ stream: '' })).toBe('thinking');
    expect(chatFaceState({ stream: 'hi' })).toBe('streaming');
    expect(chatFaceState({ lastError: 'x', stream: 'hi' })).toBe('error');
    expect(chatFaceState(null)).toBe('idle');
    expect(resolveExpression('thinking')).toBe(EXPRESSIONS.doubtful);
    expect(resolveExpression('idle', 'wink')).toBe(EXPRESSIONS.wink);
  });
});

describe('AiOrbFace', () => {
  it('draws two eyes normally and two spirals when broken; decorative unless labelled', async () => {
    const { container, rerender } = render(AiOrbFace, { props: { diameter: 40 } });
    expect(container.querySelectorAll('rect.eye')).toHaveLength(2);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    await rerender({ diameter: 40, status: 'error', 'aria-label': 'Assistant' });
    expect(container.querySelectorAll('rect.eye')).toHaveLength(0);
    expect(container.querySelectorAll('path.dizzy')).toHaveLength(2);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Assistant');
  });

  it('squints while streaming (shorter eyes than at rest)', async () => {
    const { container, rerender } = render(AiOrbFace, { props: { diameter: 40 } });
    const h = () =>
      parseFloat((container.querySelector('rect.eye') as SVGRectElement).style.height);
    const rest = h();
    await rerender({ diameter: 40, status: 'streaming' });
    expect(h()).toBeLessThan(rest);
  });
});
