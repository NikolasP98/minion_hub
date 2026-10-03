export function validateMarkedLoopbackPostgres(
  raw: string | undefined,
  marker: string | undefined,
  markerName: string,
) {
  if (marker !== '1' || !raw) {
    throw new Error(`${markerName}=1 and an explicit loopback PostgreSQL URL are required`);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid loopback PostgreSQL URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.port ||
    !url.username ||
    url.pathname.length < 2 ||
    url.search ||
    url.hash
  ) {
    throw new Error('Native lane database must be an explicit loopback PostgreSQL database');
  }
  return url;
}

export function qaTestDatabaseUrl(environment: NodeJS.ProcessEnv) {
  return (
    environment.HUB_TEST_DB_URL ??
    (environment.CI || environment.GITHUB_ACTIONS ? environment.SUPABASE_DB_URL : undefined)
  );
}
