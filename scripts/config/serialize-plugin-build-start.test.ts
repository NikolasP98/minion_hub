import { describe, expect, it } from 'vitest';
import { serializePluginBuildStart } from './serialize-plugin-build-start';

describe('serializePluginBuildStart', () => {
  it('shares one in-flight build across concurrent environment starts', async () => {
    let releaseBuild!: () => void;
    const buildGate = new Promise<void>((resolve) => {
      releaseBuild = resolve;
    });
    let calls = 0;

    const plugin = serializePluginBuildStart({
      async buildStart() {
        calls += 1;
        await buildGate;
        return 'compiled';
      },
    });

    const first = plugin.buildStart();
    const second = plugin.buildStart();

    expect(calls).toBe(1);
    releaseBuild();
    await expect(Promise.all([first, second])).resolves.toEqual(['compiled', 'compiled']);
    expect(calls).toBe(1);
  });
});
