export const ui = $state({
  selectedAgentId: null as string | null,
  sessionStatus: {} as Record<string, 'running' | 'thinking' | 'idle' | 'aborted'>,
  sessionStatusTimers: {} as Record<string, ReturnType<typeof setTimeout>>,
  shutdownReason: null as string | null,
  lastTickAt: null as number | null,
  dropdownOpen: false,
  overlayOpen: false,
  overlayEditId: null as string | null,
  overlayConfirmDeleteId: null as string | null,
});
