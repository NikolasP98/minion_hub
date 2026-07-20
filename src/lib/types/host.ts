/** Build channel (spec 2026-07-19 §D2). `prd` = netcup, `dev` = protopi.
 *  What the user picks; the instance behind it is the lease's business. */
export type BuildChannel = 'dev' | 'prd';

/** One channel the active org has, already resolved server-side to exactly one
 *  instance. Mirrors `ChannelEndpoint` in `$server/services/hosts.service`. */
export interface ChannelEndpoint {
  channel: BuildChannel;
  /** The instance the lease picked, as the legacy server id the client keys by. */
  serverId: string;
  /** Last WS-upgrade probe verdict; null = not probed since the lease was taken. */
  healthy: boolean | null;
}

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
  /** Build channel this row serves. Optional: absent on locally-created rows
   *  (the Add-gateway form) and on a pre-migration server. */
  channel?: BuildChannel;
  /** Org this gateway is ASSIGNED to (lease read-model, not ownership). Used to
   *  disambiguate hosts that share a name — picking the wrong one provisions
   *  into another org. Absent on locally-created rows before the server echoes. */
  orgId?: string | null;
}
