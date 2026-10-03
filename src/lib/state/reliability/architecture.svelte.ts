import type {
  ArchEdgeDef,
  ArchFunction,
  ArchNetwork,
  ArchNodeDef,
  ArchNodeKind,
  ArchNodeStatus,
  ArchitectureSnapshot,
  ArchStatus,
} from '$server/services/architecture.service';
import type {
  C4Level,
  C4Model,
  C4Node,
  C4ReconStatus,
  C4Relation,
  C4RelationKind,
} from '$server/services/architecture-c4.model';
import { createAsyncResource } from '../async.svelte';
import { boolean, finite, integer, record, rows, string } from './decode-primitives';
import { fetchReliabilityJson } from './http-read';
import { createReadFailureMonitor } from './read-monitor';
import type { ReliabilityHttpOwner } from './view-owner';

const NODE_KINDS = new Set<ArchNodeKind>([
  'host',
  'container',
  'volume',
  'cache',
  'app',
  'db',
  'storage',
  'edge',
  'external',
]);
const NETWORKS = new Set<ArchNetwork>(['netcup', 'vercel', 'cloud', 'internet']);
const FUNCTIONS = new Set<ArchFunction>([
  'compute',
  'app',
  'db',
  'storage',
  'cache',
  'edge',
  'api',
]);
const STATUSES = new Set<ArchStatus>(['ok', 'degraded', 'down', 'unknown']);
const C4_LEVELS = new Set<C4Level>(['context', 'container', 'component', 'code']);
const C4_RECON = new Set<C4ReconStatus>(['verified', 'partial', 'external']);
const C4_RELATIONS = new Set<C4RelationKind>(['runtime', 'data', 'event', 'deploy', 'ownership']);

function enumValue<T extends string>(raw: unknown, values: ReadonlySet<T>): T {
  const value = string(raw) as T;
  if (!values.has(value)) throw new Error('Invalid architecture enum');
  return value;
}

function stringRows(raw: unknown, max = 256): string[] {
  return rows(raw, (value) => string(value, 16_384), max);
}

function metrics(raw: unknown): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  const entries = Object.entries(record(raw));
  if (entries.length > 256) throw new Error('Invalid architecture metrics');
  return Object.fromEntries(entries.map(([key, value]) => [string(key), string(value, 16_384)]));
}

function decodeNode(raw: unknown): ArchNodeDef & ArchNodeStatus {
  const value = record(raw);
  const latencyMs = value.latencyMs === undefined ? undefined : finite(value.latencyMs);
  if (latencyMs !== undefined && latencyMs < 0) throw new Error('Invalid architecture latency');
  return {
    id: string(value.id),
    name: string(value.name),
    kind: enumValue(value.kind, NODE_KINDS),
    network: enumValue(value.network, NETWORKS),
    fn: enumValue(value.fn, FUNCTIONS),
    x: finite(value.x),
    y: finite(value.y),
    icon: string(value.icon),
    endpoints: stringRows(value.endpoints),
    description: string(value.description, 16_384),
    status: enumValue(value.status, STATUSES),
    statusDetail: string(value.statusDetail, 16_384),
    ...(latencyMs === undefined ? {} : { latencyMs }),
    ...(value.metrics === undefined ? {} : { metrics: metrics(value.metrics) }),
  };
}

function decodeEdge(raw: unknown): ArchEdgeDef {
  const value = record(raw);
  return {
    source: string(value.source),
    target: string(value.target),
    via: string(value.via, 16_384),
    ...(value.dashed === undefined ? {} : { dashed: boolean(value.dashed) }),
  };
}

function decodeC4Node(raw: unknown): C4Node {
  const value = record(raw);
  return {
    id: string(value.id),
    name: string(value.name),
    level: enumValue(value.level, C4_LEVELS),
    parentId: value.parentId === null ? null : string(value.parentId),
    description: string(value.description, 16_384),
    technology: string(value.technology),
    icon: string(value.icon),
    sourceRefs: stringRows(value.sourceRefs),
    artefacts: stringRows(value.artefacts),
    reconStatus: enumValue(value.reconStatus, C4_RECON),
    ...(value.statusNodeId === undefined ? {} : { statusNodeId: string(value.statusNodeId) }),
  };
}

function decodeC4Relation(raw: unknown): C4Relation {
  const value = record(raw);
  return {
    source: string(value.source),
    target: string(value.target),
    label: string(value.label, 16_384),
    technology: string(value.technology, 16_384),
    kind: enumValue(value.kind, C4_RELATIONS),
  };
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function validateC4(c4: C4Model, infrastructureIds: ReadonlySet<string>): void {
  const byId = new Map(c4.nodes.map((node) => [node.id, node]));
  for (const node of c4.nodes) {
    if (node.parentId !== null && !byId.has(node.parentId)) {
      throw new Error('Invalid C4 parent');
    }
    if (node.statusNodeId !== undefined && !infrastructureIds.has(node.statusNodeId)) {
      throw new Error('Invalid C4 status node');
    }
    const seen = new Set<string>();
    let current: C4Node | undefined = node;
    while (current?.parentId) {
      if (seen.has(current.id)) throw new Error('Cyclic C4 parent');
      seen.add(current.id);
      current = byId.get(current.parentId);
    }
  }
  for (const relation of c4.relations) {
    if (!byId.has(relation.source) || !byId.has(relation.target)) {
      throw new Error('Invalid C4 relation endpoint');
    }
  }
}

export function decodeArchitectureSnapshot(raw: unknown): ArchitectureSnapshot {
  const value = record(raw);
  const nodes = rows(value.nodes, decodeNode, 2000);
  const edges = rows(value.edges, decodeEdge, 5000);
  const c4Value = record(value.c4);
  const c4: C4Model = {
    nodes: rows(c4Value.nodes, decodeC4Node, 2000),
    relations: rows(c4Value.relations, decodeC4Relation, 5000),
    generatedFrom: string(c4Value.generatedFrom, 16_384),
  };
  if (nodes.length + c4.nodes.length > 2000) throw new Error('Architecture entity cap exceeded');
  if (edges.length + c4.relations.length > 5000) throw new Error('Architecture link cap exceeded');
  assertUnique(
    nodes.map((node) => node.id),
    'architecture node',
  );
  assertUnique(
    c4.nodes.map((node) => node.id),
    'C4 node',
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new Error('Invalid architecture edge endpoint');
    }
  }
  validateC4(c4, nodeIds);
  return { nodes, edges, c4, checkedAt: integer(value.checkedAt) };
}

export function createArchitectureState(
  owner: () => ReliabilityHttpOwner | null,
  beforePublish: (snapshot: ArchitectureSnapshot) => void,
  options: { intervalMs?: number; document?: () => Document | null } = {},
) {
  const monitor = createReadFailureMonitor('architecture');
  const intervalMs = options.intervalMs ?? 30_000;
  let active: {
    token: symbol | null;
    controller: AbortController;
    promise: Promise<void>;
  } | null = null;
  let trailing = false;
  let disposed = false;
  let mounted = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let removeVisibility: (() => void) | null = null;

  const resource = createAsyncResource<
    ArchitectureSnapshot,
    [ReliabilityHttpOwner | null, AbortSignal]
  >(
    async (captured, signal) => {
      if (!captured) throw new Error('Architecture unavailable');
      let phase: 'transport' | 'decode' = 'transport';
      try {
        const raw = await fetchReliabilityJson('/api/reliability/architecture', signal);
        phase = 'decode';
        const snapshot = decodeArchitectureSnapshot(raw);
        return snapshot;
      } catch (error) {
        if (captured.current()) monitor.failed(captured.token, phase);
        throw error;
      }
    },
    {
      initialLoading: true,
      formatError: () => 'Architecture could not be refreshed.',
      owner: (captured) => captured,
      key: (captured) => captured?.queryKey ?? '',
      beforePublish: (snapshot, captured) => {
        beforePublish(snapshot);
        if (captured) monitor.ready();
      },
    },
  );

  function start(captured: ReliabilityHttpOwner | null): Promise<void> {
    const controller = new AbortController();
    const record = {
      token: captured?.token ?? null,
      controller,
      promise: Promise.resolve(),
    };
    record.promise = resource.load(captured, controller.signal).finally(() => {
      if (active !== record) return;
      active = null;
      if (trailing && !disposed && mounted) {
        trailing = false;
        void refresh();
      }
    });
    active = record;
    return record.promise;
  }

  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    const captured = owner();
    if (active && active.token === (captured?.token ?? null)) {
      trailing = true;
      return active.promise;
    }
    if (active) {
      active.controller.abort();
      active = null;
    }
    trailing = false;
    return start(captured);
  }

  function mount(): void {
    if (disposed || mounted) return;
    mounted = true;
    const documentRef = options.document
      ? options.document()
      : typeof document === 'undefined'
        ? null
        : document;
    const isVisible = () => !documentRef || documentRef.visibilityState !== 'hidden';
    const onVisibility = () => {
      if (isVisible()) void refresh();
    };
    if (documentRef) {
      documentRef.addEventListener('visibilitychange', onVisibility);
      removeVisibility = () => documentRef.removeEventListener('visibilitychange', onVisibility);
    }
    timer = setInterval(() => {
      if (isVisible()) void refresh();
    }, intervalMs);
    if (isVisible()) void refresh();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    mounted = false;
    trailing = false;
    if (timer) clearInterval(timer);
    timer = null;
    removeVisibility?.();
    removeVisibility = null;
    active?.controller.abort();
    active = null;
    resource.reset();
  }

  return {
    get snapshot() {
      return resource.data;
    },
    get loading() {
      return resource.loading;
    },
    get error() {
      return resource.error;
    },
    get status() {
      return resource.status;
    },
    mount,
    refresh,
    dispose,
  };
}
