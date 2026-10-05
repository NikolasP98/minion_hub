import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  notificationCatalogManifest,
  assertNotificationCatalogRevision,
} from '../src/lib/notifications/catalog-manifest';

const file = new URL('../src/lib/notifications/catalog.manifest.json', import.meta.url);
const generated = notificationCatalogManifest();
if (process.argv.includes('--write')) {
  writeFileSync(file, generated);
  writeFileSync(
    new URL('../src/lib/notifications/catalog.revision.json', import.meta.url),
    JSON.stringify(
      {
        revision: JSON.parse(generated).revision,
        sha256: createHash('sha256').update(generated).digest('hex'),
      },
      null,
      2,
    ) + '\n',
  );
} else if (readFileSync(file, 'utf8') !== generated)
  throw new Error(
    'Notification catalog manifest drift; review the catalog revision before regeneration.',
  );
else {
  const base = process.env.NOTIFICATION_CATALOG_BASE_REF;
  if (!base || !/^[a-f0-9]{40,64}$/.test(base))
    throw new Error('An exact NOTIFICATION_CATALOG_BASE_REF commit is required');
  const exists = spawnSync('git', ['cat-file', '-e', base], { encoding: 'utf8' });
  if (exists.status !== 0) throw new Error('Notification catalog comparison commit is unavailable');
  const listed = spawnSync(
    'git',
    ['ls-tree', '--name-only', base, '--', 'src/lib/notifications/catalog.manifest.json'],
    { encoding: 'utf8' },
  );
  if (listed.status !== 0) throw new Error('Cannot inspect notification catalog comparison tree');
  if (listed.stdout.trim()) {
    const historical = spawnSync(
      'git',
      ['show', `${base}:src/lib/notifications/catalog.manifest.json`],
      { encoding: 'utf8', maxBuffer: 128 * 1024 },
    );
    if (historical.status !== 0) throw new Error('Cannot read previous notification catalog');
    assertNotificationCatalogRevision(historical.stdout, generated);
  }
  console.log('Notification catalog manifest and revision admission passed');
}
