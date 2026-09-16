/**
 * Shared `npx supabase@<pinned>` invocation for the QA stack scripts
 * (env.ts, up.ts, down.ts).
 *
 * `npx` resolves package context from its cwd's nearest package.json before
 * it even looks at the requested package — and this repo's `overrides`
 * block (root package.json, unrelated to Supabase) makes npm's own
 * dependency-conflict check fail for ANY `npx` invocation whose cwd is
 * inside this checkout: `npm error code EOVERRIDE`. Running from a neutral
 * cwd (os.tmpdir()) sidesteps that; `--workdir` tells the Supabase CLI where
 * `supabase/config.toml` actually lives.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { tmpdir } from 'node:os';

export const SUPABASE_CLI_SPEC = 'supabase@2.101.0';

export function spawnSupabaseCli(
  args: string[],
  root: string,
  opts: SpawnSyncOptions = {},
): ReturnType<typeof spawnSync> {
  return spawnSync('npx', ['--yes', SUPABASE_CLI_SPEC, ...args, '--workdir', root], {
    cwd: tmpdir(),
    ...opts,
  });
}
