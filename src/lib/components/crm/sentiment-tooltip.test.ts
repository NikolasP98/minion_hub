// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { formatSentimentTooltip } from './sentiment-tooltip';

describe('sentiment tooltip display', () => {
  it.each(['12 samples', '12 muestras'])(
    'renders date, score and localized count as valid text: %s',
    (label) => {
      const root = document.createElement('div');
      root.innerHTML = formatSentimentTooltip('Sep 9', 0.25, label);
      expect(root.children).toHaveLength(3);
      expect(Array.from(root.children, (node) => node.textContent)).toEqual([
        'Sep 9',
        '+0.25',
        label,
      ]);
      expect(root.lastElementChild?.getAttribute('style')).toBe(
        'opacity:0.7;font-size:var(--font-size-body)',
      );
    },
  );

  it('preserves negative and zero scores without an extra plus sign', () => {
    for (const [score, expected] of [
      [-0.5, '-0.50'],
      [0, '0.00'],
    ] as const) {
      const root = document.createElement('div');
      root.innerHTML = formatSentimentTooltip('Sep 9', score, '0 samples');
      expect(root.children[1]?.textContent).toBe(expected);
    }
  });

  it('does not treat localized display text as HTML', () => {
    const root = document.createElement('div');
    root.innerHTML = formatSentimentTooltip(
      '<img src=x onerror=alert(1)>',
      0,
      'A & B <b>samples</b>',
    );
    expect(root.querySelector('img, b')).toBeNull();
    expect(root.children[0]?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(root.children[2]?.textContent).toBe('A & B <b>samples</b>');
  });
});
