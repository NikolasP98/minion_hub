import { describe, expect, it } from 'vitest';
import pg17Expected from './catalog-fingerprint.pg17.expected.json';
import pg18Expected from './catalog-fingerprint.pg18.expected.json';
import pg17ProdProbe from './catalog-fingerprint.pg17.prod-probe.json';
import { notificationProjectionCatalogMatches } from './catalog-fingerprint';

type MutableRecord = Record<string, unknown>;

const selfReachability = [
  'app_notification_worker',
  'notification_event_trigger',
  'notification_projection_finalizer',
].flatMap((role) =>
  ['MEMBER', 'SET', 'USAGE'].map((mode) => ({ mode, source: role, target: role })),
);

function snapshot(serverMajor: 17 | 18): MutableRecord {
  const sessionUser = serverMajor === 17 ? 'postgres' : 'minion_qc';
  const common = structuredClone(serverMajor === 17 ? pg17Expected : pg18Expected) as MutableRecord;
  common.sourceRelations = (common.sourceRelations as MutableRecord[]).map((relation) => ({
    ...relation,
    owner: sessionUser,
  }));
  common.operationalRelations = (common.operationalRelations as MutableRecord[]).map(
    (relation) => ({
      ...relation,
      owner: sessionUser,
    }),
  );
  return {
    serverMajor,
    sessionUser,
    sessionRole:
      serverMajor === 17
        ? {
            rolname: 'postgres',
            rolcanlogin: true,
            rolsuper: false,
            rolinherit: true,
            rolcreaterole: true,
            rolcreatedb: true,
            rolreplication: true,
            rolbypassrls: true,
          }
        : {
            rolname: 'minion_qc',
            rolcanlogin: true,
            rolsuper: true,
            rolinherit: true,
            rolcreaterole: true,
            rolcreatedb: true,
            rolreplication: true,
            rolbypassrls: true,
          },
    sourceOwnerEdges:
      serverMajor === 17
        ? [
            ...['anon', 'authenticated', 'service_role'].flatMap((target) => [
              {
                member: 'authenticator',
                target,
                grantor: 'supabase_admin',
                set_option: true,
                admin_option: false,
                inherit_option: false,
              },
              {
                member: 'postgres',
                target,
                grantor: 'supabase_admin',
                set_option: true,
                admin_option: true,
                inherit_option: true,
              },
            ]),
            ...['app_ledger', 'app_notification_worker'].flatMap((target) => [
              {
                member: 'postgres',
                target,
                grantor: 'postgres',
                set_option: true,
                admin_option: false,
                inherit_option: true,
              },
              {
                member: 'postgres',
                target,
                grantor: 'supabase_admin',
                set_option: false,
                admin_option: true,
                inherit_option: false,
              },
            ]),
          ]
        : [
            {
              member: 'minion_qc',
              target: 'app_notification_worker',
              grantor: 'minion_qc',
              set_option: true,
              admin_option: false,
              inherit_option: true,
            },
          ],
    sourceReachability:
      serverMajor === 17
        ? [
            ...[
              'anon',
              'app_ledger',
              'app_notification_worker',
              'authenticated',
              'postgres',
              'service_role',
            ].flatMap((role) =>
              ['MEMBER', 'SET', 'USAGE'].map((mode) => ({
                mode,
                source: role,
                target: role,
              })),
            ),
            ...['anon', 'authenticated', 'service_role'].flatMap((target) =>
              ['MEMBER', 'SET'].map((mode) => ({ mode, source: 'authenticator', target })),
            ),
            ...[
              'anon',
              'app_ledger',
              'app_notification_worker',
              'authenticated',
              'service_role',
            ].flatMap((target) =>
              ['MEMBER', 'SET', 'USAGE'].map((mode) => ({
                mode,
                source: 'postgres',
                target,
              })),
            ),
          ]
        : [
            'anon',
            'app_ledger',
            'app_notification_worker',
            'authenticated',
            'service_role',
          ].flatMap((role) =>
            ['MEMBER', 'SET', 'USAGE'].map((mode) => ({
              mode,
              source: role,
              target: role,
            })),
          ),
    platformEdges: [],
    ownerEdges:
      serverMajor === 17
        ? [
            {
              member: 'postgres',
              target: 'app_notification_worker',
              grantor: 'postgres',
              set_option: true,
              admin_option: false,
              inherit_option: true,
            },
            ...[
              'app_notification_worker',
              'notification_event_trigger',
              'notification_projection_finalizer',
            ].map((target) => ({
              member: 'postgres',
              target,
              grantor: 'supabase_admin',
              set_option: false,
              admin_option: true,
              inherit_option: false,
            })),
          ]
        : [
            {
              member: 'minion_qc',
              target: 'app_notification_worker',
              grantor: 'minion_qc',
              set_option: true,
              admin_option: false,
              inherit_option: true,
            },
          ],
    reachability:
      serverMajor === 17
        ? [
            ...selfReachability,
            { mode: 'MEMBER', source: 'postgres', target: 'app_notification_worker' },
            { mode: 'SET', source: 'postgres', target: 'app_notification_worker' },
            { mode: 'USAGE', source: 'postgres', target: 'app_notification_worker' },
            { mode: 'MEMBER', source: 'postgres', target: 'notification_event_trigger' },
            { mode: 'MEMBER', source: 'postgres', target: 'notification_projection_finalizer' },
          ]
        : selfReachability,
    ...common,
  };
}

function mutate(baseline: MutableRecord, mutation: (copy: MutableRecord) => void): MutableRecord {
  const copy = structuredClone(baseline);
  mutation(copy);
  return copy;
}

describe('notification projection catalog fingerprint', () => {
  it('admits only the exact reviewed PostgreSQL 17 and 18 catalog modes', () => {
    expect(notificationProjectionCatalogMatches(snapshot(17))).toBe(true);
    expect(notificationProjectionCatalogMatches(snapshot(18))).toBe(true);
    const pg18Bootstrap = snapshot(18);
    (pg18Bootstrap.sourceOwnerEdges as MutableRecord[]).push({
      member: 'minion_qc',
      target: 'app_ledger',
      grantor: 'minion_qc',
      set_option: true,
      admin_option: false,
      inherit_option: true,
    });
    expect(notificationProjectionCatalogMatches(pg18Bootstrap)).toBe(true);
    expect(notificationProjectionCatalogMatches({ ...snapshot(18), serverMajor: 19 })).toBe(false);
  });

  it('matches the 2026-10-07 production probe exactly (independent oracle)', () => {
    const probe = structuredClone(pg17ProdProbe) as MutableRecord;
    expect(probe.sourceReachability).toHaveLength(45);
    const production = mutate(snapshot(17), (copy) => {
      copy.sessionRole = probe.sessionRole;
      copy.platformEdges = probe.platformEdges;
      copy.sourceReachability = probe.sourceReachability;
    });
    expect(notificationProjectionCatalogMatches(production)).toBe(true);
  });

  it('admits the storage-admin chain only while the exact platform edge exists', () => {
    const probe = structuredClone(pg17ProdProbe) as MutableRecord;
    const rows45 = probe.sourceReachability as MutableRecord[];
    const rows39 = rows45.filter((row) => row.source !== 'supabase_storage_admin');
    expect(rows39).toHaveLength(39);
    const base = mutate(snapshot(17), (copy) => {
      copy.sessionRole = probe.sessionRole;
    });
    const withEdge = (edge: MutableRecord, rows: MutableRecord[]) =>
      mutate(base, (copy) => {
        copy.platformEdges = [edge];
        copy.sourceReachability = rows;
      });
    const edge = (probe.platformEdges as MutableRecord[])[0]!;

    expect(notificationProjectionCatalogMatches(withEdge(edge, rows45))).toBe(true);
    const noEdge45 = mutate(base, (copy) => {
      copy.platformEdges = [];
      copy.sourceReachability = rows45;
    });
    expect(notificationProjectionCatalogMatches(noEdge45), 'no edge, 45 rows').toBe(false);
    const noEdge39 = mutate(base, (copy) => {
      copy.platformEdges = [];
      copy.sourceReachability = rows39;
    });
    expect(notificationProjectionCatalogMatches(noEdge39), 'no edge, 39 rows').toBe(true);
    expect(
      notificationProjectionCatalogMatches(withEdge({ ...edge, inherit_option: true }, rows45)),
      'inheriting edge',
    ).toBe(false);
    expect(
      notificationProjectionCatalogMatches(withEdge({ ...edge, grantor: 'postgres' }, rows45)),
      'different grantor',
    ).toBe(false);
    expect(
      notificationProjectionCatalogMatches(withEdge({ ...edge, admin_option: true }, rows45)),
      'admin edge',
    ).toBe(false);
  });

  it('rejects every catalog authority class instead of trusting a digest', () => {
    const baseline = snapshot(18);
    const cases = [
      mutate(baseline, (copy) => {
        (copy.sourceRelations as MutableRecord[])[0]!.owner = 'foreign_owner';
      }),
      mutate(baseline, (copy) => {
        (copy.sourceRelations as MutableRecord[])[0]!.relrowsecurity = false;
      }),
      mutate(baseline, (copy) => {
        (copy.operationalRelations as MutableRecord[])[0]!.relforcerowsecurity = false;
      }),
      mutate(baseline, (copy) => {
        (copy.tableAcl as MutableRecord[]).push({
          relname: 'profiles',
          grantee: 'foreign_role',
          grantor: 'RELATION_OWNER',
          is_grantable: false,
          privileges: ['SELECT'],
        });
      }),
      mutate(baseline, (copy) => {
        (copy.columnAcl as MutableRecord[]).pop();
      }),
      mutate(baseline, (copy) => {
        (copy.operationalTableAcl as MutableRecord[]).push({
          relname: 'notification_projection_receipts',
          grantee: 'foreign_role',
          grantor: 'RELATION_OWNER',
          is_grantable: false,
          privileges: ['SELECT'],
        });
      }),
      mutate(baseline, (copy) => {
        (copy.sourceReachability as MutableRecord[]).push({
          mode: 'SET',
          source: 'foreign_source',
          target: 'authenticated',
        });
      }),
      mutate(baseline, (copy) => {
        (copy.sourcePolicies as MutableRecord[])[0]!.qual = 'true';
      }),
      mutate(baseline, (copy) => {
        (copy.operationalPolicies as MutableRecord[])[0]!.qual = 'true';
      }),
      mutate(baseline, (copy) => {
        (copy.operationalColumnAcl as MutableRecord[]).pop();
      }),
      mutate(baseline, (copy) => {
        (copy.sliceRoles as MutableRecord[])[0]!.rolinherit = true;
      }),
      mutate(baseline, (copy) => {
        (copy.ownerEdges as MutableRecord[]).push({
          member: 'foreign_role',
          target: 'notification_projection_finalizer',
          grantor: 'minion_qc',
          set_option: true,
          admin_option: false,
          inherit_option: true,
        });
      }),
      mutate(baseline, (copy) => {
        (copy.reachability as MutableRecord[]).push({
          mode: 'SET',
          source: 'foreign_role',
          target: 'notification_projection_finalizer',
        });
      }),
      mutate(baseline, (copy) => {
        (copy.functions as MutableRecord[])[0]!.prosrc = 'begin return new; end';
      }),
      mutate(baseline, (copy) => {
        ((copy.functions as MutableRecord[])[1]!.acl as MutableRecord[]).push({
          grantee: 'PUBLIC',
          grantor: 'notification_projection_finalizer',
          grantable: false,
          privilege: 'EXECUTE',
        });
      }),
      mutate(baseline, (copy) => {
        (copy.guardTrigger as MutableRecord).tginitdeferred = false;
      }),
      mutate(baseline, (copy) => {
        const quarantine = (copy.functions as MutableRecord[]).find(
          (entry) => entry.signature === 'notification_quarantine_claims(jsonb)',
        );
        if (!quarantine) throw new Error('Quarantine function fixture is unavailable');
        quarantine.prosrc = 'begin return 0; end';
      }),
      mutate(baseline, (copy) => {
        const quarantine = (copy.functions as MutableRecord[]).find(
          (entry) => entry.signature === 'notification_quarantine_claims(jsonb)',
        );
        if (!quarantine) throw new Error('Quarantine function fixture is unavailable');
        (quarantine.acl as MutableRecord[]).push({
          grantee: 'PUBLIC',
          grantor: 'notification_event_trigger',
          grantable: false,
          privilege: 'EXECUTE',
        });
      }),
      mutate(baseline, (copy) => {
        const index = (copy.operationalColumnAcl as MutableRecord[]).findIndex(
          (entry) =>
            entry.relname === 'notification_outbox' &&
            entry.attname === 'event_id' &&
            entry.grantee === 'notification_event_trigger' &&
            entry.privilege_type === 'SELECT',
        );
        if (index < 0) throw new Error('Quarantine column ACL fixture is unavailable');
        (copy.operationalColumnAcl as MutableRecord[]).splice(index, 1);
      }),
      mutate(baseline, (copy) => {
        const policy = (copy.operationalPolicies as MutableRecord[]).find(
          (entry) => entry.polname === 'notification_outbox_integrity_owner_update',
        );
        if (!policy) throw new Error('Quarantine policy fixture is unavailable');
        policy.with_check = 'true';
      }),
      mutate(baseline, (copy) => {
        const policy = (copy.operationalPolicies as MutableRecord[]).find(
          (entry) => entry.polname === 'notification_outbox_worker_update',
        );
        if (!policy) throw new Error('Worker policy fixture is unavailable');
        policy.with_check = 'true';
      }),
    ];
    const labels = [
      'source relation owner',
      'source relation RLS',
      'operational FORCE RLS',
      'unknown table ACL grantee',
      'missing source column ACL',
      'unknown operational ACL grantee',
      'source role reachability',
      'source policy predicate',
      'operational policy predicate',
      'missing operational column ACL',
      'slice role inheritance',
      'finalizer owner edge',
      'finalizer role reachability',
      'fixed function body',
      'PUBLIC function execute',
      'deferred commit trigger',
      'quarantine function body',
      'PUBLIC quarantine execute',
      'quarantine column ACL',
      'integrity-owner policy',
      'claim-worker policy',
    ] as const;
    expect(cases).toHaveLength(labels.length);
    for (const [index, changed] of cases.entries()) {
      expect(notificationProjectionCatalogMatches(changed), labels[index]).toBe(false);
    }
  });
});
