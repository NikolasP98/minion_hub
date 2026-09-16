#!/usr/bin/env bun
/**
 * `bun run qa:extend [--ttl 1h]` — spec §5. Re-arms the TTL timer from now
 * (disarms whatever was armed and starts a fresh one). Defaults to 2h like
 * qa:up when --ttl is omitted.
 */
import { pathToFileURL } from 'node:url';
import { armTtl, formatDuration, parseTtl } from './ttl';

const argv = process.argv.slice(2);
const ttlArgIdx = argv.indexOf('--ttl');
const ttlSeconds = parseTtl(ttlArgIdx === -1 ? undefined : argv[ttlArgIdx + 1]);

function main(): void {
  const { mode, deadline } = armTtl(ttlSeconds);
  console.log(`qa:extend — re-armed (${mode}): ${formatDuration(ttlSeconds)} from now`);
  console.log(`  Teardown: ${deadline.toLocaleString()} (${deadline.toISOString()})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
