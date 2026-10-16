/** Reactive owners for actual SecretsSection mounted regression tests. */
export const page = $state({
  data: { user: { id: 'actor-a' }, activeOrgId: 'org-a' },
  url: new URL('http://localhost/settings'),
});
export const conn = $state({ connected: true, connectedAt: 1 as number | null });
export const hostsState = $state({ activeHostId: 'host-a' });
export function resetSecretOwner() {
  page.data.user.id = 'actor-a';
  page.data.activeOrgId = 'org-a';
  conn.connected = true;
  conn.connectedAt = 1;
  hostsState.activeHostId = 'host-a';
}
