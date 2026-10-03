import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../../supabase/migrations/20261003100000_meta_sync_leases.sql', import.meta.url),
  'utf8',
).replace(/\s+/g, ' ');

describe('Meta sync lease migration contract', () => {
  it('requires both lease fields for running rows and clears both for every non-running row', () => {
    expect(migration).toContain(
      "(status = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR (status <> 'running' AND lease_owner IS NULL AND lease_expires_at IS NULL)",
    );
    expect(migration).toContain('lease_generation = lease_generation + 1');
  });

  it('bounds the renewal query and makes every authority decision with the live database clock', () => {
    expect(migration).toContain("SET lock_timeout = '4s'");
    expect(migration).toContain("SET statement_timeout = '5s'");
    expect(migration).toContain('lease_expires_at = clock_timestamp() + make_interval');
    expect(migration).toContain('lease_expires_at > clock_timestamp()');
  });

  it('forces organization RLS and binds active effects to the same media identity', () => {
    expect(migration).toContain(
      'ALTER TABLE public.meta_media_mirror_effects FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain(
      'FOREIGN KEY (org_id, platform, post_id, active_effect_id) REFERENCES public.meta_media_mirror_effects (org_id, platform, post_id, id)',
    );
    expect(migration).toContain("WHERE state = 'active'");
    expect(migration).toContain('ON public.meta_media_mirror_effects (state, next_cleanup_at, id)');
  });
});
