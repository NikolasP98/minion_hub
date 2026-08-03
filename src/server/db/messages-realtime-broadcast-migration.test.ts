import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260725223000_messages_realtime_broadcast.sql',
    import.meta.url,
  ),
  'utf8',
).replace(/\s+/g, ' ');

describe('messages Realtime Broadcast migration', () => {
  it('emits one compact private event only after a new message commits', () => {
    expect(migration).toMatch(/after insert on public\.messages/i);
    expect(migration).toMatch(/perform realtime\.send\(/i);
    expect(migration).toMatch(/'message\.committed'/i);
    expect(migration).toMatch(/'org:' \|\| new\.org_id \|\| ':events'/i);
    expect(migration).toMatch(/'occurredAt', coalesce\(new\.occurred_at, new\.created_at\)/i);
    expect(migration).not.toMatch(/'content', new\.content/i);
    expect(migration).not.toMatch(/after insert or update or delete/i);
  });

  it('authorizes receives by exact topic and active Supabase membership', () => {
    expect(migration).toMatch(/for select to authenticated/i);
    expect(migration).toMatch(/membership\.profile_id = \(select auth\.uid\(\)\)/i);
    expect(migration).toMatch(
      /realtime\.topic\(\)\) = 'org:' \|\| membership\.organization_id::text \|\| ':events'/i,
    );
    expect(migration).not.toMatch(/for insert to authenticated/i);
  });
});
