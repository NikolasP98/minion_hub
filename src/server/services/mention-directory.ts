import { error, isHttpError } from '@sveltejs/kit';
import * as Sentry from '@sentry/sveltekit';
import { getPgClient } from '$server/db/pg-pool';
import {
  decodeMentionDirectory,
  directoryOwner,
  DIRECTORY_LIMIT,
  type DirectoryOwner,
} from '$lib/state/features/mention-directory-wire';

let lastReported = -Infinity;

function unavailable(): never {
  const now = Date.now();
  if (now - lastReported >= 60_000) {
    lastReported = now;
    try {
      Sentry.captureException(new Error('Mention directory storage unavailable'), {
        tags: { area: 'mention-directory', reason: 'storage-unavailable' },
        fingerprint: ['mention-directory', 'storage-unavailable'],
      });
    } catch {
      /* Telemetry cannot expose or replace the generic storage failure. */
    }
  }
  throw error(503, 'Mention directory is temporarily unavailable.');
}

/**
 * Profiles use self-only RLS, so this deliberately uses the existing privileged
 * server pool. Both admission and directory predicates are fixed and execute in
 * one read-only snapshot. No relation names or identity come from query parameters.
 */
export async function listMentionDirectory(input: DirectoryOwner) {
  const owner = directoryOwner(input.actorId, input.organizationId);
  if (!owner) throw error(403, 'Mention directory access is not permitted.');
  try {
    return await getPgClient().begin('isolation level repeatable read read only', async (tx) => {
      await tx`select set_config('statement_timeout', '5000', true)`;
      const members = await tx`
        select m.profile_id from public.organization_members m
        join public.organizations o on o.id=m.organization_id and o.status='active'
        join public.profiles p on p.id=m.profile_id
        where m.organization_id=${owner.organizationId}::uuid
          and m.profile_id=${owner.actorId}::uuid
        limit 1`;
      if (members.length !== 1) throw error(403, 'Mention directory access is not permitted.');
      const rows = await tx<{ id: string; alias: string }[]>`
        select p.id::text,p.alias from public.organization_members m
        join public.profiles p on p.id=m.profile_id
        where m.organization_id=${owner.organizationId}::uuid and p.alias is not null
        order by p.id limit ${DIRECTORY_LIMIT + 1}`;
      if (rows.length > DIRECTORY_LIMIT) unavailable();
      const response = {
        ...owner,
        aliases: Object.fromEntries(rows.map((row) => [row.id, row.alias])),
      };
      // Apply the same grammar/duplicate-alias rules before exposing the response.
      decodeMentionDirectory(response, owner);
      return response;
    });
  } catch (failure) {
    if (isHttpError(failure) && [403, 503].includes(failure.status)) throw failure;
    unavailable();
  }
}
