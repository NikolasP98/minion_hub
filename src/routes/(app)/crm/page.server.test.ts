import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireCoreCtx: vi.fn(),
  ownerFilter: vi.fn(),
  getCrmDashboardStats: vi.fn(),
  getFinSettings: vi.fn(),
}));

vi.mock('$server/auth/core-ctx', () => ({
  requireCoreCtx: (locals: unknown) => mocks.requireCoreCtx(locals),
}));
vi.mock('$server/services/rbac.service', () => ({
  ownerFilter: (locals: unknown, module: unknown) => mocks.ownerFilter(locals, module),
}));
vi.mock('$server/services/crm-contacts.service', () => ({
  getCrmDashboardStats: (...args: unknown[]) => mocks.getCrmDashboardStats(...args),
}));
vi.mock('$server/services/finance.service', () => ({
  getFinSettings: (ctx: unknown) => mocks.getFinSettings(ctx),
}));

const { load } = await import('./+page.server');

const CTX = { db: {}, tenantId: 'org-1' };
const DAY_MS = 86_400_000;

function event(range: string) {
  return {
    locals: {},
    url: new URL(`http://localhost/crm?range=${range}`),
    depends: vi.fn(),
    parent: vi.fn(async () => ({ activeOrgKind: 'business' })),
  } as never;
}

describe('CRM dashboard organization-date bounds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T16:00:00.000Z'));
    mocks.requireCoreCtx.mockResolvedValue(CTX);
    mocks.ownerFilter.mockResolvedValue(null);
    mocks.getFinSettings.mockResolvedValue({ timezone: 'America/New_York' });
    mocks.getCrmDashboardStats.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it.each([
    ['7d', 7, '2026-03-04', '2026-03-04T05:00:00.000Z'],
    ['30d', 30, '2026-02-09', '2026-02-09T05:00:00.000Z'],
    ['90d', 90, '2025-12-11', '2025-12-11T05:00:00.000Z'],
    ['365d', 365, '2025-03-11', '2025-03-11T04:00:00.000Z'],
  ] as const)(
    'resolves %s as exactly %i inclusive civil days in fin_settings.timezone',
    async (range, days, expectedFrom, expectedFromInstant) => {
      const data = (await load(event(range))) as {
        from: string;
        to: string;
        timeZone: string;
        streamed: { stats: Promise<unknown> };
      };
      await data.streamed.stats;

      expect(data).toMatchObject({
        from: expectedFrom,
        to: '2026-03-10',
        timeZone: 'America/New_York',
      });
      expect(
        (Date.parse(`${data.to}T00:00:00.000Z`) -
          Date.parse(`${data.from}T00:00:00.000Z`)) /
          DAY_MS +
          1,
      ).toBe(days);

      const options = mocks.getCrmDashboardStats.mock.calls.at(-1)?.[1] as {
        from: Date;
        to: Date;
      };
      expect(options.from.toISOString()).toBe(expectedFromInstant);
      // Mar 10 ends in EDT. The explicit organization zone, rather than the
      // process/browser zone, owns the half-open-next-midnight conversion.
      expect(options.to.toISOString()).toBe('2026-03-11T03:59:59.999Z');
    },
  );
});
