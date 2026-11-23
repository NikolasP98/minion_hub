import { describe, expect, it, vi } from 'vitest';
import { seedBrandingFixtures, userId } from './tenancy';
import { personaEmail } from './ids';
import type { RowRef } from './db';

describe('branding seed canonical GoTrue identity', () => {
  it.each(['existing-email', 'server-assigned'] as const)(
    'uses %s returned ids for profiles, memberships and role assignments',
    async (mode) => {
      const users = ['owner', 'staff', 'admin'].map((suffix, index) => ({
        email: personaEmail(`tenancy.user.branding-${suffix}`),
        id: `40000000-0000-4000-8000-00000000000${index}`,
      }));
      const writes: { sql: string; values: unknown[] }[] = [];
      const query = async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        writes.push({ sql, values });
        if (sql.includes('select personal_agent_id')) return [{ personal_agent_id: null }];
        return [];
      };
      const sql = Object.assign(query, {
        begin: (run: (tx: typeof query) => Promise<void>) => run(query),
      });
      const registered = new Map<string, RowRef>();
      const admin = {
        auth: {
          admin: {
            listUsers: vi.fn(async () => ({
              data: { users: mode === 'existing-email' ? users : [] },
              error: null,
            })),
            updateUserById: vi.fn(async () => ({ error: null })),
            createUser: vi.fn(async ({ email }: { email: string }) => ({
              data: { user: users.find((user) => user.email === email) },
              error: null,
            })),
          },
        },
      };
      await seedBrandingFixtures({
        sql,
        admin,
        now: new Date(),
        register: (id, ref) => registered.set(id, ref),
      } as unknown as Parameters<typeof seedBrandingFixtures>[0]);
      for (const [index, suffix] of ['owner', 'staff', 'admin'].entries()) {
        const persona = `tenancy.user.branding-${suffix}`;
        expect(users[index].id).not.toBe(userId(persona));
        expect(registered.get(persona)?.where.id).toBe(users[index].id);
      }
      const members = writes.filter((write) =>
        write.sql.includes('insert into organization_members'),
      );
      const roles = writes.filter((write) => write.sql.includes('insert into member_roles'));
      expect(members).toHaveLength(15);
      expect(roles).toHaveLength(15);
      for (const write of [...members, ...roles])
        expect(users.map((user) => user.id)).toContain(write.values[1]);
    },
  );
});
