/**
 * Typed RPC wrapper for `shells.*` gateway methods.
 *
 * Mirrors my-agent-rpc.ts conventions. Types are inlined here until
 * `@minion-stack/shared@0.7.0` ships the canonical exports — at which point
 * this file flips to importing them from `@minion-stack/shared`.
 *
 * Spec: specs/2026-05-20-shells-golden-agents.md (in meta-repo).
 */

import { sendRequest } from './gateway-rpc';

// ---------------------------------------------------------------------------
// Types (mirror @minion-stack/shared/gateway/shells.ts byte-for-byte)
// ---------------------------------------------------------------------------

export type ShellHarness =
  | 'hermes'
  | 'claude-code'
  | 'opencode'
  | 'minion-drone'
  | 'pi'
  | (string & {});

export type CloudRuntime =
  | 'hermes'
  | 'obsidian-cli'
  | 'chromium'
  | 'claude-code'
  | 'opencode'
  | 'minion-drone'
  | 'pi';

export type ShellProvider = 'exedev' | (string & {});

export type ShellStatus = 'provisioning' | 'online' | 'archived' | 'error';

export type ShellErrorReason =
  | 'provision_failed'
  | 'bridge_unreachable'
  | 'backup_stuck'
  | 'restore_failed'
  | 'exedev_outage'
  | 'unknown';

export type ShellBackupCadence = 'hourly' | 'daily' | 'weekly' | 'manual';

export interface ShellSummary {
  shellId: string;
  orgId: string;
  vmName: string;
  displayName: string;
  provider: ShellProvider;
  blueprint: string;
  isDefault: boolean;
  harness: ShellHarness;
  runtimes: CloudRuntime[];
  image: string;
  region: string;
  status: ShellStatus;
  errorReason?: ShellErrorReason;
  errorMessage?: string;
  cpu: number;
  diskGB: number;
  memoryMB: number;
  sshHost?: string;
  sshCommand?: string;
  terminalUrl?: string;
  guiUrl?: string;
  noVncUrl?: string;
  archiveIdleMs: number | null;
  backupCadence: ShellBackupCadence;
  backupTarget: string;
  lastInvokeAt: number | null;
  lastBackupAt: number | null;
  lastBackupBytes: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ShellsQuota {
  shells: { used: number; limit: number };
  diskGB: { used: number; limit: number };
  memoryMB: { used: number; limit: number };
  shelleyUSD: { used: number; limit: number };
  egressGB: { used: number; limit: number };
  headroom: { diskGB: number };
}

export interface ShellsProvisionParams {
  displayName: string;
  harness: ShellHarness;
  orgId?: string;
  provider?: ShellProvider;
  blueprint?: string;
  /** A workspace can host several runtimes; `harness` remains the primary
   *  compatibility field for gateways predating the cloud workspace UI. */
  runtimes?: CloudRuntime[];
  image?: string;
  cpu?: number;
  region?: string;
  diskGB?: number;
  memoryMB?: number;
  archiveIdleMs?: number | null;
  backupCadence?: ShellBackupCadence;
  isDefault?: boolean;
  initialPrompt?: string;
}

export type ShellAccessKind = 'desktop' | 'terminal';

export interface ShellAccessSession {
  url: string;
  token?: string;
}

export interface ShellsProvisionResponse {
  shellId: string;
  vmName: string;
  status: ShellStatus;
  shell?: ShellSummary;
}

// ---------------------------------------------------------------------------
// RPCs
// ---------------------------------------------------------------------------

export async function listShells(): Promise<ShellSummary[]> {
  const res = (await sendRequest('shells.list')) as { shells: ShellSummary[] };
  return res.shells;
}

export async function getShell(shellId: string): Promise<ShellSummary> {
  return (await sendRequest('shells.get', { shellId })) as ShellSummary;
}

export async function getQuota(): Promise<ShellsQuota> {
  return (await sendRequest('shells.quota')) as ShellsQuota;
}

export async function provisionShell(
  params: ShellsProvisionParams,
): Promise<ShellsProvisionResponse> {
  return (await sendRequest('shells.provision', params)) as ShellsProvisionResponse;
}

/** Resolve the selected instance's provider-authenticated access endpoint.
 * Providers may later return a short-lived ticket in `token`; exe.dev keeps
 * authentication on its private GUI/terminal URL. */
export async function createShellAccess(
  shellId: string,
  kind: ShellAccessKind,
): Promise<ShellAccessSession> {
  return (await sendRequest('shells.access', { shellId, kind })) as ShellAccessSession;
}

export async function restartShell(
  shellId: string,
): Promise<{ shellId: string; status: ShellStatus }> {
  return (await sendRequest('shells.restart', { shellId })) as {
    shellId: string;
    status: ShellStatus;
  };
}

export async function archiveShell(
  shellId: string,
  skipBackup = false,
): Promise<{ shellId: string; status: 'archived'; backupId?: string; backupBytes?: number }> {
  return (await sendRequest('shells.archive', { shellId, skipBackup })) as {
    shellId: string;
    status: 'archived';
    backupId?: string;
    backupBytes?: number;
  };
}

export async function destroyShell(
  shellId: string,
  keepBackups = false,
): Promise<{ shellId: string; removedBackups: number }> {
  return (await sendRequest('shells.destroy', { shellId, keepBackups })) as {
    shellId: string;
    removedBackups: number;
  };
}

export async function backupNow(
  shellId: string,
): Promise<{ backupId: string; bytes: number; uploadMs: number }> {
  return (await sendRequest('shells.backup_now', { shellId })) as {
    backupId: string;
    bytes: number;
    uploadMs: number;
  };
}
