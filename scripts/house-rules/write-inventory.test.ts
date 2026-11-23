/**
 * Write inventory (spec 138 H5): every write endpoint method is gated by the prefix table or
 * requireOrgCapability, or its file is listed in write-inventory.json with a class. Refresh after
 * fixing or adding a listed file (new files enter as `todo`; the todo ceiling may only fall):
 *   HOUSE_RULES_UPDATE=1 bunx vitest run scripts/house-rules/write-inventory.test.ts
 * First creation only: HOUSE_RULES_INIT=1 writes every uncovered file as `todo`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  diffInventory,
  inventory,
  mergeInventory,
  urlFor,
  writeHandlers,
  type Inventory,
} from './write-inventory';

const ROOT = process.cwd();
const PATH = join(ROOT, 'scripts/house-rules/write-inventory.json');
const save = (inv: Inventory) => writeFileSync(PATH, JSON.stringify(inv, null, 2) + '\n');

const tmpRoots: string[] = [];
afterAll(() => tmpRoots.forEach((r) => rmSync(r, { recursive: true, force: true })));
function fixtureRoot(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'write-inventory-'));
  tmpRoots.push(root);
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), text);
  }
  return root;
}

describe('write inventory', () => {
  it('the real tree equals the committed inventory', () => {
    const { found } = inventory(ROOT);
    if (process.env.HOUSE_RULES_INIT === '1')
      save(mergeInventory(found, { todoCeiling: found.length, entries: [] }));
    const committed: Inventory = JSON.parse(readFileSync(PATH, 'utf8'));
    if (process.env.HOUSE_RULES_UPDATE === '1') {
      const next = mergeInventory(found, committed);
      const over = diffInventory(found, { ...next, todoCeiling: committed.todoCeiling }).filter(
        (v) => v.kind === 'todo-ceiling',
      );
      expect(over).toEqual([]);
      save(next);
      return;
    }
    expect(diffInventory(found, committed)).toEqual([]);
  });

  it('D11: a new ungated write endpoint is reported as new, a gated one is not', () => {
    const root = fixtureRoot({
      'src/routes/api/widgets/[id]/+server.ts':
        'export const PATCH: RequestHandler = async ({ locals }) => { const ctx = getCoreCtx(locals); return json({}); };\nexport const GET = () => json({});',
      'src/routes/api/gadgets/(g)/+server.ts':
        "export const POST: RequestHandler = async (e) => { await requireOrgCapability(e, 'crm', 'edit'); return json({}); };",
      'src/routes/api/pos/tickets/+server.ts': 'export const POST = async () => json({});',
    });
    const { found, stats } = inventory(root);
    expect(found).toEqual([
      { file: 'src/routes/api/widgets/[id]/+server.ts', methods: ['PATCH'], guard: 'ctx-only' },
    ]);
    expect(stats).toMatchObject({ files: 3, handlers: 3, uncoveredFiles: 1 });
    expect(diffInventory(found, { todoCeiling: 9, entries: [] }).map((v) => v.kind)).toEqual([
      'new',
    ]);
  });

  it('resolves handlers that name a function or const, and builds URLs', () => {
    const h = writeHandlers(
      'const run = async () => { requireOrgCapability(); };\nasync function go() { return 1; }\nexport const POST = run;\nexport { go as DELETE };\nexport const PUT = async () => { /* requireOrgCapability */ };',
    );
    expect(h.POST).toContain('requireOrgCapability');
    expect(h.DELETE).toContain('return 1');
    expect(h.PUT).not.toContain('requireOrgCapability');
    expect(urlFor('src/routes/api/a/(grp)/[id]/b/[...path]/+server.ts')).toBe('/api/a/x/b/x');
  });

  it('D12: diffInventory reports changed, stale and a todo count above the ceiling', () => {
    const e = (file: string, cls: string) => ({
      file,
      methods: ['POST'],
      guard: 'none' as const,
      class: cls,
      reason: 'r',
    });
    const committed = {
      todoCeiling: 1,
      entries: [e('a', 'todo'), e('b', 'todo'), e('c', 'public')],
    };
    const v = diffInventory(
      [
        { file: 'a', methods: ['POST', 'PUT'], guard: 'none' },
        { file: 'c', methods: ['POST'], guard: 'none' },
      ],
      committed,
    );
    expect(v.map((x) => `${x.kind}:${x.file ?? ''}`)).toEqual([
      'changed:a',
      'stale:b',
      'todo-ceiling:',
    ]);
    const merged = mergeInventory(
      [
        { file: 'a', methods: ['POST'], guard: 'none' },
        { file: 'n', methods: ['POST'], guard: 'none' },
      ],
      committed,
    );
    expect(merged.entries.map((x) => `${x.file}:${x.class}`)).toEqual(['a:todo', 'n:todo']);
    expect(merged.todoCeiling).toBe(1);
  });
});
