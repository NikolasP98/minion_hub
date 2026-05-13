export interface Host {
  id: string;
  name: string;
  url: string;
  /**
   * Optional. Tokens live server-side (encrypted in DB) and are fetched
   * on-demand via POST /api/servers/[id]/token right before WS connect.
   * Never persisted to localStorage. Present transiently in the Add/Edit
   * form state and in the POST body when creating/updating a host.
   */
  token?: string;
  lastConnectedAt: number | null;
}
