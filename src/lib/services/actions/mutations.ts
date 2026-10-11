import type { ActionRuntime } from './runtime.svelte';
import type { CommandContext, CommandOutcome } from './definition';

/** A response reached the client and the server explicitly rejected the command. */
export class MutationRejected extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'MutationRejected';
    this.status = status;
  }
}

export async function requireOk(response: Response, fallback: string): Promise<Response> {
  if (response.ok) return response;
  let message = fallback;
  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const body = (await response.json()) as { error?: unknown; message?: unknown };
      const detail = typeof body.error === 'string' ? body.error : body.message;
      if (typeof detail === 'string' && detail.trim()) message = detail;
    } else {
      const detail = await response.text();
      if (detail.trim()) message = detail;
    }
  } catch {
    // The HTTP status still proves rejection even when its optional body is malformed.
  }
  throw new MutationRejected(response.status, message);
}

function rejectedOutcome<T>(error: unknown): CommandOutcome<T> {
  if (error instanceof MutationRejected) {
    return { status: error.status === 409 ? 'conflict' : 'failed', error };
  }
  return { status: 'unknown', error };
}

function current(context?: CommandContext): boolean {
  return context?.isCurrent() ?? true;
}

function attempt<T>(
  context: CommandContext | undefined,
  id: string,
  work: () => Promise<T>,
): Promise<T> {
  return context ? context.attempt(id, work) : work();
}

export interface CheckedMutationOptions<T> {
  context?: CommandContext;
  attemptId: string;
  mutate: (signal?: AbortSignal) => Promise<T>;
  /** Called immediately after acknowledgement, before projection refresh. */
  onCommitted?: (value: T) => void;
  refresh?: () => Promise<void>;
  refreshAttemptId?: string;
}

/**
 * Execute one confirmed write through the existing CommandOutcome contract.
 * A failed projection is committed-refreshing and never grants write replay.
 */
export async function runCheckedMutation<T>(
  options: CheckedMutationOptions<T>,
): Promise<CommandOutcome<T>> {
  const { context } = options;
  let value: T;
  try {
    value = await attempt(context, options.attemptId, () => options.mutate(context?.signal));
  } catch (error) {
    return rejectedOutcome(error);
  }
  if (!current(context)) return { status: 'unknown' };
  context?.acknowledge();
  options.onCommitted?.(value);
  if (!options.refresh) return { status: 'succeeded', value };
  try {
    await attempt(context, options.refreshAttemptId ?? 'command.refresh', options.refresh);
    if (!current(context)) return { status: 'committed-refreshing', value };
    return { status: 'succeeded', value };
  } catch (error) {
    return { status: 'committed-refreshing', value, error };
  }
}

export interface CompoundMutationValue<T> {
  primary: T;
  followupError?: unknown;
}

export interface CompoundMutationOptions<T> {
  context?: CommandContext;
  /** Present only while repairing an already acknowledged primary write. */
  committed?: T;
  primaryAttemptId: string;
  primary: (signal?: AbortSignal) => Promise<T>;
  followupAttemptId: string;
  followup: (primary: T, signal?: AbortSignal) => Promise<void>;
  onPrimaryCommitted?: (primary: T) => void;
  onFollowupCommitted?: (primary: T) => void;
  refresh?: (primary: T) => Promise<void>;
  refreshAttemptId?: string;
}

/**
 * Run a primary write followed by a separate write without ever replaying an
 * acknowledged primary. Known follow-up rejection is partial; a lost response
 * is unknown and must be reconciled before an explicit retry.
 */
export async function runCompoundMutation<T>(
  options: CompoundMutationOptions<T>,
): Promise<CommandOutcome<CompoundMutationValue<T>>> {
  const { context } = options;
  let primary = options.committed;
  if (primary === undefined) {
    try {
      primary = await attempt(context, options.primaryAttemptId, () =>
        options.primary(context?.signal),
      );
    } catch (error) {
      return rejectedOutcome(error);
    }
    if (!current(context)) return { status: 'unknown' };
    context?.acknowledge();
    options.onPrimaryCommitted?.(primary);
  }

  let outcome: CommandOutcome<CompoundMutationValue<T>> | undefined;
  try {
    await attempt(context, options.followupAttemptId, () =>
      options.followup(primary as T, context?.signal),
    );
  } catch (error) {
    outcome =
      error instanceof MutationRejected
        ? { status: 'partial', value: { primary: primary as T, followupError: error } }
        : { status: 'unknown', error };
  }
  if (!current(context)) return { status: 'unknown' };
  if (!outcome) {
    context?.acknowledge();
    options.onFollowupCommitted?.(primary as T);
    outcome = { status: 'succeeded', value: { primary: primary as T } };
  }

  // The primary is committed in EVERY branch that reaches here, so the host's
  // refresh/navigation runs regardless of the follow-up — a lost tag write
  // must not leave the just-created row invisible until a manual reload
  // (owner 2026-10-10: "created… forced to refresh to see changes").
  if (!options.refresh) return outcome;
  try {
    await attempt(context, options.refreshAttemptId ?? 'command.refresh', () =>
      options.refresh!(primary as T),
    );
    if (!current(context) && outcome.status === 'succeeded')
      return { status: 'committed-refreshing', value: { primary: primary as T } };
    return outcome;
  } catch (error) {
    // A partial/unknown follow-up already demands attention; only a clean
    // write downgrades to "committed, refresh failed".
    return outcome.status === 'succeeded'
      ? { status: 'committed-refreshing', value: { primary: primary as T }, error }
      : outcome;
  }
}

/** Admission failure is known-unsent; post-dispatch surprises remain unknown. */
export async function runTrackedCommand<T>(
  runtime: Pick<ActionRuntime, 'runCommand'> | undefined,
  id: string,
  execute: (context?: CommandContext) => Promise<CommandOutcome<T>>,
): Promise<CommandOutcome<T>> {
  let started = false;
  try {
    const admitted = (context?: CommandContext) => {
      started = true;
      return execute(context);
    };
    return await (runtime ? runtime.runCommand(id, admitted) : admitted());
  } catch (error) {
    return started ? { status: 'unknown', error } : { status: 'failed', error };
  }
}
