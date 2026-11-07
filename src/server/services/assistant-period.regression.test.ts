import { afterEach, expect, it, vi } from 'vitest';
import { parseAssistantPeriod } from './assistant-period';
const period = (query = '') =>
  parseAssistantPeriod(new URL('https://synthetic.invalid/?' + query), 'America/Lima');
afterEach(() => vi.useRealTimers());
it.each([
  'from=2025-02-29',
  'from=2030-02-30',
  'from=',
  'to=%20',
  'range=all&from=2030-01-01',
  'from=2030-01-02&to=2030-01-01',
])('rejects invalid explicit calendar input: %s', (query) => expect(() => period(query)).toThrow());
it.each([
  ['from=2024-02-29&to=2024-02-29', '2024-02-29T05:00:00.000Z', '2024-03-01T05:00:00.000Z'],
  ['from=2030-01-07', '2030-01-07T05:00:00.000Z', null],
  ['to=2030-01-07', null, '2030-01-08T05:00:00.000Z'],
  ['range=all', null, null],
] as const)('resolves exact local-day boundaries: %s', (query, from, to) =>
  expect(period(query).period).toMatchObject({ from, to }),
);
it('discloses complete fixed-clock absent-filter business window', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2030-01-07T02:00:00Z'));
  expect(period()).toMatchObject({
    period: { from: '2029-01-06T05:00:00.000Z', to: '2030-01-07T05:00:00.000Z' },
    periodSemantics: {
      mode: 'rolling-12-months',
      timezone: 'America/Lima',
      calendarFrom: '2029-01-06',
      calendarTo: '2030-01-06',
    },
  });
});
