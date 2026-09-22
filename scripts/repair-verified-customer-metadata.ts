/**
 * Fill missing authoritative identity fields for already DNI-verified people.
 *
 * Safe by default: without --apply this only reports aggregate counts and makes
 * no provider calls. Apply mode re-queries PERUDEVS only for incomplete rows,
 * then uses guarded fill-only updates. Existing name, DOB, and sex are never
 * overwritten. A private, gitignored recovery/audit file is written under data/.
 *
 *   bun scripts/repair-verified-customer-metadata.ts
 *   bun scripts/repair-verified-customer-metadata.ts --apply
 *   bun scripts/repair-verified-customer-metadata.ts --apply --refresh-cache
 */
import { chmod, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import {
  ageFromDob,
  canonicalSex,
  dniNameMatches,
  formatRegistryName,
  lookupDni,
  parseDob,
} from '@minion-stack/crm-sdk';
import type { DniLookupResult, PerudevsPerson } from '@minion-stack/crm-sdk';

export type MissingFields = { name: boolean; dob: boolean; sex: boolean };

export function missingFields(row: {
  name: string | null;
  dob: string | null;
  sex: string | null;
  registry_name: string | null;
}): MissingFields {
  return {
    name: !row.name?.trim(),
    dob: !row.dob,
    sex: !row.sex?.trim(),
  };
}

export function identityNamesMatch(
  partyName: string | null,
  priorRegistryName: string | null,
  person: PerudevsPerson,
): boolean {
  if (!priorRegistryName?.trim() || !dniNameMatches(priorRegistryName, person)) return false;
  return !partyName?.trim() || dniNameMatches(partyName, person);
}

const apply = process.argv.includes('--apply');
const refreshCache = process.argv.includes('--refresh-cache');
const dbUrl = process.env.SUPABASE_DB_URL?.trim();
const apiKey = process.env.PERUDEVS_API_KEY?.trim();
const evidenceDir = 'data/repair-evidence';

function documentHash(document: string): string {
  return createHash('sha256').update(document).digest('hex');
}

async function cachedLookup(document: string, key: string): Promise<DniLookupResult> {
  const path = `${evidenceDir}/perudevs-${documentHash(document)}.json`;
  if (!refreshCache) {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as DniLookupResult;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const result = await lookupDni(document, key);
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await Bun.write(path, JSON.stringify(result));
  await chmod(path, 0o600);
  return result;
}

interface Candidate {
  id: string;
  org_id: string;
  doc_number: string;
  name: string | null;
  dob: string | null;
  sex: string | null;
  registry_name: string | null;
}

interface EvidenceRow {
  partyId: string;
  documentHash: string;
  missingBefore: MissingFields;
  previousValues: { name?: string | null; dob?: string | null; sex?: string | null };
  filled: string[];
  validation?: string;
  outcome: 'updated' | 'not_found' | 'provider_error' | 'invalid_provider_data' | 'guard_rejected';
}

async function main(): Promise<void> {
  if (!dbUrl) throw new Error('SUPABASE_DB_URL not set (check .env.local)');
  if (apply && !apiKey) throw new Error('PERUDEVS_API_KEY not set (check .env.local)');

  const db = postgres(dbUrl, { prepare: false, max: 1 });
  try {
    const [audit] = await db<
      Array<{
        verified_total: number;
        verified_people: number;
        verified_companies: number;
        verified_people_without_dni: number;
      }>
    >`
      select
        count(*)::int as verified_total,
        count(*) filter (where type = 'person')::int as verified_people,
        count(*) filter (where type = 'company')::int as verified_companies,
        count(*) filter (
          where type = 'person' and (doc_number is null or doc_number !~ '^[0-9]{8}$')
        )::int
          as verified_people_without_dni
      from parties where dni_verified = true
    `;
    const candidates = (await db<Candidate[]>`
      select id, org_id, doc_number, name, dob::text,
             metadata->'dni_registry'->>'sex' as sex,
             metadata->'dni_registry'->>'nombre_completo' as registry_name
      from parties
      where type = 'person'
        and dni_verified = true
        and doc_number ~ '^[0-9]{8}$'
        and (
          nullif(btrim(name), '') is null
          or dob is null
          or nullif(metadata->'dni_registry'->>'sex', '') is null
        )
      order by org_id, id
    `) as Candidate[];

    const counts = candidates.reduce(
      (acc, row) => {
        const missing = missingFields(row);
        if (missing.name) acc.name += 1;
        if (missing.dob) acc.dob += 1;
        if (missing.sex) acc.sex += 1;
        return acc;
      },
      { candidates: candidates.length, name: 0, dob: 0, sex: 0 },
    );
    console.log(
      JSON.stringify({ mode: apply ? 'apply' : 'dry-run', audit, eligibleIncomplete: counts }),
    );
    if (!apply || candidates.length === 0) return;

    const evidence: EvidenceRow[] = [];
    for (const row of candidates) {
      const before = missingFields(row);
      const result = await cachedLookup(row.doc_number, apiKey!);
      const base = {
        partyId: row.id,
        documentHash: documentHash(row.doc_number),
        missingBefore: before,
        previousValues: {
          ...(before.name ? { name: row.name } : {}),
          ...(before.dob ? { dob: row.dob } : {}),
          ...(before.sex ? { sex: row.sex } : {}),
        },
        filled: [] as string[],
      };
      if (result.status === 'not_found') {
        evidence.push({ ...base, outcome: 'not_found' });
        continue;
      }
      if (result.status === 'error') {
        evidence.push({ ...base, outcome: 'provider_error' });
        continue;
      }

      // PERUDEVS does not document `person.id` as the queried DNI (and live
      // responses prove it is not an echo). Identity is instead established by
      // the request-bound lookup contract plus two independently stored names:
      // the party name and the earlier verified registry payload must both
      // unambiguously match this response.
      if (!identityNamesMatch(row.name, row.registry_name, result.person)) {
        evidence.push({ ...base, outcome: 'invalid_provider_data' });
        continue;
      }

      const officialName = formatRegistryName(result.person);
      const dob = parseDob(result.person.fecha_nacimiento);
      const sex = canonicalSex(result.person.genero);
      const age = ageFromDob(dob);
      // TODO(handoff): Seven production-verified customers still have no DOB because
      // PERUDEVS returned an empty fecha_nacimiento on 2026-09-21. Re-run with a
      // refreshed authoritative response once the provider or another exact-DOB
      // source is available; never infer an exact date from legacy custom_fields.edad.
      // See proposals/2026-09-21-hub-customer-identity-guardians.md.
      if (
        (before.name && !officialName) ||
        (before.dob && (!dob || age === null)) ||
        (before.sex && !sex)
      ) {
        evidence.push({ ...base, outcome: 'invalid_provider_data' });
        continue;
      }

      const repairStamp = JSON.stringify({
        repaired_at: new Date().toISOString(),
        repair_source: 'perudevs',
      });
      const updated = await db.begin(async (tx) => {
        const rows = await tx<{ id: string }[]>`
          update parties set
            name = case
              when ${before.name} and nullif(btrim(name), '') is null then ${officialName}
              else name end,
            dob = case when ${before.dob} and dob is null then ${dob}::date else dob end,
            metadata = metadata || jsonb_build_object(
              'dni_registry',
              coalesce(metadata->'dni_registry', '{}'::jsonb)
              || jsonb_strip_nulls(jsonb_build_object(
                'sex', case
                  when ${before.sex} and nullif(metadata->'dni_registry'->>'sex', '') is null
                  then ${sex}::text else null end,
                'dob', case
                  when ${before.dob} and dob is null then ${dob}::text else null end
              ))
              || ${repairStamp}::jsonb
            ),
            updated_at = now()
          where id = ${row.id}
            and org_id = ${row.org_id}
            and type = 'person'
            and dni_verified = true
            and doc_number = ${row.doc_number}
            and (
              (${before.name} and nullif(btrim(name), '') is null)
              or (${before.dob} and dob is null)
              or (${before.sex} and nullif(metadata->'dni_registry'->>'sex', '') is null)
            )
          returning id
        `;
        if (rows.length !== 1) return false;
        await tx`
          update crm_contacts set
            display_name = case
              when nullif(btrim(display_name), '') is null then ${officialName}
              else display_name
            end,
            updated_at = now()
          where party_id = ${row.id} and org_id = ${row.org_id} and deleted_at is null
            and ${before.name}
            and nullif(btrim(display_name), '') is null
        `;
        return true;
      });
      evidence.push({
        ...base,
        validation: 'request-bound lookup + party name match + prior registry name match',
        filled: updated
          ? [before.name && 'name', before.dob && 'dob', before.sex && 'sex'].filter(
              (field): field is string => Boolean(field),
            )
          : [],
        outcome: updated ? 'updated' : 'guard_rejected',
      });
    }

    await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replaceAll(':', '-');
    const evidencePath = `${evidenceDir}/verified-customer-metadata-${stamp}.json`;
    await Bun.write(
      evidencePath,
      JSON.stringify({ createdAt: new Date().toISOString(), evidence }, null, 2),
    );
    await chmod(evidencePath, 0o600);
    const totals = evidence.reduce<Record<string, number>>((acc, row) => {
      acc[row.outcome] = (acc[row.outcome] ?? 0) + 1;
      return acc;
    }, {});
    console.log(JSON.stringify({ evidencePath, outcomes: totals }));
  } finally {
    await db.end();
  }
}

if (import.meta.main) await main();
