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
}

export async function refreshCloud(): Promise<void> {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    const [shells, quota] = await Promise.all([listShells(), getQuota()]);
    state.shells = shells;
    state.quota = quota;
    state.error = null;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.loading = false;
    state.refreshing = false;
  }
}

export function cloudShell(id: string | null | undefined): ShellSummary | null {
  if (id) {
    const exact = state.shells.find((shell) => shell.shellId === id);
    if (exact) return exact;
  }
  return state.shells[0] ?? null;
}
