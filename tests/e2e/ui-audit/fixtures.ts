export interface CaptureFixture {
  id: string;
  fixtureId?: string;
  pattern: string;
  params: Record<string, string>;
  query?: Record<string, string>;
}

/**
 * Dynamic IDs are provisioned by the deterministic seed job and passed as a
 * JSON array in E2E_UI_AUDIT_FIXTURES. No production IDs or cookies are stored.
 */
export function captureFixtures(): CaptureFixture[] {
  const raw = process.env.E2E_UI_AUDIT_FIXTURES;
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('E2E_UI_AUDIT_FIXTURES must be a JSON array');
  return parsed as CaptureFixture[];
}

export function resolveFixtureProvision(
  fixtureId: string,
  fixtures: CaptureFixture[],
): { params?: Record<string, string>; query?: Record<string, string> } | undefined {
  const fixture = fixtures.find((candidate) => candidate.fixtureId === fixtureId);
  if (!fixture) return undefined;
  return { params: fixture.params, query: fixture.query };
}
