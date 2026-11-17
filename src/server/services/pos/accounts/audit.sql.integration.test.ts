import { describe, it } from 'vitest';

/**
 * F7 native audit suite (minion-meta spec 128). Registered in NATIVE_POSTGRES_MANIFEST['qa-native']
 * with exactAssertions: the eight names below are the contract; do not add or rename.
 *
 * Lane stays RED until T022 on the feature branch by design (decision F7-R6-IR-10): each body
 * throws until its owning task lands. No intermediate qualification claim is made.
 * Setup recipe (TODO(handoff), T003/T005): create the owned child minion_qc_faces_audit_<32hex> on the
 * minion_qc_vectors controller, installOperatorNativeAuthFixture, restore supabase/qa/baseline/schema.sql,
 * assertOperatorNativeAuthFixture, apply 20261116190000_operator_authority_bridge.sql, then
 * run the cases in contracts/authority-bridge.md "Native baseline and migration proof".
 */
const pending = (owner: string): never => {
  throw new Error(`TODO(handoff): ${owner} is not implemented yet`);
};

describe('faces receivables audit against PostgreSQL', () => {
  it('uses one read only snapshot and rejects mutations under app_ledger', () =>
    pending('T005/T013'));
  it('preserves canonical controls beyond 500 clients and exposes legacy residuals', () =>
    pending('T011-T013'));
  it('resolves explicit and provider invoice links without unsupported repair candidates', () =>
    pending('T017'));
  it('matches locking authority composition without locks or stale cache', () => pending('T005'));
  it('isolates concurrent pages and foreign organization rows', () => pending('T013'));
  it('admits only approved matched evidence and preserves uncertainty', () => pending('T017/T018'));
  it('applies exact accounting timezone cohort and approved scope boundaries', () =>
    pending('T010/T013'));
  it('produces stable proposal hashes and UUIDs across fresh runs', () => pending('T020-T022'));
});
