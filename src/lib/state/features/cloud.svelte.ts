import {
  getQuota,
  listShells,
  type ShellSummary,
  type ShellsQuota,
} from '$lib/services/shells-rpc';

const state = $state({
  shells: [] as ShellSummary[],
  quota: null as ShellsQuota | null,
  loading: true,
  refreshing: false,
  error: null as string | null,
  orgId: null as string | null,
});

interface CloudRefreshRequest {
  orgId: string | null;
  visible: boolean;
  promise: Promise<void>;
}

let refreshInFlight: CloudRefreshRequest | null = null;

export interface RefreshCloudOptions {
  /** Background inventory polls must not look like a user-requested reconnect. */
  background?: boolean;
}

export const cloudState = {
  get shells(): ShellSummary[] {
    return state.shells;
  },
  get quota(): ShellsQuota | null {
    return state.quota;
  },
  get loading(): boolean {
    return state.loading;
  },
  get refreshing(): boolean {
    return state.refreshing;
  },
  get error(): string | null {
    return state.error;
  },
};

/** Clear gateway-derived cloud data when the active organization changes. */
export function setCloudOrg(orgId: string | null): void {
  if (state.orgId === orgId) return;
  state.orgId = orgId;
  state.shells = [];
  state.quota = null;
  state.error = null;
  state.loading = true;
  state.refreshing = false;
}

export function refreshCloud(options: RefreshCloudOptions = {}): Promise<void> {
  const requestedOrgId = state.orgId;
  if (refreshInFlight?.orgId === requestedOrgId) {
    if (!options.background && !refreshInFlight.visible) {
      refreshInFlight.visible = true;
      state.refreshing = true;
    }
    return refreshInFlight.promise;
  }

  const request: CloudRefreshRequest = {
    orgId: requestedOrgId,
    visible: !options.background,
    promise: Promise.resolve(),
  };
  if (request.visible) state.refreshing = true;

  request.promise = Promise.all([listShells(requestedOrgId ?? undefined), getQuota()])
    .then(([shells, quota]) => {
      // An organization switch can complete while the old request is in flight.
      // Never let that response populate the next organization's Cloud surface.
      if (state.orgId !== requestedOrgId) return;
      // The Gateway scopes this request too. Keep a client-side defense so an
      // older Gateway cannot leak another organization's picker entries.
      state.shells = requestedOrgId
        ? shells.filter((shell) => shell.orgId === requestedOrgId)
        : [];
      state.quota = quota;
      state.error = null;
    })
    .catch((err: unknown) => {
      if (state.orgId !== requestedOrgId) return;
      state.error = err instanceof Error ? err.message : String(err);
    })
    .finally(() => {
      if (state.orgId === requestedOrgId) state.loading = false;
      if (state.orgId === requestedOrgId && request.visible) state.refreshing = false;
      if (refreshInFlight === request) refreshInFlight = null;
    });

  refreshInFlight = request;
  return request.promise;
}

export function cloudShell(id: string | null | undefined): ShellSummary | null {
  if (id) {
    const exact = state.shells.find((shell) => shell.shellId === id);
    if (exact) return exact;
  }
  return state.shells[0] ?? null;
}
