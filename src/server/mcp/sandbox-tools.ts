/**
 * The sandbox tools of the hub MCP endpoint (spec 136 S5, 143). Every handler acts for the
 * caller's org through the existing sandbox service. A key caller gets no business data rows; a
 * signed-in caller must hold `settings:manage` and `sandbox_query` applies the dataset's own
 * `view` and record-scope checks.
 */
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  datasetCatalog,
  LIBRARY_PAGE,
  listDatasets,
  listElements,
  listPages,
  removeElement,
  runQuery,
  setListens,
  upsertElement,
  type SandboxElementInput,
} from '$server/sandbox/sandbox.service';
import { SandboxQueryError, type QuerySpec } from '$server/sandbox/query-compiler';
import { loadCanonicalMemberships } from '$server/services/canonical-directory.service';
import { hasOrgCapability, resolveCapabilities } from '$server/services/rbac.service';
import { validateBlockSpec } from '$server/sandbox/blocks';
import { DATASETS } from '$server/sandbox/datasets';
import { pageWiring } from '$server/sandbox/wiring';
import {
  BLOCK_DESCRIPTIONS,
  BLOCK_EXAMPLES,
  FILTER_DESCRIPTION,
  FILTER_EXAMPLE,
  WIRED_PAGE_EXAMPLE,
} from '$lib/sandbox/blocks/catalog';
import {
  BLOCK_KINDS,
  BUCKETS,
  CHART_PRESETS,
  FORMATS,
  RANGES,
  TONES,
  blockToolSchemas,
  filterToolSchema,
  listensSchema,
} from '$lib/sandbox/blocks/schema';
import { ToolFailure, type McpTool } from './protocol';

/** A key caller carries `keyId`; a signed-in caller carries the `locals` the permission service reads. */
export interface SandboxToolContext {
  ctx: CoreCtx;
  keyId?: string;
  locals?: App.Locals;
  /** The hub's availability rule for `/sandbox` says this organization cannot reach it (spec 143 P10). */
  sandboxBlocked?: boolean;
}

/** Signed-in callers need the Sandbox page's own permission for every sandbox tool. */
async function gate({ locals, sandboxBlocked }: SandboxToolContext): Promise<void> {
  if (sandboxBlocked) throw new ToolFailure('The Sandbox is not available for this organization.');
  if (locals && !(await hasOrgCapability(locals, 'settings', 'manage')))
    throw new ToolFailure('Your role does not permit managing the Sandbox.');
}

const PAGE_RE = /^[a-z][a-z0-9-]{0,31}$/;

function pageArg(args: Record<string, unknown>): string {
  const page = args.page ?? 'default';
  if (typeof page !== 'string' || !PAGE_RE.test(page))
    throw new ToolFailure(
      'page must be 1-32 characters: lowercase letters, digits and hyphens, starting with a letter.',
    );
  if (page === LIBRARY_PAGE) throw new ToolFailure(`The page "${LIBRARY_PAGE}" is reserved.`);
  return page;
}

function idArg(args: Record<string, unknown>): string {
  if (typeof args.id !== 'string' || !args.id) throw new ToolFailure('id is required.');
  return args.id;
}

const STRING_FIELDS = ['title', 'html', 'css', 'js'] as const;
const GRID_FIELDS = ['w', 'h'] as const;

const element = (e: Awaited<ReturnType<typeof listElements>>[number]) => ({
  id: e.id,
  page: e.page,
  title: e.title,
  html: e.html,
  css: e.css,
  js: e.js,
  spec: e.spec,
  w: e.w,
  h: e.h,
  position: e.position,
  updatedAt: e.updatedAt,
});

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const tools: McpTool<SandboxToolContext>[] = [
  {
    name: 'sandbox_datasets',
    description:
      "List the datasets a sandbox element can query in the viewer's browser, with column names and types. Returns schema only, never rows.",
    inputSchema: obj({}),
    call: async (_args, { locals }) => ({
      datasets: locals ? await listDatasets(locals) : datasetCatalog(),
    }),
  },
  {
    name: 'sandbox_pages',
    description: "List this organization's sandbox pages with their element counts.",
    inputSchema: obj({}),
    call: async (_args, { ctx }) => ({ pages: await listPages(ctx) }),
  },
  {
    name: 'sandbox_elements',
    description:
      'List the elements of one sandbox page, plus its wiring report: the filters publishing page values and, per block, its working bindings and wiring problems (no_publisher, kind_mismatch, conflicting_publishers).',
    inputSchema: obj({ page: { type: 'string', description: 'Page name; default "default".' } }),
    call: async (args, { ctx }) => {
      const elements = await listElements(ctx, pageArg(args));
      return { elements: elements.map(element), wiring: pageWiring(elements, DATASETS) };
    },
  },
  {
    name: 'sandbox_element_write',
    description:
      'Create an element (no id; title required) or change one by id (only the fields you send change). html, css and js together may not exceed 64 KiB. w and h are grid units 1-4.',
    inputSchema: obj({
      id: { type: 'string', description: 'Element id to change; omit to create.' },
      page: { type: 'string', description: 'Page for a new element; default "default".' },
      title: { type: 'string' },
      html: { type: 'string' },
      css: { type: 'string' },
      js: { type: 'string' },
      w: { type: 'integer', minimum: 1, maximum: 4 },
      h: { type: 'integer', minimum: 1, maximum: 4 },
      position: { type: 'integer', minimum: 0 },
      listens: {
        type: 'array',
        maxItems: 6,
        description:
          "Connections of a kpi/chart/table/list block: [{ var, col }]. Replaces ONLY the block's connections (send [] to clear); needs id.",
        items: obj({ var: { type: 'string' }, col: { type: 'string' } }, ['var', 'col']),
      },
    }),
    call: async (args, { ctx, keyId }) => {
      let listens;
      if (args.listens !== undefined) {
        const parsed = listensSchema.safeParse(args.listens);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          throw new ToolFailure(
            `invalid listens.${issue?.path.join('.') ?? ''}: ${issue?.message}`,
          );
        }
        if (args.id === undefined)
          throw new ToolFailure('listens needs the id of an existing block.');
        listens = parsed.data;
      }
      const input: SandboxElementInput = { writtenByKey: keyId };
      for (const f of STRING_FIELDS) {
        if (args[f] === undefined) continue;
        if (typeof args[f] !== 'string') throw new ToolFailure(`${f} must be a string.`);
        input[f] = args[f] as string;
      }
      for (const f of GRID_FIELDS) {
        if (args[f] === undefined) continue;
        if (!Number.isInteger(args[f]) || (args[f] as number) < 1 || (args[f] as number) > 4)
          throw new ToolFailure(`${f} must be an integer from 1 to 4.`);
        input[f] = args[f] as number;
      }
      if (args.position !== undefined) {
        if (!Number.isInteger(args.position) || (args.position as number) < 0)
          throw new ToolFailure('position must be a whole number, 0 or more.');
        input.position = args.position as number;
      }
      if (args.id !== undefined) input.id = idArg(args);
      else input.page = pageArg(args);
      // Connections alone use the locked `setListens` write (spec 150).
      const onlyListens =
        listens !== undefined && Object.keys(args).every((k) => k === 'id' || k === 'listens');
      if (onlyListens) {
        return { element: element(await setListens(ctx, idArg(args), listens!, keyId)) };
      }
      // Fields and connections in ONE transaction: a refused part writes nothing.
      if (listens !== undefined) input.listens = listens;
      return { element: element(await upsertElement(ctx, input)) };
    },
  },
  {
    name: 'sandbox_element_remove',
    description: 'Remove one element by id.',
    inputSchema: obj({ id: { type: 'string' } }, ['id']),
    call: async (args, { ctx }) => {
      if (!(await removeElement(ctx, idArg(args)))) throw new ToolFailure('Element not found.');
      return { removed: true };
    },
  },
];

const PAGE_PROP = { type: 'string', description: 'Page for a new block; default "default".' };

/**
 * One writer per block kind, from the same zod grammar the in-page assistant uses. A block is
 * data rendered by the hub's own components: no markup or script from the caller is stored.
 */
const blockTools: McpTool<SandboxToolContext>[] = blockToolSchemas().map((tool) => {
  const schema = tool.inputSchema as { properties?: Record<string, unknown> };
  return {
    name: `sandbox_block_${tool.kind}`,
    description: `${BLOCK_DESCRIPTIONS[tool.kind]} Pass \`page\` to choose the page of a new block.`,
    inputSchema: { ...schema, properties: { ...schema.properties, page: PAGE_PROP } },
    call: async (args, { ctx, keyId }) => {
      const { page: _page, ...rest } = args;
      let parsed: ReturnType<typeof tool.parse>;
      try {
        parsed = tool.parse(rest);
      } catch (err) {
        const issue = (err as { issues?: Array<{ path: unknown[]; message: string }> }).issues?.[0];
        throw new ToolFailure(
          issue ? `invalid ${issue.path.join('.') || 'input'}: ${issue.message}` : 'invalid input',
        );
      }
      const { id, title, w, h, spec } = parsed;
      const input: SandboxElementInput = {
        title,
        w,
        h,
        spec: validateBlockSpec(spec), // columns and types against the dataset registry
        writtenByKey: keyId,
      };
      if (id) input.id = id;
      else input.page = pageArg(args);
      return { element: element(await upsertElement(ctx, input)) };
    },
  };
});

const filterTool = filterToolSchema();

/** A page filter (spec 150): same grammar and validation as the in-page assistant's tool. */
const filterWriter: McpTool<SandboxToolContext> = {
  name: 'sandbox_block_filter',
  description: `${FILTER_DESCRIPTION} Pass \`page\` to choose the page of a new filter.`,
  inputSchema: {
    ...(filterTool.inputSchema as { properties?: Record<string, unknown> }),
    properties: {
      ...(filterTool.inputSchema as { properties?: Record<string, unknown> }).properties,
      page: PAGE_PROP,
    },
  },
  call: async (args, { ctx, keyId }) => {
    const { page: _page, ...rest } = args;
    let parsed: ReturnType<typeof filterTool.parse>;
    try {
      parsed = filterTool.parse(rest);
    } catch (err) {
      const issue = (err as { issues?: Array<{ path: unknown[]; message: string }> }).issues?.[0];
      throw new ToolFailure(
        issue ? `invalid ${issue.path.join('.') || 'input'}: ${issue.message}` : 'invalid input',
      );
    }
    const { id, title, spec } = parsed;
    const input: SandboxElementInput = {
      title,
      spec: validateBlockSpec(spec),
      writtenByKey: keyId,
    };
    if (id) input.id = id;
    else input.page = pageArg(args);
    return { element: element(await upsertElement(ctx, input)) };
  },
};

tools.push(
  {
    name: 'sandbox_blocks',
    description:
      'The block kit catalogue: the block kinds, every preset value and one complete example input per kind. Blocks are built from the hub’s own components; use a sandbox_block_* tool for anything a kind covers and sandbox_element_write only for a visual none of them can express.',
    inputSchema: obj({}),
    call: async () => ({
      kinds: BLOCK_KINDS,
      presets: {
        chart: CHART_PRESETS,
        format: FORMATS,
        tone: TONES,
        period: RANGES,
        bucket: BUCKETS,
      },
      examples: BLOCK_EXAMPLES,
      filter: { description: FILTER_DESCRIPTION, example: FILTER_EXAMPLE },
      wiredPage: WIRED_PAGE_EXAMPLE,
    }),
  },
  ...blockTools,
  filterWriter,
);

const gated = (tool: McpTool<SandboxToolContext>): McpTool<SandboxToolContext> => ({
  ...tool,
  call: async (args, context) => {
    await gate(context);
    return tool.call(args, context);
  },
});

/** The key-callable tools; for a signed-in caller each also checks `settings:manage`. */
export const sandboxTools = tools.map(gated);

const LIST_CAPS = { whereMax: 20, orderMax: 5, groupMax: 5, aggregateMax: 10, selectMax: 50 };

/** Shape only; the compiler checks dataset, columns and operators against the registry. */
function querySpecArg(args: Record<string, unknown>): QuerySpec {
  const lists = [
    ['select', LIST_CAPS.selectMax],
    ['where', LIST_CAPS.whereMax],
    ['orderBy', LIST_CAPS.orderMax],
    ['groupBy', LIST_CAPS.groupMax],
    ['aggregate', LIST_CAPS.aggregateMax],
  ] as const;
  if (typeof args.dataset !== 'string' || !args.dataset)
    throw new ToolFailure('dataset is required.');
  for (const [name, max] of lists) {
    const v = args[name];
    if (v !== undefined && (!Array.isArray(v) || v.length > max))
      throw new ToolFailure(`${name} must be a list of at most ${max}.`);
  }
  if (args.limit !== undefined && typeof args.limit !== 'number')
    throw new ToolFailure('limit must be a number.');
  if (args.bucket !== undefined && (typeof args.bucket !== 'object' || args.bucket === null))
    throw new ToolFailure('bucket must be an object.');
  return args as unknown as QuerySpec;
}

/** Tools only a signed-in caller sees: who they are, and rows their role may read. */
const [whoami, sandboxQuery]: McpTool<SandboxToolContext>[] = [
  {
    name: 'whoami',
    description:
      'Who you are signed in as: the person, the organization, your roles there, whether you may manage the Sandbox and which datasets you may query.',
    inputSchema: obj({}),
    call: async (_args, { ctx, locals, sandboxBlocked }) => {
      const user = locals!.user!;
      const [caps, organizations, datasets] = await Promise.all([
        resolveCapabilities(ctx.tenantId, user.supabaseId!),
        loadCanonicalMemberships(user.supabaseId!),
        listDatasets(locals!),
      ]);
      return {
        user: { email: user.email, displayName: user.displayName },
        organization: {
          id: ctx.tenantId,
          name: organizations.find((o) => o.id === ctx.tenantId)?.name ?? null,
        },
        roles: caps.roles,
        canManageSandbox:
          !sandboxBlocked && (await hasOrgCapability(locals!, 'settings', 'manage')),
        datasets: datasets.map((d) => d.id),
      };
    },
  },
  gated({
    name: 'sandbox_query',
    description:
      'Run one read query over a dataset you may view (see sandbox_datasets for ids and columns). Rows are limited by the query compiler; record scope and masked columns follow your role.',
    inputSchema: obj(
      {
        dataset: { type: 'string' },
        select: { type: 'array', items: { type: 'string' } },
        where: {
          type: 'array',
          items: obj({ col: { type: 'string' }, op: { type: 'string' }, value: {} }, ['col', 'op']),
        },
        orderBy: {
          type: 'array',
          items: obj({ col: { type: 'string' }, dir: { enum: ['asc', 'desc'] } }, ['col']),
        },
        limit: { type: 'number' },
        groupBy: { type: 'array', items: { type: 'string' } },
        aggregate: {
          type: 'array',
          items: obj({ fn: { type: 'string' }, col: { type: 'string' }, as: { type: 'string' } }, [
            'fn',
            'col',
            'as',
          ]),
        },
        bucket: obj({ col: { type: 'string' }, unit: { type: 'string' } }, ['col', 'unit']),
      },
      ['dataset'],
    ),
    call: async (args, { locals }) => runQuery(locals!, querySpecArg(args)),
  }),
];

/**
 * The tools one kind of caller is offered; `tools/call` re-checks inside each handler. A signed-in
 * caller who may not use the Sandbox (role, or module unavailable) is offered `whoami` only (P16).
 */
export const sandboxToolsFor = (
  kind: 'key' | 'user',
  mayUseSandbox = true,
): McpTool<SandboxToolContext>[] =>
  kind === 'key'
    ? sandboxTools
    : mayUseSandbox
      ? [whoami!, ...sandboxTools, sandboxQuery!]
      : [whoami!];

/** Service refusals the model can act on (size limit, bad id, unknown element). */
export function sandboxFailure(e: unknown): string | null {
  if (!(e instanceof SandboxQueryError)) return null;
  return e.message === 'element not found' ? 'Element not found.' : e.message;
}
