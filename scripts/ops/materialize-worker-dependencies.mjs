#!/usr/bin/env node
import { copyFile, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

if (process.argv.length !== 4) throw new Error('usage');
const source = await realpath(process.argv[2]);
const destination = path.resolve(process.argv[3]);
if (!(await stat(source)).isDirectory()) throw new Error('materialize_root');
await mkdir(destination, { mode: 0o755 });

async function copyDirectory(current, target, ancestors) {
  const resolved = await realpath(current);
  if (resolved !== source && !resolved.startsWith(`${source}${path.sep}`))
    throw new Error('dependency_outside_root');
  const info = await stat(resolved);
  const identity = `${info.dev}:${info.ino}`;
  if (ancestors.has(identity)) throw new Error('dependency_cycle');
  const next = new Set([...ancestors, identity]);
  for (const name of (await readdir(resolved)).sort()) {
    if (['.env', '.env.local', 'worker.env'].includes(name)) continue;
    const item = path.join(resolved, name);
    const output = path.join(target, name);
    const resolvedItem = await realpath(item);
    if (resolvedItem !== source && !resolvedItem.startsWith(`${source}${path.sep}`))
      throw new Error('dependency_outside_root');
    const itemInfo = await stat(resolvedItem);
    if (itemInfo.isDirectory()) {
      await mkdir(output, { mode: 0o755 });
      await copyDirectory(item, output, next);
    } else if (itemInfo.isFile()) {
      await copyFile(resolvedItem, output, constants.COPYFILE_EXCL);
    } else {
      throw new Error('dependency_type');
    }
  }
}

await copyDirectory(source, destination, new Set());
