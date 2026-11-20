/**
 * The five sandbox tools of the hub MCP endpoint (spec 136 S5). Every handler acts for the
 * key's org through the existing sandbox service; none returns business data rows.
 */
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  datasetCatalog,
  LIBRARY_PAGE,
  listElements,
  listPages,
  removeElement,
  upsertElement,
  type SandboxElementInput,
} from '$server/sandbox/sandbox.service';
import { SandboxQueryError } from '$server/sandbox/query-compiler';
import { validateBlockSpec } from '$server/sandbox/blocks';
import { BLOCK_DESCRIPTIONS, BLOCK_EXAMPLES } from '$lib/sandbox/blocks/catalog';
import {
  BLOCK_KINDS,
  BUCKETS,
  CHART_PRESETS,
  FORMATS,
  RANGES,
  TONES,
  blockToolSchemas,
} from '$lib/sandbox/blocks/schema';
import { ToolFailure, type McpTool } from './protocol';

export interface SandboxToolContext {
  ctx: CoreCtx;
  keyId: string;
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

export const sandboxTools: McpTool<SandboxToolContext>[] = [
  {
    name: 'sandbox_datasets',
    description:
      "List the datasets a sandbox element can query in the viewer's browser, with column names and types. Returns schema only, never rows.",
    inputSchema: obj({}),
    call: async () => ({ datasets: datasetCatalog() }),
  },
  {
    name: 'sandbox_pages',
    description: "List this organization's sandbox pages with their element counts.",
    inputSchema: obj({}),
    call: async (_args, { ctx }) => ({ pages: await listPages(ctx) }),
  },
  {
    name: 'sandbox_elements',
    description: 'List the elements of one sandbox page.',
    inputSchema: obj({ page: { type: 'string', description: 'Page name; default "default".' } }),
    call: async (args, { ctx }) => ({
      elements: (await listElements(ctx, pageArg(args))).map(element),
    }),
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
    }),
    call: async (args, { ctx, keyId }) => {
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

sandboxTools.push(
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
    }),
  },
  ...blockTools,
);

/** Service refusals the model can act on (size limit, bad id, unknown element). */
export function sandboxFailure(e: unknown): string | null {
  if (!(e instanceof SandboxQueryError)) return null;
  return e.message === 'element not found' ? 'Element not found.' : e.message;
}
