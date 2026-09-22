export type ActionVisibility = 'foreground' | 'background';

export interface ReadAction<I, O> {
  readonly id: string;
  readonly policy: 'read';
  readonly visibility: ActionVisibility;
  readonly execute: (input: I, context: { signal: AbortSignal }) => Promise<O>;
}

export type CommandOutcome<T> =
  | { status: 'succeeded'; value: T }
  | { status: 'failed' | 'conflict' | 'unknown'; error?: unknown }
  | { status: 'committed-refreshing'; value?: T; error?: unknown }
  | { status: 'partial'; value: T };

export interface CommandContext {
  readonly signal: AbortSignal;
  readonly actionId: number;
  /** The server acknowledged the write. A subsequent refresh error is not rollback. */
  acknowledge(): void;
  /** Requests are children of a logical action, never independent global spinners. */
  attempt<T>(id: string, work: () => Promise<T>): Promise<T>;
  isCurrent(): boolean;
  /** Accepted durable server job. The submission spinner becomes a job count. */
  attachJob(jobId: string): void;
  progress(completed: number, total: number): void;
}

export interface CommandAction<I, O> {
  readonly id: string;
  readonly policy: 'confirmed';
  readonly visibility: ActionVisibility;
  readonly execute: (input: I, context: CommandContext) => Promise<CommandOutcome<O>>;
}

function validate(id: string, visibility: ActionVisibility) {
  if (!/^[a-z][a-z0-9.-]*$/.test(id) || !['foreground', 'background'].includes(visibility)) {
    throw new TypeError('Action requires a stable id and a supported visibility');
  }
}

/** Code-authored definitions; input/output never enter the shared activity history. */
export function defineAction<I, O>(definition: ReadAction<I, O>): ReadAction<I, O> {
  validate(definition.id, definition.visibility);
  if (definition.policy !== 'read') throw new TypeError('Unsupported read policy');
  return Object.freeze({ ...definition });
}

/** Confirmed adapters classify business outcomes explicitly, including resolved false. */
export function defineCommandAction<I, O>(definition: CommandAction<I, O>): CommandAction<I, O> {
  validate(definition.id, definition.visibility);
  if (definition.policy !== 'confirmed') throw new TypeError('Unsupported command policy');
  return Object.freeze({ ...definition });
}
