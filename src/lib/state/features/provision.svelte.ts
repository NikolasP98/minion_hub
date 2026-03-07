import type { PhaseStatus } from '$server/services/provision.service';

export interface PhaseInfo {
  id: string;
  name: string;
  description: string;
  status: PhaseStatus;
}

export interface ProvisionConfigState {
  sshHost: string;
  sshUser: string;
  sshPort: number;
  apiKey: string;
  agentName: string;
  sandboxMode: string;
  dmPolicy: string;
  installMethod: string;
  pkgManager: string;
  gatewayPort: number;
  gatewayBind: string;
  enableWhatsapp: boolean;
  enableTelegram: boolean;
  enableDiscord: boolean;
}

const DEFAULT_PHASES: PhaseInfo[] = [
  { id: '00', name: 'Preflight', description: 'Check prerequisites (user, node)', status: 'pending' },
  { id: '20', name: 'User Creation', description: 'Create minion user and directory structure', status: 'pending' },
  { id: '30', name: 'Environment', description: 'Install Node.js 22+', status: 'pending' },
  { id: '40', name: 'Install', description: 'Install minion package', status: 'pending' },
  { id: '45', name: 'Alias', description: 'Configure PATH alias', status: 'pending' },
  { id: '50', name: 'Config', description: 'Generate minion.json configuration', status: 'pending' },
  { id: '60', name: 'Service', description: 'Set up systemd service', status: 'pending' },
  { id: '70', name: 'Verification', description: 'Verify gateway health', status: 'pending' },
];

const DEFAULT_CONFIG: ProvisionConfigState = {
  sshHost: '',
  sshUser: 'root',
  sshPort: 22,
  apiKey: '',
  agentName: '',
  sandboxMode: 'non-main',
  dmPolicy: 'pairing',
  installMethod: 'package',
  pkgManager: 'npm',
  gatewayPort: 18789,
  gatewayBind: 'loopback',
  enableWhatsapp: false,
  enableTelegram: false,
  enableDiscord: false,
};

export const provisionState = $state({
  phases: structuredClone(DEFAULT_PHASES) as PhaseInfo[],
  config: structuredClone(DEFAULT_CONFIG) as ProvisionConfigState,
  configLoaded: false,
  running: false,
  checking: false,
  logs: [] as string[],
  currentPhase: null as string | null,
  error: null as string | null,
});

let abortController: AbortController | null = null;

export async function fetchConfig(serverId: string) {
  try {
    const res = await fetch(`/api/servers/${serverId}/provision/config`);
    if (!res.ok) throw new Error(`Failed to fetch config: ${res.status}`);
    const data = await res.json();
    if (data.config) {
      const c = data.config;
      provisionState.config = {
        sshHost: c.sshHost ?? '',
        sshUser: c.sshUser ?? 'root',
        sshPort: c.sshPort ?? 22,
        apiKey: c.apiKey === '••••••••' ? '' : (c.apiKey ?? ''),
        agentName: c.agentName ?? '',
        sandboxMode: c.sandboxMode ?? 'non-main',
        dmPolicy: c.dmPolicy ?? 'pairing',
        installMethod: c.installMethod ?? 'package',
        pkgManager: c.pkgManager ?? 'npm',
        gatewayPort: c.gatewayPort ?? 18789,
        gatewayBind: c.gatewayBind ?? 'loopback',
        enableWhatsapp: !!c.enableWhatsapp,
        enableTelegram: !!c.enableTelegram,
        enableDiscord: !!c.enableDiscord,
      };
      // Restore phase statuses
      if (c.phaseStatuses) {
        for (const phase of provisionState.phases) {
          if (c.phaseStatuses[phase.id]) {
            phase.status = c.phaseStatuses[phase.id];
          }
        }
      }
      // Track that API key exists on server (redacted)
      if (c.apiKey === '••••••••') {
        provisionState.config.apiKey = '';
      }
    }
    provisionState.configLoaded = true;
  } catch (e) {
    provisionState.error = e instanceof Error ? e.message : 'Failed to load config';
  }
}

export async function saveConfig(serverId: string) {
  try {
    provisionState.error = null;
    const c = provisionState.config;
    const body: Record<string, unknown> = {
      sshHost: c.sshHost || undefined,
      sshUser: c.sshUser,
      sshPort: c.sshPort,
      agentName: c.agentName || undefined,
      sandboxMode: c.sandboxMode,
      dmPolicy: c.dmPolicy,
      installMethod: c.installMethod,
      pkgManager: c.pkgManager,
      gatewayPort: c.gatewayPort,
      gatewayBind: c.gatewayBind,
      enableWhatsapp: c.enableWhatsapp,
      enableTelegram: c.enableTelegram,
      enableDiscord: c.enableDiscord,
    };
    // Only send API key if user typed a new one
    if (c.apiKey) body.apiKey = c.apiKey;

    const res = await fetch(`/api/servers/${serverId}/provision/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to save config: ${res.status}`);
  } catch (e) {
    provisionState.error = e instanceof Error ? e.message : 'Failed to save config';
  }
}

export async function checkStatus(serverId: string) {
  provisionState.checking = true;
  provisionState.error = null;
  try {
    const res = await fetch(`/api/servers/${serverId}/provision/status`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `Status check failed: ${res.status}`);
    }
    const data = await res.json();
    if (data.phases) {
      for (const phase of provisionState.phases) {
        if (data.phases[phase.id]) {
          phase.status = data.phases[phase.id];
        }
      }
    }
  } catch (e) {
    provisionState.error = e instanceof Error ? e.message : 'Status check failed';
  } finally {
    provisionState.checking = false;
  }
}

export async function startProvision(serverId: string, startFrom?: string) {
  if (provisionState.running) return;

  provisionState.running = true;
  provisionState.error = null;
  provisionState.logs = [];
  provisionState.currentPhase = startFrom ?? '00';

  // Mark phases from startFrom onwards as pending
  let started = !startFrom;
  for (const phase of provisionState.phases) {
    if (phase.id === startFrom) started = true;
    if (started && phase.status !== 'complete') {
      phase.status = 'pending';
    }
  }

  abortController = new AbortController();

  try {
    const res = await fetch(`/api/servers/${serverId}/provision/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startFrom }),
      signal: abortController.signal,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `Provision failed: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response stream');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.type === 'log') {
              provisionState.logs.push(payload.line);
            } else if (payload.type === 'error') {
              provisionState.logs.push(`ERROR: ${payload.line}`);
            }
          } catch { /* ignore parse errors */ }
        } else if (line.startsWith('event: phase')) {
          // Next data line has phase info — handled in data parsing
          const nextData = lines.find((l) => l.startsWith('data: ') && l.includes('"phase"'));
          if (nextData) {
            try {
              const p = JSON.parse(nextData.slice(6));
              provisionState.currentPhase = p.phase;
              // Mark phase as running
              const phase = provisionState.phases.find((ph) => ph.id === p.phase);
              if (phase) phase.status = 'running';
            } catch { /* ignore */ }
          }
        } else if (line.startsWith('event: done')) {
          // Mark remaining running phases as complete
          for (const phase of provisionState.phases) {
            if (phase.status === 'running') phase.status = 'complete';
          }
        }
      }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      provisionState.error = e instanceof Error ? e.message : 'Provision failed';
    }
  } finally {
    provisionState.running = false;
    provisionState.currentPhase = null;
    abortController = null;
  }
}

export function stopProvision() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  provisionState.running = false;
  provisionState.currentPhase = null;
  // Mark running phases as failed
  for (const phase of provisionState.phases) {
    if (phase.status === 'running') phase.status = 'failed';
  }
}

export function resetState() {
  provisionState.phases = structuredClone(DEFAULT_PHASES);
  provisionState.config = structuredClone(DEFAULT_CONFIG);
  provisionState.configLoaded = false;
  provisionState.running = false;
  provisionState.checking = false;
  provisionState.logs = [];
  provisionState.currentPhase = null;
  provisionState.error = null;
}
