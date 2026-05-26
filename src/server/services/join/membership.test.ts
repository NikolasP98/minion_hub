import { describe, test, expect } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { member, user, organization } from '@minion-stack/db/schema';
import { createMembership } from './membership';

function freshDb() {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);
  return { db, client };
}

describe('createMembership', () => {
  test('inserts member + ensures user row; idempotent', async () => {
    const { db } = freshDb();
    await db.run(
      `create table organization (id text primary key, name text not null, slug text, logo text, created_at integer not null, metadata text)`,
    );
    await db.run(
      `create table "user" (id text primary key, name text not null, email text not null unique, email_verified integer not null, image text, created_at integer not null, updated_at integer not null, role text not null default 'user', personal_agent_id text)`,
    );
    await db.run(
      `create table member (id text primary key, organization_id text not null, user_id text not null, role text not null, created_at integer not null)`,
    );
    await db
      .insert(organization)
      .values({ id: 'org1', name: 'Org', slug: 'org', createdAt: new Date(0) });

    await createMembership(db as any, { id: 'u1', email: 'a@b.c', displayName: 'A' }, 'org1', 'user');
    // idempotent — second call must not throw or duplicate
    await createMembership(db as any, { id: 'u1', email: 'a@b.c', displayName: 'A' }, 'org1', 'user');

    const members = await db.select().from(member).where(eq(member.userId, 'u1'));
    const users = await db.select().from(user).where(eq(user.id, 'u1'));
    expect(members.length).toBe(1);
    expect(users.length).toBe(1);
  });
});
