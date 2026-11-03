import { beforeEach, describe, expect, it, vi } from 'vitest';

// Spec 043 T039: proactive AI ticks skip and count an org without `ai.proactive`; reminders still send
// plain and confirm by keyword.
const h = vi.hoisted(() => ({
  allows: vi.fn(async (_org: string, _f: string, _s: string) => true),
  execute: vi.fn(),
  moduleEnabled: vi.fn(async () => true),
  work: vi.fn(),
  config: vi.fn(),
  infer: vi.fn(),
  setStatus: vi.fn(),
  txResults: [] as unknown[],
  compose: vi.fn(async () => 'text'),
}));
vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability: async () => {} }));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: async () => ({ db: {}, tenantId: 'base-org' }),
}));

vi.mock('$env/dynamic/private', () => ({ env: { CRON_SECRET: 'sekret' } }));
vi.mock('$server/services/entitlements.service', async (orig) => ({
  ...(await orig<object>()),
  orgAllows: h.allows,
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({ execute: h.execute }) }));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled: h.moduleEnabled }));
vi.mock('$server/services/crm-conversation-analysis.service', () => ({
  analyzeConversationsTick: async () => (
    h.work(),
    { processed: 1, dirty: 0, analyzed: 1, failed: 0, remaining: 0 }
  ),
}));
vi.mock('$server/services/crm-conversation-vectors.service', () => ({
  vectorizeTick: async () => (h.work(), { processed: 1, dirty: 0, remaining: 0 }),
}));
vi.mock('$server/services/crm-relationship-inference.service', () => ({
  WALL_CLOCK_BUDGET_MS: 50_000,
  GLOBAL_CAP: 100,
  relationshipInferenceTick: async () => (
    h.work(),
    { claimed: 1, processed: 1, skippedPinned: 0, skippedCollision: 0, unknown: 0, failed: 0 }
  ),
}));
vi.mock('$server/services/brain-corpus-jobs.service', () => ({
  ensureWhatsAppReconcileJob: async () => (h.work(), { jobId: 'j', created: true }),
  advanceBrainCorpusJobNow: async () => {},
}));
vi.mock('$server/services/brain-business-corpus-jobs.service', () => ({
  ensureBusinessReconcileJob: async () => ({ jobId: 'b', created: true }),
  advanceBusinessCorpusJobNow: async () => {},
}));
vi.mock('$server/services/reminder-config.service', () => ({
  getReminderConfig: h.config,
  effectiveChannels: () => ['whatsapp'],
}));
vi.mock('$server/services/reminder-compose', () => ({
  composeReminder: h.compose,
  sampleContext: (c: unknown) => c,
  inferConfirmationReply: h.infer,
}));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (_ctx: unknown, fn: (tx: unknown) => unknown) =>
    fn({ execute: async () => h.txResults.shift() ?? [] }),
}));
vi.mock('$server/services/scheduling-bookings.service', () => ({ setBookingStatus: h.setStatus }));

const req = (path: string) => ({
  request: new Request(`http://localhost${path}`, { headers: { authorization: 'Bearer sekret' } }),
  url: new URL(`http://localhost${path}`),
});

const TICKS = [
  '/src/routes/api/brains/reconcile/tick/+server.ts',
  '/src/routes/api/crm/conversations/analyze/tick/+server.ts',
  '/src/routes/api/crm/conversations/vectorize/tick/+server.ts',
  '/src/routes/api/crm/relationship/tick/+server.ts',
];
const modules = import.meta.glob('/src/routes/api/**/tick/+server.ts');

beforeEach(() => {
  vi.clearAllMocks();
  h.execute.mockResolvedValue([{ id: 'base-org' }, { id: 'premium-org' }]);
  h.allows.mockImplementation(async (org) => org !== 'base-org');
});

describe('proactive AI ticks', () => {
  it.each(TICKS)('%s skips and counts a Base org', async (file) => {
    const { GET } = (await modules[file]()) as {
      GET: (e: unknown) => Promise<Response>;
    };
    const body = await (await GET(req('/tick'))).json();
    expect(body.skippedByEntitlement).toBe(1);
    expect(h.work).toHaveBeenCalledTimes(1); // only the premium org did work
    expect(h.allows).toHaveBeenCalledWith('base-org', 'ai.proactive', expect.any(String));
  });

  it.each(TICKS)('%s keeps its response shape when nothing is skipped', async (file) => {
    h.allows.mockResolvedValue(true);
    const { GET } = (await modules[file]()) as {
      GET: (e: unknown) => Promise<Response>;
    };
    const body = await (await GET(req('/tick'))).json();
    expect(body).not.toHaveProperty('skippedByEntitlement');
    expect(h.work).toHaveBeenCalledTimes(2);
  });
});

describe('reminders for an org without ai.proactive', () => {
  const ctx = { db: {} as never, tenantId: 'base-org' };
  it('confirms by keyword instead of model inference', async () => {
    h.allows.mockResolvedValue(false);
    h.config.mockResolvedValue({
      enabled: true,
      inferConfirmation: true,
      personalize: true,
      locale: 'es',
    });
    h.txResults = [
      [
        {
          id: 'b1',
          start_time: new Date(Date.now() + 86_400_000).toISOString(),
          attendee_phone: '+51999888777',
          attendee_name: 'Ana',
          crm_contact_id: null,
          service_title: 'Botox',
          timezone: 'America/Lima',
          confirm_sent_at: new Date().toISOString(),
        },
      ],
      [{ content: 'si' }],
    ];
    const { scanConfirmationReplies } = await import('$server/services/reminders.service');
    const r = await scanConfirmationReplies(ctx, new Date());
    expect(h.infer).not.toHaveBeenCalled();
    expect(r.confirmed).toBe(1);
  });

  it('keeps model inference for an org that has the feature', async () => {
    h.allows.mockResolvedValue(true);
    h.infer.mockResolvedValue('unclear');
    h.config.mockResolvedValue({
      enabled: true,
      inferConfirmation: true,
      personalize: true,
      locale: 'es',
    });
    h.txResults = [
      [
        {
          id: 'b1',
          start_time: new Date(Date.now() + 86_400_000).toISOString(),
          attendee_phone: '+51999888777',
          attendee_name: 'Ana',
          crm_contact_id: null,
          service_title: 'Botox',
          timezone: 'America/Lima',
          confirm_sent_at: new Date().toISOString(),
        },
      ],
      [{ content: 'si' }],
    ];
    const { scanConfirmationReplies } = await import('$server/services/reminders.service');
    await scanConfirmationReplies(ctx, new Date());
    expect(h.infer).toHaveBeenCalledOnce();
  });
});

describe('reminders preview', () => {
  it('forces the plain template for an org without ai.proactive', async () => {
    const { POST } = await import('../../routes/api/scheduling/reminders/preview/+server');
    const call = () =>
      POST({
        locals: {},
        request: new Request('http://hub.test', {
          method: 'POST',
          body: JSON.stringify({ personalize: true }),
          headers: { 'content-type': 'application/json' },
        }),
      } as never);
    h.allows.mockResolvedValue(false);
    await call();
    expect(h.compose).toHaveBeenLastCalledWith(expect.anything(), false);
    h.allows.mockResolvedValue(true);
    await call();
    expect(h.compose).toHaveBeenLastCalledWith(expect.anything(), true);
  });
});
