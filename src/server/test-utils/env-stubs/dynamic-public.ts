/**
 * Vitest stub for SvelteKit's `$env/dynamic/public` virtual module.
 * Exposes only PUBLIC_-prefixed process.env vars, mirroring SvelteKit.
 */
const publicEnv: Record<string, string | undefined> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('PUBLIC_')) publicEnv[key] = value;
}
export const env: Record<string, string | undefined> = publicEnv;
