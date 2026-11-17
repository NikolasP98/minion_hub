/**
 * Pure assembly of the ReconciliationReport from collected rows (report.md, diagnostic-wire.md).
 * No database, no clock: the caller supplies the observation instant and snapshot. Output is canonical and
 * strict-decodable; any numeric/limit problem yields the compact incomplete form, never a partial total.
 */
import {
  DEC_ZERO,
  assertReportConsistent,
  canonicalSha256,
  classifyCase,
  cmpStr,
  computeKeyTotals,
  computeSourceEvidenceSha256,
  dedupeLedger,
  fixed4,
  parseDec,
  q4,
  sha256Hex,
  type CaseRow,
  type ClassifierComponent,
  type Coverage,
  type DiagnosticCase,
  type DiagnosticError,
  type DiagnosticManifestV1,
  type ErrorCode,
  type MovementEvidence,
  type ProjectionEvidenceResult,
  type ProjectionObservation,
  type ReconciliationReport,
  type SourceRef,
} from './faces-stock-reconciliation';
import {
  componentsFromAssertions,
  deriveEvidence,
  type Collected,
} from './faces-stock-reconcile-read';

export interface BuildInput {
  orgId: string;
  manifest: DiagnosticManifestV1;
  observedAt: string;
  snapshot: NonNullable<ReconciliationReport['snapshot']>;
  gitSha: string;
  collected: Collected;
  /** True only after the S2a mapping correction is applied and its receipt verified (never from the diagnostic). */
  mappingQualified: boolean;
}

const caseKeyOfComponent = (c: ClassifierComponent) =>
  `${c.source.kind}:${c.source.id}:${c.itemId}:${c.warehouseId}`;

function projectionResults(
  refs: DiagnosticCase['evidenceRefs'],
  components: ClassifierComponent[],
  sourceHash: string,
  actor: string,
): ProjectionEvidenceResult[] {
  const known = new Set(components.map(caseKeyOfComponent));
  const out: ProjectionEvidenceResult[] = [];
  const byKey = new Map<string, { id: string; obs: ProjectionObservation[] }[]>();
  for (const r of refs) {
    if (r.assertion?.kind !== 'projection_comparison') continue;
    const a = r.assertion;
    const none = (reason: ProjectionEvidenceResult['reason']): ProjectionEvidenceResult => ({
      referenceId: r.referenceId,
      componentKey: a.componentKey,
      state: 'unavailable',
      observations: [],
      reason,
    });
    if (!known.has(a.componentKey)) out.push(none('projection_identity_unavailable'));
    else if (a.sourceEvidenceSha256 !== sourceHash) out.push(none('projection_source_changed'));
    else if (a.verifiedByProfileId !== actor) out.push(none('projection_identity_unavailable'));
    else
      byKey.set(a.componentKey, [
        ...(byKey.get(a.componentKey) ?? []),
        { id: r.referenceId, obs: a.observations },
      ]);
  }
  for (const [componentKey, caps] of byKey) {
    // Two admitted captures that disagree on what a surface shows are a conflict, never "newest wins".
    const shown = new Map<string, string>();
    let conflict = false;
    for (const cap of caps)
      for (const o of cap.obs) {
        const v = o.presence === 'omitted' ? 'omitted' : String(q4(parseDec(o.qty!)));
        const prev = shown.get(`${o.surface}`);
        if (prev !== undefined && prev !== v) conflict = true;
        shown.set(`${o.surface}`, v);
      }
    for (const cap of caps)
      out.push({
        referenceId: cap.id,
        componentKey,
        state: conflict ? 'conflicting' : 'admitted',
        observations: cap.obs,
        reason: conflict ? 'projection_conflict' : 'matched_source_capture',
      });
  }
  for (const k of known)
    if (!out.some((p) => p.componentKey === k))
      out.push({
        referenceId: null,
        componentKey: k,
        state: 'not_provided',
        observations: [],
        reason: 'projection_unverified',
      });
  return out.sort(
    (a, b) =>
      cmpStr(a.componentKey, b.componentKey) || cmpStr(a.referenceId ?? '', b.referenceId ?? ''),
  );
}

export function buildReport(input: BuildInput): ReconciliationReport {
  const { manifest, collected: c } = input;
  const derived = deriveEvidence(c, input.observedAt);
  const dedup = dedupeLedger(derived.ledger);
  const { totals, checks, integrityFailed } = computeKeyTotals(dedup.rows, c.bins);
  const failedKeys = new Set(
    totals.filter((t) => t.integrity === 'fail').map((t) => `${t.itemId}:${t.warehouseId}`),
  );
  const conflictIntegrity = dedup.conflicts.length > 0;
  const sourceEvidenceSha256 = computeSourceEvidenceSha256(
    input.orgId,
    derived.sourceEvidence,
    dedup.rows.map(toMovement),
    {
      nodes: derived.nodes,
      edges: derived.edges,
    },
  );
  const labels = {
    items: c.labels.items
      .map(({ itemId, name, code }) => ({ itemId, name, code }))
      .sort((a, b) => cmpStr(a.itemId, b.itemId)),
    products: c.labels.products.slice().sort((a, b) => cmpStr(a.productId, b.productId)),
    warehouses: c.labels.warehouses.slice().sort((a, b) => cmpStr(a.warehouseId, b.warehouseId)),
  };
  const itemUoms = Object.fromEntries(c.labels.items.map((i) => [i.itemId, i.uom]));
  const ticketSet = new Set(c.tickets.map((t) => String(t.id)));
  const bookingSet = new Set(c.bookings.map((b) => String(b.id)));
  const cases: CaseRow[] = [];
  const allProjection: ProjectionEvidenceResult[] = [];
  let anyFail = integrityFailed || conflictIntegrity;
  for (const kase of manifest.cases) {
    const { components, conflict } = componentsFromAssertions(kase.evidenceRefs, derived, c);
    const stableIds = kase.bookingIds.length + kase.ticketIds.length + kase.itemIds.length > 0;
    const found = [
      ...kase.ticketIds.filter((t) => ticketSet.has(t)),
      ...kase.bookingIds.filter((b) => bookingSet.has(b)),
    ];
    const supplied = kase.ticketIds.length + kase.bookingIds.length;
    const identityState: CaseRow['identityState'] = !stableIds
      ? 'unmatched'
      : supplied === 0
        ? 'matched'
        : found.length === supplied
          ? 'matched'
          : 'unmatched';
    // Case keys: asserted components, item-only ids, and entry lines owned by this case's sources.
    const caseTickets = new Set([
      ...kase.ticketIds,
      ...c.lines
        .filter((l) => kase.bookingIds.includes(String(l.booking_id)))
        .map((l) => String(l.ticket_id)),
    ]);
    const caseKeys = new Set<string>(components.map((x) => `${x.itemId}:${x.warehouseId}`));
    for (const t of dedup.rows)
      if (kase.itemIds.includes(t.itemId)) caseKeys.add(`${t.itemId}:${t.warehouseId}`);
    for (const t of dedup.rows) {
      const s = t.source;
      if (
        (s.kind === 'pos' && caseTickets.has(s.id)) ||
        (s.kind === 'booking' && kase.bookingIds.includes(s.id))
      )
        caseKeys.add(`${t.itemId}:${t.warehouseId}`);
    }
    const caseLedger = dedup.rows.filter((m) => caseKeys.has(`${m.itemId}:${m.warehouseId}`));
    const caseIntegrity = [...caseKeys].some((k) => failedKeys.has(k)) || conflictIntegrity;
    // Fulfillment is only known from owner-asserted components; true-up combines to the weakest coverage.
    const tu =
      components.length === 0
        ? 'unknown'
        : components.some((x) => x.trueUpCoverage === 'unknown')
          ? 'unknown'
          : components.some((x) => x.trueUpCoverage === 'covered')
            ? 'covered'
            : 'not_covered';
    const coverage: Coverage = {
      sourceGraphComplete: true,
      ledgerHistoryComplete: true,
      openingKnown: !caseIntegrity,
      fulfillmentKnown: components.length > 0,
      trueUpCoverage: tu,
    };
    const projections = projectionResults(
      kase.evidenceRefs,
      components,
      sourceEvidenceSha256,
      manifest.actorProfileId,
    );
    allProjection.push(...projections);
    const out = classifyCase({
      identityState,
      noStableIds: !stableIds,
      identityUnresolved: kase.identityUnresolved,
      coverage,
      integrityFailed: caseIntegrity,
      numericUnsupported: false,
      evidenceConflict: conflict,
      components,
      ledger: caseLedger,
      itemUoms,
      projections,
      mappingQualified: input.mappingQualified,
    });
    const sources: SourceRef[] = [
      ...kase.ticketIds
        .filter((t) => ticketSet.has(t))
        .map((id) => ({ kind: 'pos_ticket' as const, id })),
      ...kase.bookingIds
        .filter((b) => bookingSet.has(b))
        .map((id) => ({ kind: 'booking' as const, id })),
    ];
    cases.push({
      caseKey: kase.caseKey,
      candidateIds: {
        bookingIds: kase.bookingIds,
        ticketIds: kase.ticketIds,
        itemIds: kase.itemIds,
      },
      sources,
      identityState,
      classification: out.classification,
      reasonCodes: out.reasonCodes,
      coverage,
      components: out.components,
      secondaryFindings: out.secondaryFindings,
      evidenceReferenceIds: kase.evidenceRefs.map((r) => r.referenceId).sort(cmpStr),
      priorCorrectionIds: kase.evidenceRefs
        .flatMap((r) => (r.correctionId ? [r.correctionId] : []))
        .sort(cmpStr),
      repairEligible: out.repairEligible && !anyFail,
      hint: kase.searchHint
        ? { state: 'withheld_private_input', sha256: sha256Hex(kase.searchHint.description) }
        : { state: 'none', sha256: null },
    });
  }
  const tuAll: Coverage['trueUpCoverage'] = cases.some(
    (x) => x.coverage.trueUpCoverage === 'covered',
  )
    ? 'covered'
    : cases.some((x) => x.coverage.trueUpCoverage === 'unknown')
      ? 'unknown'
      : 'not_covered';
  const evidenceCoverage: Coverage = {
    sourceGraphComplete: cases.every((x) => x.coverage.sourceGraphComplete),
    ledgerHistoryComplete: cases.every((x) => x.coverage.ledgerHistoryComplete),
    openingKnown: cases.every((x) => x.coverage.openingKnown),
    fulfillmentKnown: cases.every((x) => x.coverage.fulfillmentKnown),
    trueUpCoverage: tuAll,
  };
  const report: ReconciliationReport = {
    schemaVersion: 1,
    mode: 'read-only',
    orgId: input.orgId,
    actorProfileId: manifest.actorProfileId,
    target: manifest.target,
    source: { gitSha: input.gitSha, deploymentVerified: false },
    observedAt: input.observedAt,
    snapshot: input.snapshot,
    scope: {
      caseKeys: manifest.cases.map((x) => x.caseKey),
      itemWarehouseKeys: c.keys,
      dateHintsApplied: false,
    },
    evidenceCoverage,
    cases,
    ledger: dedup.rows.map(toMovement),
    graph: { nodes: derived.nodes, edges: derived.edges },
    sourceEvidence: derived.sourceEvidence,
    timeline: derived.timeline,
    sourceEvidenceSha256,
    projectionEvidence: allProjection,
    labels,
    totals,
    numericChecks: checks.map((x) => ({ ...x })),
    errors: [],
    outcome: anyFail ? 'integrity_failed' : 'complete',
    complete: true,
  };
  void DEC_ZERO;
  void fixed4;
  void canonicalSha256;
  assertReportConsistent(report);
  return report;
}

function toMovement(m: ReturnType<typeof dedupeLedger>['rows'][number]): MovementEvidence {
  const refs: SourceRef[] = [{ kind: 'stock_entry', id: m.entryId }];
  const s = m.source;
  if (s.kind === 'pos') refs.push({ kind: 'pos_ticket', id: s.id });
  if (s.kind === 'booking') refs.push({ kind: 'booking', id: s.id });
  if (s.kind === 'invoice') refs.push({ kind: 'invoice', id: s.id });
  const { source: _s, ...rest } = m;
  void _s;
  return { ...rest, sourceRefs: refs };
}

/** Compact incomplete form (final overflow or any read failure): unresolved CaseRows, no totals, no evidence. */
export function buildIncompleteReport(
  base: Pick<BuildInput, 'orgId' | 'manifest' | 'observedAt' | 'gitSha'> & {
    snapshot: ReconciliationReport['snapshot'];
  },
  code: ErrorCode,
): ReconciliationReport {
  const none: Coverage = {
    sourceGraphComplete: false,
    ledgerHistoryComplete: false,
    openingKnown: false,
    fulfillmentKnown: false,
    trueUpCoverage: 'unknown',
  };
  const errors: DiagnosticError[] = [{ code, caseKey: null, ref: null }];
  const report: ReconciliationReport = {
    schemaVersion: 1,
    mode: 'read-only',
    orgId: base.orgId,
    actorProfileId: base.manifest.actorProfileId,
    target: base.manifest.target,
    source: { gitSha: base.gitSha, deploymentVerified: false },
    observedAt: base.observedAt,
    snapshot: base.snapshot,
    scope: {
      caseKeys: base.manifest.cases.map((x) => x.caseKey),
      itemWarehouseKeys: [],
      dateHintsApplied: false,
    },
    evidenceCoverage: none,
    cases: base.manifest.cases.map((k) => ({
      caseKey: k.caseKey,
      candidateIds: { bookingIds: k.bookingIds, ticketIds: k.ticketIds, itemIds: k.itemIds },
      sources: [],
      identityState: 'unmatched',
      classification: 'unresolved',
      reasonCodes: ['incomplete_read'],
      coverage: none,
      components: [],
      secondaryFindings: [],
      evidenceReferenceIds: [],
      priorCorrectionIds: [],
      repairEligible: false,
      hint: k.searchHint
        ? { state: 'withheld_private_input', sha256: sha256Hex(k.searchHint.description) }
        : { state: 'none', sha256: null },
    })),
    ledger: [],
    graph: { nodes: [], edges: [] },
    sourceEvidence: [],
    timeline: [],
    sourceEvidenceSha256: null,
    projectionEvidence: [],
    labels: { items: [], products: [], warehouses: [] },
    totals: [],
    numericChecks: [],
    errors,
    outcome: 'incomplete',
    complete: false,
  };
  assertReportConsistent(report);
  return report;
}

export const EXIT_FOR_OUTCOME = { complete: 0, integrity_failed: 4, incomplete: 3 } as const;
