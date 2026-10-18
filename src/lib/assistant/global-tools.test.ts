// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerGlobalTools } from './global-tools';
import { executeTool, type ModelContextTool } from './model-context';

const access = vi.hoisted(() => ({ allowed: true }));
vi.mock('$lib/access/can.svelte', () => ({ canViewPath: () => access.allowed }));
vi.mock('$lib/navigation', () => ({ goto: vi.fn() }));
import { goto } from '$lib/navigation';

afterEach(() => {
  access.allowed = true;
  vi.clearAllMocks();
  Reflect.deleteProperty(document, 'modelContext');
});

describe('registered navigation boundaries', () => {
  it('legacy and actual native callback both return proposals without navigation', async () => {
    const registered: ModelContextTool[] = [];
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: { registerTool: (tool: ModelContextTool) => registered.push(tool) },
    });
    const off = registerGlobalTools();
    try {
      const native = registered.find((tool) => tool.name === 'hub.navigate');
      expect(native).toBeDefined();
      const input = { path: '/pos/catalog', params: { q: 'a & b' } };
      const legacy = JSON.parse(await executeTool('hub.navigate', input));
      const result = JSON.parse(
        String(await native!.execute(input, { signal: new AbortController().signal })),
      );
      expect(result).toEqual(legacy);
      expect(result).toMatchObject({
        navigated: false,
        requiresUserAction: true,
        href: '/pos/catalog?q=a+%26+b',
      });
      expect(goto).not.toHaveBeenCalled();
      access.allowed = false;
      expect(
        JSON.parse(String(await native!.execute(input, { signal: new AbortController().signal }))),
      ).toHaveProperty('error');
    } finally {
      off();
    }
  });
});
