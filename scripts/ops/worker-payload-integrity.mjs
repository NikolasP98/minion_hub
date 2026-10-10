#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { chmod, lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [command, rootArgument, ownershipOption] = process.argv.slice(2);
if (!['create', 'verify'].includes(command) || !rootArgument) throw new Error('usage');
const root = path.resolve(rootArgument);
const receiptName = '.payload-integrity.json';
const requireRootOwned = ownershipOption === '--require-root-owned';

async function requireSecureEntry(absolute, expectedMode, expectedType) {
  const info = await lstat(absolute);
  if (info.isSymbolicLink()) throw new Error('payload_link');
  if (expectedType === 'directory' && !info.isDirectory()) throw new Error('payload_type');
  if (expectedType === 'file' && !info.isFile()) throw new Error('payload_type');
  if (requireRootOwned && (info.uid !== 0 || (info.mode & 0o777) !== expectedMode)) {
    throw new Error('payload_ownership');
  }
  return info;
}

async function inventory(directory = root) {
  await requireSecureEntry(directory, 0o555, 'directory');
  const entries = [];
  for (const name of (await readdir(directory)).sort()) {
    if (directory === root && [receiptName, '.manifest.json'].includes(name)) continue;
    const absolute = path.join(directory, name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const preliminary = await lstat(absolute);
    const expectedMode = preliminary.isDirectory()
      ? 0o555
      : ['minion-hub-notification-worker-launcher', 'verify-disabled-worker.sh'].includes(name)
        ? 0o555
        : 0o444;
    const info = await requireSecureEntry(absolute, expectedMode, undefined);
    if (info.isDirectory()) {
      entries.push(...(await inventory(absolute)));
    } else if (info.isFile()) {
      const bytes = await readFile(absolute);
      entries.push({
        path: relative,
        type: 'file',
        mode: info.mode & 0o777,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    } else {
      throw new Error('payload_type');
    }
  }
  return entries;
}

if (command === 'create') {
  const normalize = async (directory = root) => {
    for (const name of await readdir(directory)) {
      const absolute = path.join(directory, name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error('payload_link');
      if (info.isDirectory()) {
        await normalize(absolute);
        await chmod(absolute, 0o755);
      } else if (info.isFile()) {
        await chmod(
          absolute,
          ['minion-hub-notification-worker-launcher', 'verify-disabled-worker.sh'].includes(name)
            ? 0o555
            : 0o444,
        );
      } else throw new Error('payload_type');
    }
  };
  await normalize();
  await writeFile(path.join(root, receiptName), `${JSON.stringify(await inventory())}\n`, {
    flag: 'wx',
    mode: 0o444,
  });
} else {
  await requireSecureEntry(path.join(root, receiptName), 0o444, 'file');
  if (requireRootOwned) {
    await requireSecureEntry(path.join(root, '.manifest.json'), 0o444, 'file');
  }
  const expected = JSON.parse(await readFile(path.join(root, receiptName), 'utf8'));
  const actual = await inventory();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('payload_integrity');
}
