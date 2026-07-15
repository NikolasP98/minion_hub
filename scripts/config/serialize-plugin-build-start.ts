type BuildStartHook = (this: unknown, ...args: unknown[]) => unknown;

/**
 * Run a plugin's initial buildStart hook once per plugin instance.
 *
 * Vite 8 can invoke legacy Rollup buildStart hooks concurrently for its client
 * and SSR environments. Paraglide 1.x's memoizer returns `undefined` to the
 * second caller while the first compile is still writing files, which lets SSR
 * import the generated runtime before it exists. Sharing the in-flight promise
 * keeps both environments behind the same completed compile.
 */
export function serializePluginBuildStart<T extends { buildStart?: unknown }>(plugin: T): T {
  if (typeof plugin.buildStart !== 'function') return plugin;

  const originalBuildStart = plugin.buildStart as BuildStartHook;
  let initialBuild: Promise<unknown> | undefined;

  plugin.buildStart = function serializedBuildStart(this: unknown, ...args: unknown[]) {
    initialBuild ??= Promise.resolve(originalBuildStart.apply(this, args));
    return initialBuild;
  };

  return plugin;
}
