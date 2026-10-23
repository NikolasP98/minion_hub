import type { PulseProposalView } from '$server/services/pulse.service';
import type { PulseReceipt } from '$server/services/pulse-dispatch.store';
export const page = {
  url: new URL('http://127.0.0.1:18903/pulse.html'),
  params: {},
  route: { id: '/(app)/notifications' },
  status: 200,
  error: null,
  form: null,
  state: {},
  data: {
    user: { id: 'pulse-owner', role: 'admin' },
    activeOrgId: 'pulse-org',
    activeOrgKind: 'personal',
    permissions: { permissions: ['pulse:view', 'pulse:edit', 'users:manage'] },
  },
};
export const navigating = null;
export const updated = { current: false, check: async () => false };
let serverRevision = 2;
let decision = 'pending';
let receipt: PulseReceipt | undefined;
let failInvalidation = false;
let failWrite = false;
let unknownWrite = false;
let project: (() => void) | undefined;
let scopeSwitch: (() => void) | undefined;
type ClientState = {
  pendingCount: number;
  itemCount: number;
  receiptState: string | null;
  error: string | null;
  busy: boolean;
};
let clientState: (() => ClientState) | undefined;
export function bindClientState(callback: () => ClientState) {
  clientState = callback;
}
export function bindScopeSwitch(callback: () => void) {
  scopeSwitch = callback;
}
const requests: { method: string; path: string; body: Record<string, unknown> | null }[] = [];
const unexpected: string[] = [];
export function proposal(revision = serverRevision): PulseProposalView {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    orgId: 'pulse-org',
    createdAt: new Date('2026-10-23T00:00:00Z'),
    source: 'fixture',
    kind: 'create_event',
    title: 'Pulse reviewed calendar action',
    summary: 'Only this owner can review this action.',
    payload: {
      args: { title: 'Review', start: '2030-01-01T09:00:00Z', end: '2030-01-01T10:00:00Z' },
    },
    status: decision,
    revision,
    ownerProfileId: 'pulse-owner',
    decidedAt: null,
  };
}
export function bindProjection(callback: () => void) {
  project = callback;
}
export const invalidate = async () => {
  if (failInvalidation) throw new Error('Synthetic projection read failed');
  project?.();
};
export const invalidateAll = invalidate;
export const goto = async () => {};
export const afterNavigate = () => {};
export const beforeNavigate = () => {};
export const onNavigate = () => {};
export const preloadData = async () => {};
export const preloadCode = async () => {};
export const pushState = () => {};
export const replaceState = () => {};
export const disableScrollHandling = () => {};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
export function installPulseTransport() {
  const query = new URLSearchParams(location.search);
  let denied = query.has('other-owner');
  let holdReceipt = false;
  let heldReceipt = false;
  let releaseReceipt: (() => void) | undefined;
  let scopeSwitchAt: number | null = null;
  let heldProjection = 0;
  const projectionPaths = new Set<string>();
  const releaseProjection: (() => void)[] = [];
  if (!query.has('stale')) serverRevision = 1;
  failInvalidation = query.has('refresh-fail');
  failWrite = query.has('write-fail');
  unknownWrite = query.has('unknown');
  globalThis.fetch = async (resource, options) => {
    const request = resource instanceof Request ? resource : undefined;
    const path = new URL(request?.url ?? String(resource), location.origin).pathname;
    const method = options?.method ?? request?.method ?? 'GET';
    const body =
      typeof options?.body === 'string'
        ? (JSON.parse(options.body) as Record<string, unknown>)
        : null;
    requests.push({ method, path, body });
    if (method === 'GET' && ['/api/pulse/count', '/api/pulse/proposals'].includes(path)) {
      const response = json(
        path.endsWith('/count')
          ? { count: !denied && decision === 'pending' ? 1 : 0 }
          : { proposals: !denied && decision === 'pending' ? [proposal()] : [] },
      );
      if (projectionPaths.delete(path)) {
        heldProjection += 1;
        return new Promise<Response>((resolve) => {
          releaseProjection.push(() => {
            heldProjection -= 1;
            resolve(response);
          });
        });
      }
      return response;
    }
    if (path.endsWith('/receipt') && method === 'GET' && denied)
      return json({ message: 'Not found' }, 404);
    if (path.endsWith('/receipt') && method === 'GET' && holdReceipt) {
      holdReceipt = false;
      heldReceipt = true;
      const frozen = structuredClone(
        receipt ?? {
          proposalId: proposal().id,
          revision: serverRevision,
          decision,
          decidedAt: null,
        },
      );
      return new Promise<Response>((resolve) => {
        releaseReceipt = () => {
          heldReceipt = false;
          resolve(json(frozen));
        };
      });
    }
    if (path.endsWith('/receipt') && method === 'GET')
      return json(
        receipt ?? {
          proposalId: proposal().id,
          revision: serverRevision,
          decision,
          decidedAt: null,
        },
      );
    if (
      path === `/api/pulse/proposals/${proposal().id}` &&
      (method === 'POST' || method === 'PATCH')
    ) {
      if (failWrite) return json({ message: 'Synthetic write rejection' }, 400);
      if (body?.expectedRevision !== serverRevision || decision !== 'pending')
        return json({ message: 'refresh_required' }, 409);
      if (method === 'PATCH') {
        serverRevision += 1;
        return json({ proposal: proposal() });
      }
      decision = body?.action === 'approve' ? 'approved' : 'dismissed';
      receipt = {
        proposalId: proposal().id,
        revision: serverRevision,
        decision,
        decidedAt: '2026-10-23T00:00:00Z',
        ...(decision === 'approved'
          ? {
              receiptId: '20000000-0000-4000-8000-000000000001',
              dispatch: { state: 'queued', reason: null, remoteJobId: null },
            }
          : {}),
      };
      if (unknownWrite) throw new TypeError('Synthetic transport lost after server commit');
      return json(receipt);
    }
    if (
      path === '/api/join-requests/pending' ||
      path === '/api/inbox' ||
      path === '/api/shell/counts'
    )
      return json({
        requests: [],
        items: [],
        pulse: decision === 'pending' ? 1 : 0,
        inbox: 0,
        joinRequests: 0,
      });
    unexpected.push(`${method} ${path}`);
    throw new Error('Unexpected fixture request');
  };
  (window as Window & { __pulseFixture?: unknown }).__pulseFixture = {
    readDenied: async () => {
      const { pulse } = await import('$lib/state/features/pulse.svelte');
      try {
        await pulse.readReceipt(proposal().id);
        return false;
      } catch {
        return true;
      }
    },
    holdNextReceipt: () => {
      holdReceipt = true;
    },
    startReceiptRead: async () => {
      const { pulse } = await import('$lib/state/features/pulse.svelte');
      void pulse.readReceipt(proposal().id);
    },
    holdProjectionRead: async () => {
      projectionPaths.add('/api/pulse/count');
      projectionPaths.add('/api/pulse/proposals');
      const { pulse } = await import('$lib/state/features/pulse.svelte');
      void pulse.refresh();
    },
    releaseProjection: () => {
      for (const release of releaseProjection.splice(0)) release();
    },
    releaseReceipt: () => releaseReceipt?.(),
    switchOwner: () => {
      scopeSwitchAt = requests.length;
      denied = true;
      page.data.user = { id: 'pulse-other', role: 'user' };
      page.data.activeOrgId = 'pulse-other-org';
      page.data.permissions = { permissions: [] };
      scopeSwitch?.();
    },
    snapshot: () => ({
      heldReceipt,
      heldProjection,
      client: clientState?.(),
      scopeSwitchAt,
      requests: structuredClone(requests),
      unexpected: [...unexpected],
      decision,
      serverRevision,
      dispatches: receipt?.receiptId ? 1 : 0,
      receipt,
    }),
    recover: () => {
      failInvalidation = false;
    },
    project: () => project?.(),
    reconnect: async () => {
      const { conn } = await import('$lib/state/gateway/connection.svelte');
      conn.connectedAt = Date.now();
    },
    scheduled: () => {
      if (receipt?.dispatch)
        receipt.dispatch = {
          state: 'scheduled',
          reason: null,
          remoteJobId: 'remote-scheduled-fixture',
        };
    },
  };
}
