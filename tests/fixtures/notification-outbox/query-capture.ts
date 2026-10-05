import type postgres from 'postgres';

export type CapturedTaggedQuery = Readonly<{
  fragments: readonly string[];
  parameters: readonly unknown[];
  normalized: string;
}>;

type CallableSql = (...args: unknown[]) => unknown;

function normalizedSql(fragments: readonly string[]) {
  return fragments
    .map((fragment, index) => `${fragment}${index < fragments.length - 1 ? `$${index + 1}` : ''}`)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTemplateStringsArray(value: unknown): value is TemplateStringsArray {
  return (
    Array.isArray(value) &&
    Array.isArray((value as unknown as { raw?: unknown }).raw) &&
    value.every((part) => typeof part === 'string')
  );
}

/** Forward every operation to the real transaction while recording exact tagged fragments/values. */
export function captureTransactionSql(
  transaction: postgres.TransactionSql,
  captures: CapturedTaggedQuery[],
): postgres.TransactionSql {
  const target = transaction as unknown as CallableSql;
  return new Proxy(target, {
    apply(callable, _thisArg, argumentsList) {
      const [template, ...parameters] = argumentsList;
      if (isTemplateStringsArray(template)) {
        const fragments = Object.freeze([...template]);
        captures.push(
          Object.freeze({
            fragments,
            parameters: Object.freeze([...parameters]),
            normalized: normalizedSql(fragments),
          }),
        );
      }
      return Reflect.apply(callable, transaction, argumentsList);
    },
    get(callable, property) {
      const value = Reflect.get(callable, property, transaction);
      return typeof value === 'function' ? value.bind(transaction) : value;
    },
  }) as unknown as postgres.TransactionSql;
}

function prefixedTemplate(prefix: string, fragments: readonly string[]): TemplateStringsArray {
  const cooked = [`${prefix}${fragments[0]}`, ...fragments.slice(1)];
  Object.defineProperty(cooked, 'raw', { value: [...cooked] });
  return cooked as unknown as TemplateStringsArray;
}

/** Explain the captured production query without reconstructing or interpolating its values. */
export async function explainCapturedQuery(
  transaction: postgres.TransactionSql,
  capture: CapturedTaggedQuery,
) {
  const callable = transaction as unknown as CallableSql;
  const pending = Reflect.apply(callable, transaction, [
    prefixedTemplate('explain (analyze,buffers,format json) ', capture.fragments),
    ...capture.parameters,
  ]) as Promise<{ 'QUERY PLAN': unknown }[]>;
  const [row] = await pending;
  return row?.['QUERY PLAN'];
}

export type NotificationQueryClass =
  | 'pending_candidate'
  | 'expired_candidate'
  | 'catalog_before'
  | 'catalog_between'
  | 'catalog_after'
  | 'other';

export function notificationQueryClass(capture: CapturedTaggedQuery): NotificationQueryClass {
  const query = capture.normalized;
  if (query.includes("state='pending'") && query.includes('order by event_id for update')) {
    return 'pending_candidate';
  }
  if (query.includes("state='processing'") && query.includes('lease_expires_at<=')) {
    return 'expired_candidate';
  }
  if (query.includes('select exists(') && query.includes("state='pending'")) {
    const lower = query.includes('catalog_revision >');
    const upper = query.includes('catalog_revision <');
    if (lower && upper) return 'catalog_between';
    if (lower) return 'catalog_after';
    if (upper) return 'catalog_before';
  }
  return 'other';
}

type PlanNode = {
  'Node Type': string;
  'Index Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  'Rows Removed by Index Recheck'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  Plans?: PlanNode[];
};

function planNodes(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(planNodes)];
}

function revisionBounds(capture: CapturedTaggedQuery) {
  const queryClass = notificationQueryClass(capture);
  const values = capture.parameters
    .slice(1)
    .filter((value) => typeof value === 'string') as string[];
  if (queryClass === 'pending_candidate' || queryClass === 'expired_candidate') {
    return Object.freeze({ exact: values[0] ?? null });
  }
  if (queryClass === 'catalog_before') return Object.freeze({ upper: values[0] ?? null });
  if (queryClass === 'catalog_after') return Object.freeze({ lower: values[0] ?? null });
  if (queryClass === 'catalog_between') {
    return Object.freeze({ lower: values[0] ?? null, upper: values[1] ?? null });
  }
  return Object.freeze({});
}

export function summarizeCapturedPlan(explain: unknown, capture: CapturedTaggedQuery) {
  const root = (explain as Array<{ Plan: PlanNode }>)[0]?.Plan;
  if (!root) throw new Error('Notification captured EXPLAIN plan is missing');
  const nodes = planNodes(root);
  const scan = nodes.find((node) => node['Index Name']) ?? root;
  const examined = nodes
    .filter((node) => node['Index Name'])
    .reduce(
      (sum, node) =>
        sum +
        ((node['Actual Rows'] ?? 0) +
          (node['Rows Removed by Filter'] ?? 0) +
          (node['Rows Removed by Index Recheck'] ?? 0)) *
          (node['Actual Loops'] ?? 1),
      0,
    );
  return Object.freeze({
    queryClass: notificationQueryClass(capture),
    revisionBounds: revisionBounds(capture),
    chosenIndex: scan['Index Name'] ?? null,
    rows: scan['Actual Rows'] ?? 0,
    loops: scan['Actual Loops'] ?? 0,
    removed: (scan['Rows Removed by Filter'] ?? 0) + (scan['Rows Removed by Index Recheck'] ?? 0),
    examined,
    buffers: Object.freeze({
      hit: scan['Shared Hit Blocks'] ?? 0,
      read: scan['Shared Read Blocks'] ?? 0,
    }),
  });
}
