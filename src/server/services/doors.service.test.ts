import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createMockDb } from '$server/test-utils/mock-db';

const coreDb = vi.hoisted(() => ({ current: null as unknown }));
const moduleOn = vi.hoisted(() => ({ crm: true, scheduling: true }) as Record<string, boolean>);

vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => coreDb.current }));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (ctx: { db: unknown }, fn: (tx: unknown) => unknown) => fn(ctx.db),
}));
vi.mock('./modules.service', () => ({
  isModuleEnabled: async (_ctx: unknown, id: string) => moduleOn[id] ?? true,
}));
vi.mock('./inbox/daily-feed.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./inbox/daily-feed.service')>()),
  resolveOrgTimezone: async () => 'America/Lima',
}));
vi.mock('$lib/doors/kinds', () => ({
  getDoorKind: (kind: string) =>
    kind === 'form'
      ? {
          kind: 'form',
          configSchema: z.object({ fields: z.array(z.string()).min(1) }).strict(),
          defaultConfig: { fields: ['name'] },
        }
      : undefined,
}));

import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  DoorError,
  bumpDoorStat,
  createDoor,
  isLikelyBot,
  listDoorsWithFunnel,
  resolveDoorRange,
  resolvePublicDoor,
  updateDoor,
} from './doors.service';

const ID = '11111111-2222-4333-8444-555555555555';
const LINK = '99999999-2222-4333-8444-555555555555';
const T = new Date('2026-10-25T10:00:00Z');
const doorRow = (over: Record<string, unknown> = {}) => ({
  id: ID,
  orgId: 'org-1',
  kind: 'form',
  slug: 'qa-intake',
  title: 'Ficha',
  description: null,
  active: true,
  config: { fields: ['name'] },
  followUp: null,
  createdBy: null,
  createdAt: T,
  updatedAt: T,
  ...over,
});

beforeEach(() => {
  moduleOn.crm = true;
  moduleOn.scheduling = true;
});

describe('isLikelyBot', () => {
  it('flags empty agents, crawlers and link previews but not browsers', () => {
    expect(isLikelyBot(null)).toBe(true);
    expect(isLikelyBot('  ')).toBe(true);
    expect(isLikelyBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isLikelyBot('WhatsApp/2.23.20.0 A')).toBe(true);
    expect(isLikelyBot('facebookexternalhit/1.1')).toBe(true);
    expect(isLikelyBot('curl/8.4.0')).toBe(true);
    expect(
      isLikelyBot(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Mobile Safari',
      ),
    ).toBe(false);
  });
});

describe('resolvePublicDoor', () => {
  it('rejects malformed slugs without touching the database', async () => {
    const { db } = createMockDb();
    coreDb.current = db;
    expect(await resolvePublicDoor('../x')).toBeNull();
    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns null for unknown/off slugs and when the CRM module is off', async () => {
    const { db, resolveSequence } = createMockDb();
    coreDb.current = db;
    resolveSequence([[]]);
    expect(await resolvePublicDoor('qa-intake')).toBeNull();

    resolveSequence([[{ id: ID, orgId: 'org-1' }]]);
    moduleOn.crm = false;
    expect(await resolvePublicDoor('qa-intake')).toBeNull();
  });

  it('resolves the org from the slug and re-reads the door under that org', async () => {
    const { db, resolveSequence } = createMockDb();
    coreDb.current = db;
    resolveSequence([[{ id: ID, orgId: 'org-1' }], [doorRow()]]);
    const out = await resolvePublicDoor('qa-intake');
    expect(out?.ctx.tenantId).toBe('org-1');
    expect(out?.door).toMatchObject({ id: ID, slug: 'qa-intake', createdAt: T.toISOString() });
  });
});

const dialect = new PgDialect();
/** 23:30 on 2026-10-25 in Lima (UTC-5) = 04:30Z on the 26th. */
const LIMA_LATE = new Date('2026-10-26T04:30:00Z');

describe('bumpDoorStat', () => {
  it('counts a 23:30 Lima visit on the Lima day, not the UTC one', async () => {
    const execute = vi.fn(async () => []);
    await bumpDoorStat(
      { db: { execute }, tenantId: 'org-1' } as never,
      `door:${ID}`,
      'views',
      LIMA_LATE,
    );
    const { params } = dialect.sqlToQuery((execute.mock.calls[0] as unknown[])[0] as SQL);
    expect(params).toContain('2026-10-25');
    expect(params).not.toContain('2026-10-26');
  });

  it('never throws', async () => {
    const db = { execute: vi.fn().mockRejectedValue(new Error('down')) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      bumpDoorStat({ db, tenantId: 'org-1' } as never, `door:${ID}`, 'views'),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('createDoor', () => {
  it('refuses an unregistered kind', async () => {
    const { db } = createMockDb();
    await expect(
      createDoor({ db, tenantId: 'org-1' } as never, { kind: 'faq', slug: 'abc', title: 'x' }),
    ).rejects.toMatchObject({ code: 'unknown_kind', status: 400 });
  });

  it('creates OFF with the default config and maps a unique violation to 409 slug_taken', async () => {
    const values = vi.fn(() => ({ returning: async () => [doorRow({ active: false })] }));
    const ctx = { db: { insert: () => ({ values }) }, tenantId: 'org-1' } as never;
    const row = await createDoor(ctx, {
      kind: 'form',
      slug: 'qa-intake',
      title: 'Ficha',
      createdBy: 'local',
    });
    expect(row.active).toBe(false);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ active: false, config: { fields: ['name'] }, createdBy: null }),
    );

    const failing = {
      insert: () => ({
        values: () => ({
          returning: async () => {
            throw Object.assign(new Error('dup'), { cause: { code: '23505' } });
          },
        }),
      }),
    };
    await expect(
      createDoor({ db: failing, tenantId: 'org-1' } as never, {
        kind: 'form',
        slug: 'qa-intake',
        title: 'x',
      }),
    ).rejects.toMatchObject({ code: 'slug_taken', status: 409 });
  });
});

describe('updateDoor', () => {
  it('returns null for a door of another org / unknown id', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);
    expect(await updateDoor({ db, tenantId: 'org-1' } as never, ID, { active: true })).toBeNull();
    expect(
      await updateDoor({ db, tenantId: 'org-1' } as never, 'not-a-uuid', { active: true }),
    ).toBeNull();
  });

  it('validates config with the kind schema and reports zod issues', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[doorRow()]]);
    const err = await updateDoor({ db, tenantId: 'org-1' } as never, ID, {
      config: { fields: [], extra: 1 },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(DoorError);
    expect(err).toMatchObject({ code: 'invalid_config', status: 400 });
    expect(Array.isArray(err.issues)).toBe(true);
  });
});

describe('resolveDoorRange', () => {
  it('ends the default 30 days on the org-local today', () => {
    expect(resolveDoorRange(new URLSearchParams(), 'America/Lima', LIMA_LATE)).toEqual({
      from: '2026-09-26',
      to: '2026-10-25',
      days: 30,
    });
    expect(resolveDoorRange(new URLSearchParams('days=7'), 'UTC', LIMA_LATE).to).toBe('2026-10-26');
  });
});

describe('listDoorsWithFunnel', () => {
  it('windows new contacts by the org-local days', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], []]);
    const execute = vi.fn().mockResolvedValue([]);
    (db as unknown as { execute: unknown }).execute = execute;
    await listDoorsWithFunnel(
      { db, tenantId: 'org-1' } as never,
      { from: '2026-10-25', to: '2026-10-25' },
      'America/Lima',
    );
    const { params } = dialect.sqlToQuery((execute.mock.calls[1] as unknown[])[0] as SQL);
    expect(params).toEqual(
      expect.arrayContaining(['2026-10-25T05:00:00.000Z', '2026-10-26T05:00:00.000Z']),
    );
  });

  it('rejects malformed ranges', async () => {
    const { db } = createMockDb();
    await expect(
      listDoorsWithFunnel(
        { db, tenantId: 'org-1' } as never,
        { from: 'x', to: '2026-10-25' },
        'America/Lima',
      ),
    ).rejects.toMatchObject({ code: 'invalid_range' });
  });

  it('merges grouped stats and contact counts onto links and doors', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [doorRow({ active: false })],
      [
        {
          id: LINK,
          slug: 'qa-door-book',
          title: 'Consulta',
          description: null,
          eventTypeIds: ['e1'],
          resourceId: null,
          active: true,
          expiresAt: null,
        },
      ],
    ]);
    (db as unknown as { execute: unknown }).execute = vi
      .fn()
      .mockResolvedValueOnce([
        { door_key: `book:${LINK}`, views: 3, submissions: 1, clicks: 0 },
        { door_key: `door:${ID}`, views: 5, submissions: 2, clicks: 4 },
      ])
      .mockResolvedValueOnce([{ door_key: `door:${ID}`, contacts: 2, customers: 1 }]);
    const rows = await listDoorsWithFunnel(
      { db, tenantId: 'org-1' } as never,
      {
        from: '2026-09-26',
        to: '2026-10-25',
      },
      'America/Lima',
    );
    expect(rows).toEqual([
      expect.objectContaining({
        key: `book:${LINK}`,
        kind: 'book',
        views: 3,
        submissions: 1,
        contacts: 0,
        customers: 0,
        link: { description: null, eventTypeIds: ['e1'], resourceId: null, expiresAt: null },
      }),
      expect.objectContaining({
        key: `door:${ID}`,
        kind: 'form',
        active: false,
        views: 5,
        submissions: 2,
        clicks: 4,
        contacts: 2,
        customers: 1,
      }),
    ]);
  });

  it('omits booking links when scheduling is off', async () => {
    moduleOn.scheduling = false;
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[doorRow()]]);
    (db as unknown as { execute: unknown }).execute = vi.fn().mockResolvedValue([]);
    const rows = await listDoorsWithFunnel(
      { db, tenantId: 'org-1' } as never,
      {
        from: '2026-10-25',
        to: '2026-10-25',
      },
      'America/Lima',
    );
    expect(rows.map((r) => r.kind)).toEqual(['form']);
  });
});
