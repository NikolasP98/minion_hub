import { describe, expect, it } from 'vitest';
import { discoverApiHandlers, scanFrontendContracts } from './frontend-contract-scanner';

const projectRoot = process.cwd();

describe('frontend route and API contracts', () => {
  it('resolves identifiable navigation and frontend API calls to tracked handlers', () => {
    const report = scanFrontendContracts(projectRoot);

    expect(report.pages).toBe(146);
    expect(report.apiHandlers).toBeGreaterThan(340);
    expect(report.navigationReferences.length).toBeGreaterThan(200);
    expect(report.apiCalls.length).toBeGreaterThan(300);
    expect(report.unresolvedNavigation).toEqual([]);
    expect(report.unresolvedApiCalls).toEqual([]);
    expect(report.methodMismatches).toEqual([]);
    expect(
      report.ambiguousApiCalls.map(({ sourceFile, value, method, handlerPatterns }) => ({
        sourceFile,
        value,
        method,
        handlerPatterns,
      })),
    ).toEqual([
      {
        sourceFile: 'src/lib/components/builder/BuilderHub.svelte',
        value: '/api/builder/__DYNAMIC__/__DYNAMIC__',
        method: 'DELETE',
        handlerPatterns: [
          '/api/builder/agents/[id]',
          '/api/builder/skills/[id]',
          '/api/builder/tools/[id]',
        ],
      },
    ]);
  });

  it('discovers at least one exported method for every API handler file', () => {
    const handlers = discoverApiHandlers(projectRoot);
    expect(handlers.filter((handler) => handler.methods.length === 0)).toEqual([]);
    expect(new Set(handlers.map((handler) => handler.pattern)).size).toBe(handlers.length);
  });
});
