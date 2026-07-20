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
  /** Org this gateway is ASSIGNED to (lease read-model, not ownership). Used to
   *  disambiguate hosts that share a name — picking the wrong one provisions
   *  into another org. Absent on locally-created rows before the server echoes. */
  orgId?: string | null;
}
