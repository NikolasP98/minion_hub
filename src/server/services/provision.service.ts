import { eq, and } from 'drizzle-orm';
import { serverProvisionConfigs } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import { encrypt, decrypt } from '$server/auth/crypto';
import type { TenantContext } from './base';
import { spawn } from 'node:child_process';
import path from 'node:path';

// ─── Types ──────────────────────────────────────────────────────────────

export type PhaseStatus = 'pending' | 'complete' | 'failed' | 'running' | 'skipped';

export interface PhaseInfo {
  id: string;
  name: string;
  description: string;
  status: PhaseStatus;
}

export interface ProvisionConfig {
  id: string;
  serverId: string;
  sshHost: string | null;
  sshUser: string | null;
  sshPort: number | null;
  apiKey: string | null;
  agentName: string | null;
  sandboxMode: string | null;
  dmPolicy: string | null;
  installMethod: string | null;
  pkgManager: string | null;
  gatewayPort: number | null;
  gatewayBind: string | null;
  enableWhatsapp: number | null;
  enableTelegram: number | null;
  enableDiscord: number | null;
  phaseStatuses: Record<string, PhaseStatus>;
  lastProvisionAt: number | null;
}

export interface ProvisionConfigInput {
  sshHost?: string;
  sshUser?: string;
  sshPort?: number;
  apiKey?: string;
  agentName?: string;
  sandboxMode?: string;
  dmPolicy?: string;
  installMethod?: string;
  pkgManager?: string;
  gatewayPort?: number;
  gatewayBind?: string;
  enableWhatsapp?: boolean;
  enableTelegram?: boolean;
  enableDiscord?: boolean;
}

// ─── Phase definitions ──────────────────────────────────────────────────

export const PHASES: { id: string; name: string; description: string }[] = [
  { id: '00', name: 'Preflight', description: 'Check prerequisites (user, node)' },
  { id: '20', name: 'User Creation', description: 'Create minion user and directory structure' },
  { id: '30', name: 'Environment', description: 'Install Node.js 22+' },
  { id: '40', name: 'Install', description: 'Install minion package' },
  { id: '45', name: 'Alias', description: 'Configure PATH alias' },
  { id: '50', name: 'Config', description: 'Generate minion.json configuration' },
  { id: '60', name: 'Service', description: 'Set up systemd service' },
  { id: '70', name: 'Verification', description: 'Verify gateway health' },
];

// ─── In-memory provision lock ───────────────────────────────────────────

const activeProvisions = new Set<string>();

// ─── CRUD ───────────────────────────────────────────────────────────────

export async function upsertProvisionConfig(
  ctx: TenantContext,
  serverId: string,
  input: ProvisionConfigInput,
): Promise<string> {
  const now = nowMs();

  // Encrypt API key if provided
  let apiKeyEncrypted: string | undefined;
  let apiKeyIv: string | undefined;
  if (input.apiKey) {
    const { ciphertext, iv } = encrypt(input.apiKey);
    apiKeyEncrypted = ciphertext;
    apiKeyIv = iv;
  }

  // Check for existing config
  const [existing] = await ctx.db
    .select({ id: serverProvisionConfigs.id })
    .from(serverProvisionConfigs)
    .where(eq(serverProvisionConfigs.serverId, serverId));

  if (existing) {
    const updates: Record<string, unknown> = {
      updatedAt: now,
    };
    if (input.sshHost !== undefined) updates.sshHost = input.sshHost;
    if (input.sshUser !== undefined) updates.sshUser = input.sshUser;
    if (input.sshPort !== undefined) updates.sshPort = input.sshPort;
    if (apiKeyEncrypted !== undefined) {
      updates.apiKey = apiKeyEncrypted;
      updates.apiKeyIv = apiKeyIv;
    }
    if (input.agentName !== undefined) updates.agentName = input.agentName;
    if (input.sandboxMode !== undefined) updates.sandboxMode = input.sandboxMode;
    if (input.dmPolicy !== undefined) updates.dmPolicy = input.dmPolicy;
    if (input.installMethod !== undefined) updates.installMethod = input.installMethod;
    if (input.pkgManager !== undefined) updates.pkgManager = input.pkgManager;
    if (input.gatewayPort !== undefined) updates.gatewayPort = input.gatewayPort;
    if (input.gatewayBind !== undefined) updates.gatewayBind = input.gatewayBind;
    if (input.enableWhatsapp !== undefined) updates.enableWhatsapp = input.enableWhatsapp ? 1 : 0;
    if (input.enableTelegram !== undefined) updates.enableTelegram = input.enableTelegram ? 1 : 0;
    if (input.enableDiscord !== undefined) updates.enableDiscord = input.enableDiscord ? 1 : 0;

    await ctx.db
      .update(serverProvisionConfigs)
      .set(updates)
      .where(eq(serverProvisionConfigs.id, existing.id));

    return existing.id;
  }

  const id = newId();
  await ctx.db.insert(serverProvisionConfigs).values({
    id,
    serverId,
    tenantId: ctx.tenantId,
    sshHost: input.sshHost ?? null,
    sshUser: input.sshUser ?? 'root',
    sshPort: input.sshPort ?? 22,
    apiKey: apiKeyEncrypted ?? null,
    apiKeyIv: apiKeyIv ?? null,
    agentName: input.agentName ?? null,
    sandboxMode: (input.sandboxMode ?? 'non-main') as 'non-main' | 'always' | 'never',
    dmPolicy: (input.dmPolicy ?? 'pairing') as 'pairing' | 'solo' | 'disabled',
    installMethod: (input.installMethod ?? 'package') as 'package' | 'source',
    pkgManager: (input.pkgManager ?? 'npm') as 'npm' | 'bun',
    gatewayPort: input.gatewayPort ?? 18789,
    gatewayBind: (input.gatewayBind ?? 'loopback') as 'loopback' | 'all',
    enableWhatsapp: input.enableWhatsapp ? 1 : 0,
    enableTelegram: input.enableTelegram ? 1 : 0,
    enableDiscord: input.enableDiscord ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

export async function getProvisionConfig(
  ctx: TenantContext,
  serverId: string,
): Promise<ProvisionConfig | null> {
  const [row] = await ctx.db
    .select()
    .from(serverProvisionConfigs)
    .where(
      and(
        eq(serverProvisionConfigs.serverId, serverId),
        eq(serverProvisionConfigs.tenantId, ctx.tenantId),
      ),
    );

  if (!row) return null;

  let decryptedApiKey: string | null = null;
  if (row.apiKey && row.apiKeyIv) {
    try {
      decryptedApiKey = decrypt(row.apiKey, row.apiKeyIv);
    } catch {
      decryptedApiKey = null;
    }
  }

  let phaseStatuses: Record<string, PhaseStatus> = {};
  try {
    phaseStatuses = JSON.parse(row.phaseStatuses ?? '{}');
  } catch {
    phaseStatuses = {};
  }

  return {
    id: row.id,
    serverId: row.serverId,
    sshHost: row.sshHost,
    sshUser: row.sshUser,
    sshPort: row.sshPort,
    apiKey: decryptedApiKey,
    agentName: row.agentName,
    sandboxMode: row.sandboxMode,
    dmPolicy: row.dmPolicy,
    installMethod: row.installMethod,
    pkgManager: row.pkgManager,
    gatewayPort: row.gatewayPort,
    gatewayBind: row.gatewayBind,
    enableWhatsapp: row.enableWhatsapp,
    enableTelegram: row.enableTelegram,
    enableDiscord: row.enableDiscord,
    phaseStatuses,
    lastProvisionAt: row.lastProvisionAt,
  };
}

export async function deleteProvisionConfig(
  ctx: TenantContext,
  serverId: string,
): Promise<void> {
  await ctx.db
    .delete(serverProvisionConfigs)
    .where(
      and(
        eq(serverProvisionConfigs.serverId, serverId),
        eq(serverProvisionConfigs.tenantId, ctx.tenantId),
      ),
    );
}

// ─── SSH Status Checks ──────────────────────────────────────────────────

interface SshCheckOptions {
  sshHost: string;
  sshUser: string;
  sshPort: number;
  agentName?: string;
  gatewayPort?: number;
}

export async function sshExec(
  host: string,
  user: string,
  port: number,
  command: string,
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    const proc = spawn('ssh', [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=5',
      '-o', 'BatchMode=yes',
      '-p', String(port),
      `${user}@${host}`,
      command,
    ]);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      resolve({ ok: code === 0, stdout: stdout.trim() });
    });
    proc.on('error', () => {
      resolve({ ok: false, stdout: '' });
    });
  });
}

export async function checkPhaseStatus(
  opts: SshCheckOptions,
): Promise<Record<string, PhaseStatus>> {
  const { sshHost, sshUser, sshPort, agentName, gatewayPort = 18789 } = opts;
  const minionUser = agentName ? `minion-${agentName.toLowerCase().replace(/\s+/g, '-')}` : 'minion';
  const results: Record<string, PhaseStatus> = {};

  // Phase 00: Preflight — user exists + node available
  const preflight = await sshExec(sshHost, sshUser, sshPort, `id ${minionUser} && which node`);
  results['00'] = preflight.ok ? 'complete' : 'pending';

  // Phase 20: User Creation — ~/.minion directory exists
  const userCreation = await sshExec(sshHost, sshUser, sshPort,
    `sudo -u ${minionUser} test -d /home/${minionUser}/.minion`);
  results['20'] = userCreation.ok ? 'complete' : 'pending';

  // Phase 30: Environment — Node 22+
  const env = await sshExec(sshHost, sshUser, sshPort, 'node --version');
  if (env.ok) {
    const major = parseInt(env.stdout.replace('v', '').split('.')[0], 10);
    results['30'] = major >= 22 ? 'complete' : 'pending';
  } else {
    results['30'] = 'pending';
  }

  // Phase 40: Install — minion package installed
  const install = await sshExec(sshHost, sshUser, sshPort,
    `sudo -u ${minionUser} bash -lc "minion --version" 2>/dev/null || npm list -g @nikolasp98/minion 2>/dev/null`);
  results['40'] = install.ok ? 'complete' : 'pending';

  // Phase 45: Alias — minion in PATH
  const alias = await sshExec(sshHost, sshUser, sshPort,
    `sudo -u ${minionUser} bash -lc "which minion"`);
  results['45'] = alias.ok ? 'complete' : 'pending';

  // Phase 50: Config — minion.json exists
  const config = await sshExec(sshHost, sshUser, sshPort,
    `sudo -u ${minionUser} test -f /home/${minionUser}/.minion/minion.json`);
  results['50'] = config.ok ? 'complete' : 'pending';

  // Phase 60: Service — systemd active
  const service = await sshExec(sshHost, sshUser, sshPort,
    `sudo -u ${minionUser} bash -c "XDG_RUNTIME_DIR=/run/user/$(id -u ${minionUser}) systemctl --user is-active minion-gateway"`);
  results['60'] = service.ok ? 'complete' : 'pending';

  // Phase 70: Verification — health endpoint
  const verify = await sshExec(sshHost, sshUser, sshPort,
    `curl -s --max-time 3 http://127.0.0.1:${gatewayPort}/health`);
  results['70'] = verify.ok && verify.stdout.length > 0 ? 'complete' : 'pending';

  return results;
}

// ─── Save phase statuses to DB ──────────────────────────────────────────

export async function savePhaseStatuses(
  ctx: TenantContext,
  serverId: string,
  statuses: Record<string, PhaseStatus>,
): Promise<void> {
  await ctx.db
    .update(serverProvisionConfigs)
    .set({
      phaseStatuses: JSON.stringify(statuses),
      updatedAt: nowMs(),
    })
    .where(
      and(
        eq(serverProvisionConfigs.serverId, serverId),
        eq(serverProvisionConfigs.tenantId, ctx.tenantId),
      ),
    );
}

// ─── Run Setup ──────────────────────────────────────────────────────────

function getSetupScriptPath(): string {
  return process.env.MINION_SETUP_PATH
    ?? path.resolve(process.cwd(), '../minion/setup/setup.sh');
}

export function runSetupPhase(
  config: ProvisionConfig,
  startFrom: string | undefined,
  signal: AbortSignal,
): ReadableStream<string> {
  const serverId = config.serverId;

  if (activeProvisions.has(serverId)) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue('ERROR: Provision already running for this server\n');
        controller.close();
      },
    });
  }

  activeProvisions.add(serverId);

  return new ReadableStream<string>({
    start(controller) {
      const setupPath = getSetupScriptPath();

      const args = [
        setupPath,
        '--non-interactive',
        '--mode=remote',
        `--vps-hostname=${config.sshHost}`,
        `--admin-user=${config.sshUser ?? 'niko'}`,
      ];

      if (config.agentName) args.push(`--agent-name=${config.agentName}`);
      if (config.gatewayPort) args.push(`--gateway-port=${config.gatewayPort}`);
      if (config.gatewayBind) args.push(`--gateway-bind=${config.gatewayBind}`);
      if (config.sandboxMode) args.push(`--sandbox-mode=${config.sandboxMode}`);
      if (config.dmPolicy) args.push(`--dm-policy=${config.dmPolicy}`);
      if (config.installMethod) args.push(`--install-method=${config.installMethod}`);
      if (config.pkgManager) args.push(`--pkg-manager=${config.pkgManager}`);
      if (config.enableWhatsapp) args.push('--enable-whatsapp');
      if (config.enableTelegram) args.push('--enable-telegram');
      if (config.enableDiscord) args.push('--enable-discord');
      if (startFrom) args.push(`--start-from=${startFrom}`);

      const env: Record<string, string> = { ...process.env as Record<string, string> };
      if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey;

      const proc = spawn('bash', args, { env });

      const onAbort = () => {
        proc.kill('SIGTERM');
      };
      signal.addEventListener('abort', onAbort, { once: true });

      const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

      proc.stdout.on('data', (data: Buffer) => {
        try {
          controller.enqueue(stripAnsi(data.toString()));
        } catch { /* stream closed */ }
      });

      proc.stderr.on('data', (data: Buffer) => {
        try {
          controller.enqueue(stripAnsi(data.toString()));
        } catch { /* stream closed */ }
      });

      proc.on('close', (code) => {
        activeProvisions.delete(serverId);
        signal.removeEventListener('abort', onAbort);
        try {
          controller.enqueue(`\n[Process exited with code ${code}]\n`);
          controller.close();
        } catch { /* stream closed */ }
      });

      proc.on('error', (err) => {
        activeProvisions.delete(serverId);
        signal.removeEventListener('abort', onAbort);
        try {
          controller.enqueue(`\nERROR: ${err.message}\n`);
          controller.close();
        } catch { /* stream closed */ }
      });
    },
    cancel() {
      activeProvisions.delete(serverId);
    },
  });
}
