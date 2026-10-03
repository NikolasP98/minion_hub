import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent, RequestHandler } from '@sveltejs/kit';

const boundary = vi.hoisted(() => ({
  rules: [] as Array<Record<string, unknown>>,
  db: vi.fn(),
  context: vi.fn(),
  enabled: vi.fn(),
  bookings: vi.fn(),
  detail: vi.fn(),
  resources: vi.fn(),
  eventTypes: vi.fn(),
  calendar: vi.fn(),
  slots: vi.fn(),
  publicSlots: vi.fn(),
  reminderOrgs: vi.fn(),
  env: { CRON_SECRET: 'disposable-cron-secret' } as Record<string, string>,
}));
vi.mock('$server/db/pg-client', () => ({
  getCoreDb: boundary.db,
  getOrgTransactionDb: boundary.db,
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: boundary.context }));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled: boundary.enabled }));
vi.mock('@minion-stack/cache', () => ({
  cached: (_key: unknown, _options: unknown, load: () => unknown) => load(),
  invalidateTags: vi.fn(),
  keys: { hub: () => 'fixture' },
  tags: { tenantDomain: () => [], global: () => [], entity: () => [] },
}));
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const result = {
        select: () => result,
        eq: () => result,
        in: () => result,
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(
            resolve({
              data: table === 'member_roles' ? [{ role_key: 'fixture' }] : boundary.rules,
              error: null,
            }),
          );
        },
      };
      return result;
    },
  }),
}));
vi.mock('$server/services/scheduling-bookings.service', async (original) => ({
  ...(await original<object>()),
  listBookings: boundary.bookings,
  getBookingDetail: boundary.detail,
}));
vi.mock('$server/services/scheduling.service', async (original) => ({
  ...(await original<object>()),
  listResources: boundary.resources,
  listEventTypes: boundary.eventTypes,
}));
vi.mock('$server/services/calendar-window.service', () => ({
  loadCalendarWindow: boundary.calendar,
}));
vi.mock('$server/services/scheduling-slots.service', () => ({
  getSlotsForEventType: boundary.slots,
}));
vi.mock('$server/services/scheduling-public.service', () => ({
  publicSlots: boundary.publicSlots,
}));
vi.mock('$server/services/reminder-config.service', async (original) => ({
  ...(await original<object>()),
  listEnabledReminderOrgs: boundary.reminderOrgs,
}));
vi.mock('$env/dynamic/private', () => ({ env: boundary.env }));

const routes = import.meta.glob('/src/routes/api/scheduling/**/+server.ts') as Record<
  string,
  () => Promise<{ GET?: RequestHandler }>
>;
const publicPath = '/src/routes/api/scheduling/public/[slug]/slots/+server.ts';
const cronPath = '/src/routes/api/scheduling/reminders/tick/+server.ts';
function exportedMethods(filename: string): Set<string> {
  const file = ts.createSourceFile(
    filename,
    readFileSync(`.${filename}`, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause))
        throw new Error(`Wildcard route exports require explicit policy review: ${filename}`);
      for (const element of statement.exportClause.elements) names.add(element.name.text);
    } else if (
      ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      if (ts.isFunctionDeclaration(statement) && statement.name) names.add(statement.name.text);
      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations)
          if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
    }
  }
  return names;
}
const exportedReads = Object.keys(routes).filter((filename) => {
  const methods = exportedMethods(filename);
  if (methods.has('HEAD'))
    throw new Error(`Explicit HEAD requires its own behavioral policy case: ${filename}`);
  return methods.has('GET');
});
const protectedReads = exportedReads.filter((path) => path !== publicPath && path !== cronPath);
// Import the real handler graph before test clocks start; assertions still run in every test body.
const handlers = new Map(
  await Promise.all(
    exportedReads.map(async (path) => [path, (await routes[path]()).GET!] as const),
  ),
);
const posSlotsHandler = (await import('../../routes/api/pos/appointments/slots/+server')).GET;
const locals = {
  user: { id: 'reader', supabaseId: 'reader', email: 'reader@fixture.test', role: 'user' },
  tenantCtx: { tenantId: 'org-fixture' },
} as App.Locals;
const event = (path: string, overrides: Partial<RequestEvent> = {}): RequestEvent =>
  ({
    locals,
    params: { id: 'booking-fixture', slug: 'public-fixture' },
    url: new URL(`http://localhost${path}?eventTypeId=event-fixture&from=2026-10-01&to=2026-10-02`),
    request: new Request(`http://localhost${path}`),
    ...overrides,
  }) as RequestEvent;
function allow(module: string, actions = ['view']) {
  boundary.rules.push({
    role_key: 'fixture',
    module,
    can_view: actions.includes('view'),
    can_create: actions.includes('create'),
    can_edit: actions.includes('edit'),
    can_delete: false,
    can_export: false,
    can_manage: false,
    if_owner: false,
    field_level: 0,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.rules = [];
  boundary.env.CRON_SECRET = 'disposable-cron-secret';
  boundary.db.mockImplementation(() => {
    throw new Error('Unexpected domain database access');
  });
  boundary.context.mockResolvedValue({ db: {}, tenantId: 'org-fixture' });
  boundary.enabled.mockResolvedValue(true);
  boundary.bookings.mockResolvedValue([{ id: 'booking-fixture' }]);
  boundary.detail.mockResolvedValue({ booking: { id: 'booking-fixture' } });
  boundary.resources.mockResolvedValue([{ timezone: 'America/Lima' }]);
  boundary.eventTypes.mockResolvedValue([]);
  boundary.calendar.mockResolvedValue({ bookings: [], tagOptions: [] });
  boundary.slots.mockResolvedValue({
    resourceIds: ['resource-fixture'],
    slots: [
      {
        start: new Date('2026-10-01T15:00:00Z'),
        end: new Date('2026-10-01T16:00:00Z'),
        resourceIds: ['resource-fixture'],
      },
    ],
  });
  boundary.publicSlots.mockResolvedValue([]);
  boundary.reminderOrgs.mockResolvedValue([]);
});

describe('scheduling read authority inventory', () => {
  it('keeps exact public/scheduler exceptions and discovers the protected reads', () => {
    expect(exportedReads).toContain(publicPath);
    expect(exportedReads).toContain(cronPath);
    expect(
      protectedReads.map((path) => path.replace('/src/routes/api/scheduling/', '')).sort(),
    ).toEqual(
      [
        'bookings/+server.ts',
        'bookings/[id]/+server.ts',
        'calendar/+server.ts',
        'event-kinds/+server.ts',
        'event-types/+server.ts',
        'event-types/[id]/+server.ts',
        'hr/employees/+server.ts',
        'hr/holidays/+server.ts',
        'hr/leave-allocations/+server.ts',
        'hr/leave-requests/+server.ts',
        'hr/leave-types/+server.ts',
        'hr/settings/+server.ts',
        'links/+server.ts',
        'reminders/config/+server.ts',
        'resources/+server.ts',
        'resources/[id]/availability/+server.ts',
        'slots/+server.ts',
      ].sort(),
    );
  });

  for (const filename of protectedReads) {
    it(`denies no-view and anonymous readers before domain access: ${filename}`, async () => {
      const handler = handlers.get(filename)!;
      await expect(handler(event('/api/scheduling/fixture'))).rejects.toMatchObject({
        status: 403,
      });
      await expect(handler(event('/api/scheduling/fixture', { locals: {} }))).rejects.toMatchObject(
        { status: 401 },
      );
      expect(boundary.context).not.toHaveBeenCalled();
      expect(boundary.db).not.toHaveBeenCalled();
      expect(boundary.bookings).not.toHaveBeenCalled();
      expect(boundary.detail).not.toHaveBeenCalled();
      expect(boundary.slots).not.toHaveBeenCalled();
    });
  }

  for (const suffix of ['bookings', 'bookings/[id]', 'calendar']) {
    it(`preserves authorized ${suffix} reads`, async () => {
      allow('scheduling');
      const handler = handlers.get(`/src/routes/api/scheduling/${suffix}/+server.ts`)!;
      const response = await handler(event(`/api/scheduling/${suffix}`));
      expect(response.status).toBe(200);
      expect(boundary.context).toHaveBeenCalledOnce();
      expect(boundary.enabled).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'org-fixture' }),
        'scheduling',
      );
    });
  }

  it('retains the anonymous public-slug read', async () => {
    const handler = handlers.get(publicPath)!;
    expect(
      (await handler(event('/api/scheduling/public/public-fixture/slots', { locals: {} }))).status,
    ).toBe(200);
    expect(boundary.publicSlots).toHaveBeenCalledWith(
      'public-fixture',
      'event-fixture',
      expect.any(Date),
      expect.any(Date),
    );
    expect(boundary.context).not.toHaveBeenCalled();
  });

  it('retains exact scheduler secret authentication', async () => {
    const handler = handlers.get(cronPath)!;
    await expect(
      handler(event('/api/scheduling/reminders/tick', { locals: {} })),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      handler(
        event('/api/scheduling/reminders/tick', {
          request: new Request('http://localhost', {
            headers: { authorization: 'Bearer wrong-secret' },
          }),
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
    delete boundary.env.CRON_SECRET;
    await expect(
      handler(
        event('/api/scheduling/reminders/tick', {
          request: new Request('http://localhost', {
            headers: { authorization: 'Bearer disposable-cron-secret' },
          }),
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(boundary.reminderOrgs).not.toHaveBeenCalled();
    boundary.env.CRON_SECRET = 'disposable-cron-secret';
    const response = await handler(
      event('/api/scheduling/reminders/tick', {
        locals: {},
        request: new Request('http://localhost', {
          headers: { authorization: 'Bearer disposable-cron-secret' },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(boundary.reminderOrgs).toHaveBeenCalledOnce();
  });
});

describe('POS-only slot compatibility', () => {
  const load = async () => posSlotsHandler;
  for (const action of ['create', 'edit']) {
    it(`allows pos:view plus ${action} without scheduling authority`, async () => {
      allow('pos', ['view', action]);
      const response = await (await load())(event('/api/pos/appointments/slots'));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        resourceIds: ['resource-fixture'],
        slots: [
          {
            start: '2026-10-01T15:00:00.000Z',
            end: '2026-10-01T16:00:00.000Z',
            resourceIds: ['resource-fixture'],
          },
        ],
      });
      expect(boundary.slots).toHaveBeenCalledOnce();
      expect(boundary.enabled.mock.calls.map((call) => call[1])).toEqual(['pos', 'scheduling']);
    });
  }
  for (const actions of [[], ['view'], ['create'], ['edit'], ['create', 'edit']]) {
    it(`denies incomplete POS authority ${JSON.stringify(actions)} before domain reads`, async () => {
      allow('pos', actions);
      await expect((await load())(event('/api/pos/appointments/slots'))).rejects.toMatchObject({
        status: 403,
      });
      expect(boundary.context).not.toHaveBeenCalled();
      expect(boundary.slots).not.toHaveBeenCalled();
    });
  }
  for (const module of ['pos', 'scheduling']) {
    it(`denies disabled ${module} before slot calculation`, async () => {
      allow('pos', ['view', 'create']);
      boundary.enabled.mockImplementation((_ctx, name) => name !== module);
      await expect((await load())(event('/api/pos/appointments/slots'))).rejects.toMatchObject({
        status: 403,
      });
      expect(boundary.slots).not.toHaveBeenCalled();
    });
  }
  it('rejects anonymous callers even with a query-string permission claim', async () => {
    await expect(
      (await load())(event('/api/pos/appointments/slots?role=admin', { locals: {} })),
    ).rejects.toMatchObject({ status: 401 });
    expect(boundary.context).not.toHaveBeenCalled();
    expect(boundary.slots).not.toHaveBeenCalled();
  });
  it('preserves the platform-admin bypass with both modules checked', async () => {
    const response = await (
      await load()
    )(
      event('/api/pos/appointments/slots', {
        locals: { ...locals, user: { ...locals.user!, role: 'admin' } },
      }),
    );
    expect(response.status).toBe(200);
    expect(boundary.enabled).toHaveBeenCalledTimes(2);
  });
  for (const query of [
    'from=invalid&to=2026-10-02',
    'from=2026-10-02&to=2026-10-01',
    'from=2026-10-01&to=2026-10-01',
    'from=2026-01-01&to=2026-12-31',
  ]) {
    it(`bounds both wrappers identically: ${query}`, async () => {
      allow('pos', ['view', 'edit']);
      allow('scheduling');
      const scheduling = handlers.get('/src/routes/api/scheduling/slots/+server.ts')!;
      for (const handler of [await load(), scheduling]) {
        await expect(
          handler(
            event('/api/slots', {
              url: new URL(`http://localhost?eventTypeId=event-fixture&${query}`),
            }),
          ),
        ).rejects.toMatchObject({ status: 400 });
      }
      expect(boundary.slots).not.toHaveBeenCalled();
    });
  }
  it('keeps grouped service lookup and the scheduling HEAD fallback intact', async () => {
    allow('scheduling');
    const handler = handlers.get('/src/routes/api/scheduling/slots/+server.ts')!;
    const response = await handler(
      event('/api/scheduling/slots', {
        url: new URL(
          'http://localhost?eventTypeId=e1&withEventTypeIds=e2,e3&from=2026-10-01&to=2026-10-02',
        ),
        request: new Request('http://localhost/api/scheduling/slots', { method: 'HEAD' }),
      }),
    );
    expect(response.status).toBe(200);
    expect(boundary.slots).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-fixture' }),
      'e1',
      expect.any(Date),
      expect.any(Date),
      { withEventTypeIds: ['e2', 'e3'] },
    );
  });
});
