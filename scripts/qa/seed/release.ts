/**
 * App changelog (spec 2026-10-10-hub-inbox-notifications-reminders, Slice 3).
 * One seeded release so `/changelog` and the release-notes route tests have a
 * row to read against.
 */
import { matrixUuid } from './ids';
import type { SeedContext } from './db';

export const RELEASE_QA = matrixUuid('release.app_release.qa');

export async function seed(ctx: SeedContext): Promise<void> {
  const { sql, register } = ctx;

  await sql`
    insert into app_releases (id, version, released_at, sections, prs)
    values (
      ${RELEASE_QA},
      'hub-v2026.10.10',
      now(),
      ${sql.json({
        Nuevo: { pos: ['QA seeded release notice'] },
        Arreglado: {},
        Interno: {},
      })},
      ${sql.json([{ number: 1, title: 'feat(pos): QA seeded release notice', url: 'https://example.invalid/pr/1' }])}
    )
    on conflict (version) do update set released_at = excluded.released_at
  `;

  register('release.app_release.qa', { table: 'app_releases', where: { id: RELEASE_QA } });
}
