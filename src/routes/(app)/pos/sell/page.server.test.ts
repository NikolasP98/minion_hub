import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Spec 039 S2: the till reads `pos` and `scheduling` as separate datasets. */
const h = vi.hoisted(() => ({
  deniedModules: new Set<string>(),
  pos: {
    listSellables: vi.fn(() => Promise.resolve([])),
    listBundleEdges: vi.fn(() => Promise.resolve([])),
    listPaymentsFor: vi.fn(() => Promise.resolve([])),
    listTickets: vi.fn(() => Promise.resolve([])),
    listShifts: vi.fn(() => Promise.resolve([])),
  },
  listResources: vi.fn(() =>
    Promise.resolve([{ id: 'r1', name: 'Chair', active: true, timezone: 'America/Lima' }]),
  ),
  listEventTypes: vi.fn(() =>
    Promise.resolve([{ id: 'e1', title: 'Botox', productId: 'p1', active: true }]),
  ),
}));

vi.mock('$server/auth/dataset-ctx', () => ({
  datasetCtx: (_l: unknown, module: string) =>
    Promise.resolve(
      h.deniedModules.has(module) ? { denied: module, verb: 'view' } : { tenantId: 'org-1' },
    ),
  isDenied: (v: unknown) => !!v && typeof v === 'object' && 'denied' in v,
}));
vi.mock('$server/services/pos.service', () => h.pos);
vi.mock('$server/services/scheduling.service', () => ({
  listResources: h.listResources,
  listEventTypes: h.listEventTypes,
}));
vi.mock('$server/services/user.service', () => ({
  getUserNames: () => Promise.resolve(new Map()),
}));

async function call() {
  const { load } = await import('./+page.server');
  return load({
    locals: { moduleStates: { stock: true, scheduling: true } },
    depends: () => {},
  } as unknown as Parameters<typeof load>[0]);
}

beforeEach(() => {
  h.deniedModules.clear();
  vi.clearAllMocks();
});

describe('/pos/sell +page.server load', () => {
  it('pos denied: the whole page slot is the marker and no POS service runs', async () => {
    h.deniedModules.add('pos');
    const data = await call();
    expect(data).toEqual({ pos: { denied: 'pos', verb: 'view' } });
    for (const fn of Object.values(h.pos)) expect(fn).not.toHaveBeenCalled();
  });

  it('scheduling denied: till data loads, resources/eventTypes carry the marker', async () => {
    h.deniedModules.add('scheduling');
    const { pos } = (await call()) as { pos: Record<string, unknown> };
    expect(h.pos.listSellables).toHaveBeenCalled();
    expect(h.listResources).not.toHaveBeenCalled();
    expect(pos).toMatchObject({
      sellables: [],
      resources: { denied: 'scheduling', verb: 'view' },
      eventTypes: { denied: 'scheduling', verb: 'view' },
    });
  });

  it('all allowed: previous behaviour', async () => {
    const { pos } = (await call()) as { pos: Record<string, unknown> };
    expect(pos).toMatchObject({
      orgTz: 'America/Lima',
      resources: [{ id: 'r1', name: 'Chair' }],
      eventTypes: [{ id: 'e1', title: 'Botox', productId: 'p1', active: true }],
    });
  });
});
