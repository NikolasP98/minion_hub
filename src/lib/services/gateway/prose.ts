// Phase D-0f — externalized section prose read/write (split from gateway.svelte.ts).
// Pure leaf RPCs: just wraps `sendRequest`. Imported through the gateway facade.

import { sendRequest } from '../gateway-rpc';

export interface ProseReadParams {
  layer: 'platform' | 'agent-type' | 'identity' | 'user' | 'session';
  sectionId: string;
  variant?: string;
  scope: 'global' | 'agent';
  /** Required when scope === 'agent'. The server derives the workspace path
   * from this — clients no longer send a path (D-0f-1.5 security fix). */
  agentId?: string;
}

export interface ProseReadResult {
  path: string;
  content: string;
  exists: boolean;
  scope: 'global' | 'agent';
  /** D-0f-1.5: present when the section ships a Tier-1 default template
   * and the file doesn't exist yet. Hub uses this to power the
   * "Initialize from default" empty-state button. */
  templateDefault?: string;
  /** D-0g-2: filesystem mtime — pass back as expectedMtimeMs on the next
   * write to enable optimistic-concurrency conflict detection. */
  mtimeMs?: number;
  /** D-0g-3: section's `cacheable` flag — when true, editing this prose
   * invalidates the Anthropic prompt-cache prefix on the next request. */
  cacheable?: boolean;
}

export async function readSectionProse(params: ProseReadParams): Promise<ProseReadResult> {
  const res = await sendRequest('prompt.sections.prose.read', params);
  return res as ProseReadResult;
}

export interface ProseWriteResult {
  path: string;
  bytes: number;
  /** D-0g-2: post-write mtime to thread into the next write. */
  mtimeMs?: number;
}

/** D-0g-2: thrown by writeSectionProse when the gateway returns CONFLICT.
 *  Carries the expected vs actual mtimes so the UI can show "file changed,
 *  reload?" without re-parsing the raw error. */
export class ProseConflictError extends Error {
  expectedMtimeMs: number | undefined;
  actualMtimeMs: number | undefined;
  constructor(message: string, expected: number | undefined, actual: number | undefined) {
    super(message);
    this.name = 'ProseConflictError';
    this.expectedMtimeMs = expected;
    this.actualMtimeMs = actual;
  }
}

export async function writeSectionProse(
  params: ProseReadParams & { content: string; expectedMtimeMs?: number },
): Promise<ProseWriteResult> {
  try {
    const res = await sendRequest('prompt.sections.prose.write', params);
    return res as ProseWriteResult;
  } catch (err: unknown) {
    // The shared GatewayClient surfaces ErrorShape via a thrown Error whose
    // message/code carry the CONFLICT label. Extract details when possible.
    const anyErr = err as {
      code?: string;
      details?: { expectedMtimeMs?: number; actualMtimeMs?: number };
      message?: string;
    };
    if (anyErr?.code === 'CONFLICT') {
      throw new ProseConflictError(
        anyErr.message ?? 'prose file changed since last read',
        anyErr.details?.expectedMtimeMs,
        anyErr.details?.actualMtimeMs,
      );
    }
    throw err;
  }
}

// Phase D-0g-1: FILE-source inspector. Read-only list of workspace files
// embedded by sections like project-context.
export interface WorkspaceFileEntry {
  path: string;
  chars: number;
  truncatedPreview: string;
  exists: boolean;
  synthetic?: boolean;
}

export async function listSectionWorkspaceFiles(agentId: string): Promise<WorkspaceFileEntry[]> {
  const res = (await sendRequest('prompt.sections.workspaceFiles.list', { agentId })) as {
    files: WorkspaceFileEntry[];
  };
  return res.files ?? [];
}
