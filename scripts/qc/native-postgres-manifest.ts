export const NATIVE_POSTGRES_EXCLUDES = [
  '**/*.sql.integration.test.ts',
  'src/server/services/brain-business-persistence.service.test.ts',
  'src/server/services/crm-funnel.concurrent.integration.test.ts',
] as const;

export type NativePostgresLane =
  | 'crm-deposit'
  | 'crm-pagination'
  | 'crm-concurrent'
  | 'jobs'
  | 'attachments'
  | 'principal'
  | 'custom-properties'
  | 'formula'
  | 'qa-native';

export type NativePostgresAdmission = {
  file: string;
  minimumAssertions: number;
  requiredBehaviors: readonly string[];
};

/**
 * Single ownership and semantic evidence manifest for tests excluded from ordinary Vitest.
 * Counts are a supplementary ratchet. Required behavior names are the release contract.
 */
export const NATIVE_POSTGRES_MANIFEST = {
  'crm-deposit': [
    {
      file: 'src/server/services/crm-deposit-rule.sql.integration.test.ts',
      minimumAssertions: 5,
      requiredBehaviors: [
        'crm-deposit-rule against PostgreSQL isDepositText agrees with depositMatchSql/notDepositMatchSql for every case in the shared table',
      ],
    },
  ],
  'crm-pagination': [
    {
      file: 'src/server/services/crm-contact-activity-rollup.sql.integration.test.ts',
      minimumAssertions: 5,
      requiredBehaviors: [
        'crm_contact_activity_stats migration matches the authoritative live ledger aggregation field-for-field',
      ],
    },
    {
      file: 'src/server/services/crm-contacts.sql.integration.test.ts',
      minimumAssertions: 19,
      requiredBehaviors: [
        'rankContactsPage against PostgreSQL a same-tenant rule change (default → custom → empty → back to absent) is visible immediately, with finance/contacts classification agreeing at every step',
      ],
    },
    {
      file: 'src/server/services/crm-funnel-parity.sql.integration.test.ts',
      minimumAssertions: 6,
      requiredBehaviors: [
        'SQL funnel_stage vs the TS funnel helpers pages a funnel-filtered set without leaking rows from other stages',
      ],
    },
  ],
  'crm-concurrent': [
    {
      file: 'src/server/services/crm-funnel.concurrent.integration.test.ts',
      minimumAssertions: 7,
      requiredBehaviors: [
        'funnel writes against concurrent PostgreSQL transactions setFunnelStage and the customFieldsPatch writer both queue on the coordinator lock and both survive — patch starts first (reverse start order)',
      ],
    },
  ],
  jobs: [
    {
      file: 'src/server/services/job-stock-concurrency.sql.integration.test.ts',
      minimumAssertions: 21,
      requiredBehaviors: [
        'native stock transaction races and connection loss tenant B cannot use tenant A invoice or stock rows',
      ],
    },
    {
      file: 'src/server/services/job-effects.sql.integration.test.ts',
      minimumAssertions: 25,
      requiredBehaviors: [
        'native job receipt ownership retains indeterminate admission after response loss and does not replay remotely',
      ],
    },
    {
      file: 'src/server/services/job-effect-pages.sql.integration.test.ts',
      minimumAssertions: 48,
      requiredBehaviors: [
        'native concurrent frontier and committed dispatch permits never grants a dispatch permit when the actual admission COMMIT fails a deferred constraint',
      ],
    },
    {
      file: 'src/server/services/finance-statements.effect-ownership.sql.integration.test.ts',
      minimumAssertions: 41,
      requiredBehaviors: [
        'native statement ownership RLS denies cross-org reads, parent references and writes without role leakage',
      ],
    },
    {
      file: 'src/server/services/brain-corpus.effect-ownership.sql.integration.test.ts',
      minimumAssertions: 13,
      requiredBehaviors: [
        'conversation corpus native effect ownership a lost provider response leaves an admitted receipt; retries never pay again',
      ],
    },
  ],
  attachments: [
    {
      file: 'src/server/services/attachments.authority.sql.integration.test.ts',
      minimumAssertions: 17,
      requiredBehaviors: [
        'native attachment authority RLS filters files and rejects a foreign lifecycle insert even without caller tenant predicates',
      ],
    },
    {
      file: 'src/server/services/attachments.lifecycle.sql.integration.test.ts',
      minimumAssertions: 30,
      requiredBehaviors: [
        'native attachment deletion lifecycle storage failure keeps a tombstone, blocks relink/read, and a new sweep resumes the same claim',
      ],
    },
  ],
  principal: [
    {
      file: 'src/server/auth/assistant-principal.sql.integration.test.ts',
      minimumAssertions: 8,
      requiredBehaviors: [
        'native assistant persisted assignment and revocation denies the next request after membership removal commits on another native connection',
      ],
    },
  ],
  'custom-properties': [
    {
      file: 'src/server/services/custom-properties.sql.integration.test.ts',
      minimumAssertions: 1,
      requiredBehaviors: [
        'custom properties PostgreSQL invariants enforces org RLS, CAS, explicit null, and config/value serialization',
      ],
    },
  ],
  formula: [
    {
      file: 'src/server/services/formula-sql.sql.integration.test.ts',
      minimumAssertions: 5,
      requiredBehaviors: [
        'formula compiler PostgreSQL semantics executes nested boolean comparisons and binds hostile text as data',
      ],
    },
    {
      file: 'src/server/services/formula-properties.sql.integration.test.ts',
      minimumAssertions: 3,
      requiredBehaviors: [
        'formula property PostgreSQL graph invariants survives JSONB type round-trips and rejects cycles and archived dependencies',
      ],
    },
  ],
  'qa-native': [
    {
      file: 'src/server/services/brain-business-corpus.sql.integration.test.ts',
      minimumAssertions: 1,
      requiredBehaviors: [
        'business corpus SQL against PostgreSQL EXPLAINs every payload and deletion-identity query against the live schema',
      ],
    },
    {
      file: 'src/server/services/brain-business-persistence.service.test.ts',
      minimumAssertions: 5,
      requiredBehaviors: [
        'business corpus persistence SQL against PostgreSQL EXPLAINs document, chunk, and stale-delete batches against the live schema',
      ],
    },
    {
      file: 'src/server/services/brains.effect-ownership.sql.integration.test.ts',
      minimumAssertions: 30,
      requiredBehaviors: [
        'brain ingestion native effect ownership actual RLS denies cross-org reads and writes and a wrong brain cannot revoke a document request',
      ],
    },
    {
      file: 'src/server/services/crm-journey.sql.integration.test.ts',
      minimumAssertions: 7,
      requiredBehaviors: [
        'deterministicMilestones deposit classification against PGlite a same-tenant rule change is visible on the immediately next call: default → custom → empty → back to absent',
      ],
    },
    {
      file: 'src/server/services/tag-links.sql.integration.test.ts',
      minimumAssertions: 1,
      requiredBehaviors: [
        'tag link service SQL behavior scopes reads and replaces only manual links, including concurrent replacements',
      ],
    },
  ],
} as const satisfies Record<NativePostgresLane, readonly NativePostgresAdmission[]>;

export const NATIVE_POSTGRES_LANES = Object.freeze(
  Object.keys(NATIVE_POSTGRES_MANIFEST) as NativePostgresLane[],
);

export function nativePostgresAdmissions(lane: NativePostgresLane) {
  return NATIVE_POSTGRES_MANIFEST[lane] as readonly NativePostgresAdmission[];
}

export function nativePostgresFiles(lane: NativePostgresLane) {
  return nativePostgresAdmissions(lane).map(({ file }) => file);
}

export function isOrdinaryVitestNativeExclusion(file: string) {
  const normalized = file.replaceAll('\\', '/');
  return (
    normalized.endsWith('.sql.integration.test.ts') ||
    normalized === 'src/server/services/brain-business-persistence.service.test.ts' ||
    normalized === 'src/server/services/crm-funnel.concurrent.integration.test.ts'
  );
}
