// SvelteKit's $env/* virtual modules need the kit runtime (globalThis.__sveltekit_dev),
// which Storybook never boots. Expose PUBLIC_* vars from Vite's env instead; absent keys
// read as undefined, same as an unset public var in the app.
export const env: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(import.meta.env as Record<string, string>).filter(([k]) => k.startsWith('PUBLIC_')),
);
