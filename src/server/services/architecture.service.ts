/**
 * Infrastructure architecture topology + live status probes for the
 * /reliability Architecture tab.
 *
 * The TOPOLOGY below is a hand-maintained mirror of the real deployment
 * (minion/deploy/swarm/stack.yml + hosting): a single Netcup VPS running a
 * one-node Docker Swarm with two single-writer gateway services (host ports
 * 18789/18790), a swarm-internal Valkey, three named state volumes, a host
 * Caddy + Cloudflare + Tailscale edge, Vercel-hosted hub/site, Supabase
 * Postgres (core), Turso/LibSQL (telemetry) and Backblaze B2 file storage.
 *
 * Status semantics are honest about reachability: the hub can only directly
 * probe what it can reach (gateways via WS upgrade, its own DBs, public HTTPS
 * endpoints). Swarm-internal services and volumes get DERIVED statuses with an
 * explicit `statusDetail` saying what the inference is based on; things we
 * cannot see at all report `unknown`, never a guessed `ok`.
 */
import { sql } from 'drizzle-orm';
import { desc, eq } from 'drizzle-orm';
import { gatewayHeartbeats } from '@minion-stack/db/schema';
import { getCoreDb } from '$server/db/pg-client';
import { getDb } from '$server/db/client';
import { probeWsUpgrade } from '$server/services/gateway-lease.service';
import { listGatewaysForOrgAdmin } from '$server/services/gateway.pg.service';
import { C4_MODEL, type C4Model } from './architecture-c4.model';

export type ArchNodeKind =
  'host' | 'container' | 'volume' | 'cache' | 'app' | 'db' | 'storage' | 'edge' | 'external';

export type ArchStatus = 'ok' | 'degraded' | 'down' | 'unknown';

/** Where the node physically runs — the "by network/host" grouping. */
export type ArchNetwork = 'netcup' | 'vercel' | 'cloud' | 'internet';
/** What the node does — the "by function" grouping. */
export type ArchFunction = 'compute' | 'app' | 'db' | 'storage' | 'cache' | 'edge' | 'api';

export interface ArchNodeDef {
  id: string;
  name: string;
  kind: ArchNodeKind;
  network: ArchNetwork;
  fn: ArchFunction;
  /**
   * Designed diagram anchor (world coords, force-sim target). Placement is
   * MEANINGFUL: proximity = locality/dependency. Zones — apps top-left, public
   * edge chain top-center (Cloudflare→Caddy→gateways), the Netcup host and its
   * containers center, their volumes directly below, data stores clustered
   * under their consumers (hub/site), externals next to whichever service
   * calls them.
   */
  x: number;
  y: number;
  /** Lucide icon name (must exist in `$lib/utils/lucide-svg` ICON_BODY). */
  icon: string;
  /** Listening endpoints / addresses this node exposes. */
  endpoints: string[];
  /** Static one-liner (what this node is), independent of live status. */
  description: string;
}

export interface ArchEdgeDef {
  source: string;
  target: string;
  /** The justification: protocol + endpoint/port this connection uses. */
  via: string;
  /** Deploy-time-only or fallback paths render dashed. */
  dashed?: boolean;
}

export interface ArchNodeStatus {
  status: ArchStatus;
  /** Why the node has this status (probe result, inference basis, or "not reachable"). */
  statusDetail: string;
  latencyMs?: number;
  /** Extra live metrics (heartbeat uptime, sessions, …) as label→value. */
  metrics?: Record<string, string>;
}

export interface ArchitectureSnapshot {
  nodes: Array<ArchNodeDef & ArchNodeStatus>;
  edges: ArchEdgeDef[];
  c4: C4Model;
  checkedAt: number;
}

// ── Static topology (mirrors deploy/swarm/stack.yml + hosting) ──────────────

export const ARCH_NODES: ArchNodeDef[] = [
  {
    id: 'netcup-host',
    name: 'Netcup VPS',
    kind: 'host',
    network: 'netcup',
    fn: 'compute',
    x: 30,
    y: 20,
    icon: 'Server',
    endpoints: ['docker swarm (single node)', 'host ports :18789 / :18790'],
    description: 'Single-node Docker Swarm host running the gateway fleet.',
  },
  {
    id: 'gateway-default',
    name: 'gateway-default',
    kind: 'container',
    network: 'netcup',
    fn: 'compute',
    x: -220,
    y: -120,
    icon: 'Box',
    endpoints: ['tcp :18789 (host-published)', 'ws /ws frame protocol'],
    description: 'Default-org gateway service (single replica, single writer).',
  },
  {
    id: 'gateway-faces',
    name: 'gateway-faces',
    kind: 'container',
    network: 'netcup',
    fn: 'compute',
    x: 280,
    y: -120,
    icon: 'Box',
    endpoints: ['tcp :18790 (host-published)', 'ws /ws frame protocol'],
    description: 'Faces-org gateway service (single replica, single writer).',
  },
  {
    id: 'valkey',
    name: 'Valkey',
    kind: 'cache',
    network: 'netcup',
    fn: 'cache',
    x: 30,
    y: 220,
    icon: 'Zap',
    endpoints: ['redis://valkey:6379 (swarm-internal)'],
    description: 'Swarm-internal Valkey used for gateway coordination + hub cache.',
  },
  {
    id: 'vol-default-state',
    name: 'minion_default_state',
    kind: 'volume',
    network: 'netcup',
    fn: 'storage',
    x: -360,
    y: 120,
    icon: 'HardDrive',
    endpoints: ['/home/node/.minion (gateway-default)'],
    description: 'Docker volume: default gateway SQLite state + workspaces.',
  },
  {
    id: 'vol-faces-state',
    name: 'minion_faces_state',
    kind: 'volume',
    network: 'netcup',
    fn: 'storage',
    x: 440,
    y: 120,
    icon: 'HardDrive',
    endpoints: ['/home/node/.minion (gateway-faces)'],
    description: 'Docker volume: Faces gateway SQLite state + workspaces.',
  },
  {
    id: 'vol-runtime-config',
    name: 'minion_runtime_config',
    kind: 'volume',
    network: 'netcup',
    fn: 'storage',
    x: 30,
    y: 420,
    icon: 'HardDrive',
    endpoints: ['/home/node/.config (both gateways)'],
    description: 'Docker volume: shared CLI runtime configuration tree.',
  },
  {
    id: 'hub',
    name: 'Minion Hub',
    kind: 'app',
    network: 'vercel',
    fn: 'app',
    x: -560,
    y: -480,
    icon: 'Globe',
    endpoints: ['https://hub.minion-ai.org :443'],
    description: 'SvelteKit dashboard on Vercel (this app).',
  },
  {
    id: 'site',
    name: 'Minion Site',
    kind: 'app',
    network: 'vercel',
    fn: 'app',
    x: -920,
    y: -300,
    icon: 'Globe',
    endpoints: ['https :443 (Vercel)'],
    description: 'Marketing site + members area on Vercel.',
  },
  {
    id: 'supabase-pg',
    name: 'Supabase Postgres',
    kind: 'db',
    network: 'cloud',
    fn: 'db',
    x: -800,
    y: -100,
    icon: 'Database',
    endpoints: ['postgresql :5432 / :6543 (pooler)'],
    description: 'Core org data (RLS) shared by hub + site.',
  },
  {
    id: 'turso',
    name: 'Hub Turso / LibSQL',
    kind: 'db',
    network: 'cloud',
    fn: 'db',
    x: -560,
    y: 40,
    icon: 'Database',
    endpoints: ['libsql wss :443'],
    description: 'Telemetry DB: heartbeats, metrics, legacy server registry.',
  },
  {
    id: 'site-libsql',
    name: 'Site LibSQL',
    kind: 'db',
    network: 'cloud',
    fn: 'db',
    x: -1040,
    y: -40,
    icon: 'Database',
    endpoints: ['file:./data/minion_hub.db (local) / libsql wss :443 (production)'],
    description:
      'Site server data and Better Auth store; distinct client boundary from Hub core Postgres.',
  },
  {
    id: 'b2',
    name: 'Backblaze B2',
    kind: 'storage',
    network: 'cloud',
    fn: 'storage',
    x: -920,
    y: 120,
    icon: 'HardDrive',
    endpoints: ['s3 https :443'],
    description: 'S3-compatible object storage for hub file uploads.',
  },
  {
    id: 'edge-cloudflare',
    name: 'Cloudflare',
    kind: 'edge',
    network: 'internet',
    fn: 'edge',
    x: -160,
    y: -560,
    icon: 'Shield',
    endpoints: ['https/wss :443 (DNS + proxy)'],
    description: 'Public DNS + TLS proxy in front of the gateway host.',
  },
  {
    id: 'edge-caddy',
    name: 'Caddy',
    kind: 'edge',
    network: 'netcup',
    fn: 'edge',
    x: 60,
    y: -340,
    icon: 'Shield',
    endpoints: [':443 → :18789 / :18790'],
    description: 'Host reverse proxy routing public traffic to gateway ports.',
  },
  {
    id: 'edge-tailscale',
    name: 'Tailscale',
    kind: 'edge',
    network: 'netcup',
    fn: 'edge',
    x: 420,
    y: -560,
    icon: 'Shield',
    endpoints: ['tailnet serve/funnel'],
    description: 'Alternative private route to the gateway host.',
  },
  {
    id: 'ghcr',
    name: 'GHCR registry',
    kind: 'external',
    network: 'internet',
    fn: 'api',
    x: 720,
    y: -280,
    icon: 'Package',
    endpoints: ['https :443 ghcr.io'],
    description: 'Image registry pulled by the host update controller.',
  },
  {
    id: 'channel-apis',
    name: 'Channel APIs',
    kind: 'external',
    network: 'internet',
    fn: 'api',
    x: 680,
    y: 180,
    icon: 'MessageSquare',
    endpoints: ['WhatsApp ws, Telegram/Discord https :443'],
    description: 'Messaging platforms the gateways hold live connections to.',
  },
  {
    id: 'susii',
    name: 'SUSII API',
    kind: 'external',
    network: 'internet',
    fn: 'api',
    x: -760,
    y: 280,
    icon: 'Cloud',
    endpoints: ['https :443 (sales sync)'],
    description: 'Fiscal/sales system synced by the finance module.',
  },
  {
    id: 'meta-graph',
    name: 'Meta Graph API',
    kind: 'external',
    network: 'internet',
    fn: 'api',
    x: -520,
    y: 300,
    icon: 'Cloud',
    endpoints: ['https :443 graph.facebook.com'],
    description: 'Instagram/Facebook data source for socials + ads.',
  },
];

export const ARCH_EDGES: ArchEdgeDef[] = [
  // Swarm placement (host runs the services / owns the volumes)
  { source: 'netcup-host', target: 'gateway-default', via: 'swarm service, host port :18789' },
  { source: 'netcup-host', target: 'gateway-faces', via: 'swarm service, host port :18790' },
  { source: 'netcup-host', target: 'valkey', via: 'swarm service, internal :6379' },
  {
    source: 'gateway-default',
    target: 'vol-default-state',
    via: 'volume mount /home/node/.minion',
  },
  { source: 'gateway-faces', target: 'vol-faces-state', via: 'volume mount /home/node/.minion' },
  {
    source: 'gateway-default',
    target: 'vol-runtime-config',
    via: 'volume mount /home/node/.config',
  },
  { source: 'gateway-faces', target: 'vol-runtime-config', via: 'volume mount /home/node/.config' },
  { source: 'gateway-default', target: 'valkey', via: 'redis://valkey:6379 (swarm net)' },
  { source: 'gateway-faces', target: 'valkey', via: 'redis://valkey:6379 (swarm net)' },
  // Edge routing
  { source: 'edge-cloudflare', target: 'edge-caddy', via: 'https/wss :443 → host' },
  { source: 'edge-caddy', target: 'gateway-default', via: 'reverse proxy → tcp :18789' },
  { source: 'edge-caddy', target: 'gateway-faces', via: 'reverse proxy → tcp :18790' },
  { source: 'edge-tailscale', target: 'netcup-host', via: 'tailnet serve/funnel', dashed: true },
  // Hub connections
  { source: 'hub', target: 'edge-cloudflare', via: 'wss /ws gateway frame protocol :443' },
  { source: 'hub', target: 'supabase-pg', via: 'postgresql :6543 (pooler, RLS)' },
  { source: 'hub', target: 'turso', via: 'libsql wss :443' },
  { source: 'hub', target: 'b2', via: 's3 https :443' },
  { source: 'hub', target: 'susii', via: 'https :443 (finance sync cron)' },
  { source: 'hub', target: 'meta-graph', via: 'https :443 (socials/ads sync)' },
  // Site
  { source: 'site', target: 'site-libsql', via: 'libsql client (Site DB + Better Auth adapter)' },
  { source: 'site', target: 'edge-cloudflare', via: 'wss /ws (members area) :443' },
  // Gateway outbound
  {
    source: 'gateway-default',
    target: 'hub',
    via: 'https POST /api/metrics/* (Bearer server token)',
  },
  {
    source: 'gateway-faces',
    target: 'hub',
    via: 'https POST /api/metrics/* (Bearer server token)',
  },
  { source: 'gateway-default', target: 'channel-apis', via: 'ws (Baileys) + https :443 bot APIs' },
  { source: 'gateway-faces', target: 'channel-apis', via: 'ws (Baileys) + https :443 bot APIs' },
  // Deploy-time
  {
    source: 'ghcr',
    target: 'netcup-host',
    via: 'https :443 image pull (update-controller)',
    dashed: true,
  },
];

// ── Probes ──────────────────────────────────────────────────────────────────

const PROBE_TIMEOUT_MS = 4000;
const HEARTBEAT_FRESH_MS = 5 * 60 * 1000;

async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ ok: boolean; ms: number; error?: string }> {
  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS)),
    ]);
    return { ok: true, ms: Date.now() - start };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Any HTTP response (even 4xx) proves the service is up and reachable. */
async function httpProbe(url: string): Promise<{ ok: boolean; ms: number; error?: string }> {
  return timed(async () => {
    await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  });
}

interface GatewayProbe {
  nodeId: string;
  reachable: boolean;
  ms: number;
  url: string;
  lastConnectedAt: number | null;
  heartbeat: {
    capturedAt: number;
    uptimeMs: number | null;
    activeSessions: number | null;
    memoryRssMb: number | null;
  } | null;
}

/** Map a DB gateway row onto the two static stack.yml services by published port. */
function gatewayNodeId(row: { name: string; url: string }): string {
  if (row.url.includes('18790') || /faces/i.test(row.name) || /faces/i.test(row.url)) {
    return 'gateway-faces';
  }
  return 'gateway-default';
}

async function probeGateways(orgId: string): Promise<GatewayProbe[]> {
  let rows: Array<{
    id: string;
    name: string;
    url: string;
    lastConnectedAt?: Date | null;
    legacyServerId?: string | null;
  }> = [];
  try {
    rows = (await listGatewaysForOrgAdmin(orgId)) as typeof rows;
  } catch {
    return [];
  }
  return Promise.all(
    rows.map(async (row) => {
      const start = Date.now();
      let reachable = false;
      try {
        reachable = await probeWsUpgrade(row.url, PROBE_TIMEOUT_MS);
      } catch {
        reachable = false;
      }
      const ms = Date.now() - start;
      let heartbeat: GatewayProbe['heartbeat'] = null;
      try {
        const legacyId = (row as { legacyServerId?: string | null }).legacyServerId ?? row.id;
        const [hb] = await getDb()
          .select({
            capturedAt: gatewayHeartbeats.capturedAt,
            uptimeMs: gatewayHeartbeats.uptimeMs,
            activeSessions: gatewayHeartbeats.activeSessions,
            memoryRssMb: gatewayHeartbeats.memoryRssMb,
          })
          .from(gatewayHeartbeats)
          .where(eq(gatewayHeartbeats.serverId, legacyId))
          .orderBy(desc(gatewayHeartbeats.capturedAt))
          .limit(1);
        if (hb) {
          heartbeat = {
            capturedAt: Number(hb.capturedAt),
            uptimeMs: hb.uptimeMs == null ? null : Number(hb.uptimeMs),
            activeSessions: hb.activeSessions == null ? null : Number(hb.activeSessions),
            memoryRssMb: hb.memoryRssMb == null ? null : Number(hb.memoryRssMb),
          };
        }
      } catch {
        /* telemetry DB unavailable — leave heartbeat null */
      }
      return {
        nodeId: gatewayNodeId(row),
        reachable,
        ms,
        url: row.url,
        lastConnectedAt: row.lastConnectedAt ? new Date(row.lastConnectedAt).getTime() : null,
        heartbeat,
      };
    }),
  );
}

function fmtUptime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

/**
 * Probe everything reachable and derive the rest. Runs the independent probe
 * groups concurrently; individual failures degrade to `down`/`unknown` per
 * node, never throw.
 */
export async function probeArchitecture(orgId: string): Promise<ArchitectureSnapshot> {
  const now = Date.now();
  const [pg, turso, gateways, site, ghcr] = await Promise.all([
    timed(async () => {
      await getCoreDb().execute(sql`select 1`);
    }),
    timed(async () => {
      await getDb().run(sql`select 1`);
    }),
    probeGateways(orgId),
    httpProbe('https://minion-ai.org'),
    httpProbe('https://ghcr.io'),
  ]);

  const status = new Map<string, ArchNodeStatus>();
  const set = (id: string, s: ArchNodeStatus) => status.set(id, s);

  // Hub answered this very request.
  set('hub', { status: 'ok', statusDetail: 'Serving this request.' });

  set(
    'supabase-pg',
    pg.ok
      ? { status: 'ok', statusDetail: 'select 1 over the pooled RLS connection.', latencyMs: pg.ms }
      : { status: 'down', statusDetail: `Probe failed: ${pg.error}`, latencyMs: pg.ms },
  );

  set(
    'turso',
    turso.ok
      ? { status: 'ok', statusDetail: 'select 1 over libsql.', latencyMs: turso.ms }
      : { status: 'down', statusDetail: `Probe failed: ${turso.error}`, latencyMs: turso.ms },
  );

  set(
    'site',
    site.ok
      ? {
          status: 'ok',
          statusDetail: 'HTTPS HEAD https://minion-ai.org responded.',
          latencyMs: site.ms,
        }
      : {
          status: 'down',
          statusDetail: `HTTPS HEAD https://minion-ai.org failed: ${site.error}`,
          latencyMs: site.ms,
        },
  );

  set('site-libsql', {
    status: 'unknown',
    statusDetail:
      'Not directly probed from Hub; current Site source binds its server data and Better Auth adapter to LibSQL.',
  });

  set(
    'ghcr',
    ghcr.ok
      ? {
          status: 'ok',
          statusDetail: 'HTTPS HEAD ghcr.io responded (deploy-time dependency).',
          latencyMs: ghcr.ms,
        }
      : {
          status: 'unknown',
          statusDetail: `ghcr.io probe failed from hub: ${ghcr.error}. Only matters at deploy time.`,
        },
  );

  // Gateways: real WS-upgrade probes (a /health 200 is deliberately not trusted).
  const byNode = new Map<string, GatewayProbe>();
  for (const g of gateways) if (!byNode.has(g.nodeId)) byNode.set(g.nodeId, g);
  let anyGatewayUp = false;
  let anyFreshHeartbeat = false;
  let liveChannels: string[] = [];
  for (const nodeId of ['gateway-default', 'gateway-faces']) {
    const g = byNode.get(nodeId);
    if (!g) {
      set(nodeId, {
        status: 'unknown',
        statusDetail: 'No gateway row registered for this service.',
      });
      continue;
    }
    const hbFresh = g.heartbeat != null && now - g.heartbeat.capturedAt < HEARTBEAT_FRESH_MS;
    if (hbFresh) anyFreshHeartbeat = true;
    const metrics: Record<string, string> = {};
    if (g.heartbeat?.uptimeMs != null) metrics['uptime'] = fmtUptime(g.heartbeat.uptimeMs);
    if (g.heartbeat?.activeSessions != null)
      metrics['sessions'] = String(g.heartbeat.activeSessions);
    if (g.heartbeat?.memoryRssMb != null)
      metrics['memory'] = `${Math.round(g.heartbeat.memoryRssMb)} MB`;
    if (g.lastConnectedAt) metrics['last connected'] = new Date(g.lastConnectedAt).toISOString();
    if (g.reachable) {
      anyGatewayUp = true;
      set(nodeId, {
        status: hbFresh || g.heartbeat == null ? 'ok' : 'degraded',
        statusDetail:
          hbFresh || g.heartbeat == null
            ? `WS upgrade succeeded (${g.url}).`
            : `WS upgrade succeeded but last heartbeat is stale (${new Date(g.heartbeat.capturedAt).toISOString()}).`,
        latencyMs: g.ms,
        metrics,
      });
    } else {
      set(nodeId, {
        status: hbFresh ? 'degraded' : 'down',
        statusDetail: hbFresh
          ? `WS upgrade failed from hub but a fresh heartbeat exists — likely an edge-route problem.`
          : `WS upgrade failed (${g.url}) and no fresh heartbeat.`,
        latencyMs: g.ms,
        metrics,
      });
    }
  }

  // Host + swarm-internal services: derived — the hub has no direct route.
  const hostAlive = anyGatewayUp || anyFreshHeartbeat;
  set(
    'netcup-host',
    hostAlive
      ? {
          status: 'ok',
          statusDetail: 'Derived: at least one swarm service is reachable/heartbeating.',
        }
      : {
          status: 'down',
          statusDetail: 'Derived: no gateway reachable and no fresh heartbeat from the host.',
        },
  );

  set(
    'valkey',
    anyFreshHeartbeat
      ? {
          status: 'ok',
          statusDetail:
            'Inferred from fresh gateway heartbeats — Valkey is swarm-internal (:6379) and not directly reachable from the hub.',
        }
      : {
          status: 'unknown',
          statusDetail:
            'Swarm-internal (:6379) — not reachable from the hub and no fresh heartbeat to infer from.',
        },
  );

  const volStatus = (gwNode: string): ArchNodeStatus => {
    const gw = status.get(gwNode);
    return gw?.status === 'ok'
      ? { status: 'ok', statusDetail: `Derived: mounted by running ${gwNode}.` }
      : {
          status: 'unknown',
          statusDetail: `Volume state unknown while ${gwNode} is not confirmed running.`,
        };
  };
  set('vol-default-state', volStatus('gateway-default'));
  set('vol-faces-state', volStatus('gateway-faces'));
  set(
    'vol-runtime-config',
    hostAlive
      ? { status: 'ok', statusDetail: 'Derived: shared config volume on a live host.' }
      : {
          status: 'unknown',
          statusDetail: 'Volume state unknown while the host is not confirmed up.',
        },
  );

  // Edge: if any gateway answered through its public URL, the whole edge path worked.
  const edgeStatus: ArchNodeStatus = anyGatewayUp
    ? {
        status: 'ok',
        statusDetail: 'Derived: a gateway WS upgrade succeeded through the public route.',
      }
    : {
        status: 'unknown',
        statusDetail:
          'No gateway reachable — cannot distinguish an edge outage from a gateway outage.',
      };
  set('edge-cloudflare', edgeStatus);
  set('edge-caddy', edgeStatus);
  set('edge-tailscale', {
    status: 'unknown',
    statusDetail: 'Alternative tailnet route — not probed from the hub.',
  });

  // Channels: live per-channel status arrives in the gateway heartbeat blob.
  try {
    const rows = await getDb()
      .select({
        channelStatusJson: gatewayHeartbeats.channelStatusJson,
        capturedAt: gatewayHeartbeats.capturedAt,
      })
      .from(gatewayHeartbeats)
      .orderBy(desc(gatewayHeartbeats.capturedAt))
      .limit(2);
    for (const row of rows) {
      if (!row.channelStatusJson || now - Number(row.capturedAt) > HEARTBEAT_FRESH_MS) continue;
      try {
        const parsed = JSON.parse(row.channelStatusJson) as Record<string, unknown>;
        for (const [name, v] of Object.entries(parsed)) {
          const s = typeof v === 'string' ? v : ((v as { status?: string })?.status ?? '');
          if (/connected|active|ok|ready/i.test(String(s))) liveChannels.push(name);
        }
      } catch {
        /* malformed blob */
      }
    }
  } catch {
    /* telemetry DB unavailable */
  }
  liveChannels = [...new Set(liveChannels)];
  set(
    'channel-apis',
    liveChannels.length > 0
      ? {
          status: 'ok',
          statusDetail: 'Channels reporting connected in the latest gateway heartbeat.',
          metrics: { connected: liveChannels.join(', ') },
        }
      : anyFreshHeartbeat
        ? {
            status: 'degraded',
            statusDetail: 'Fresh heartbeat but no channel reports a connected status.',
          }
        : { status: 'unknown', statusDetail: 'No fresh heartbeat carrying channel status.' },
  );

  set('b2', {
    status: 'unknown',
    statusDetail: 'Not actively probed — used on demand for file uploads.',
  });
  set('susii', {
    status: 'unknown',
    statusDetail: 'Not actively probed — contacted by the nightly finance sync.',
  });
  set('meta-graph', {
    status: 'unknown',
    statusDetail: 'Not actively probed — contacted by socials/ads sync jobs.',
  });

  return {
    nodes: ARCH_NODES.map((n) => ({
      ...n,
      ...(status.get(n.id) ?? {
        status: 'unknown' as const,
        statusDetail: 'No probe implemented.',
      }),
    })),
    edges: ARCH_EDGES,
    c4: C4_MODEL,
    checkedAt: now,
  };
}
