/** Fixture-only command boundary. No arbitrary source, URL, selector or command is accepted. */
export const EVAL_PROTOCOL = 'minion-agent-eval-fixture/v1';
export type EvalArm = 'full' | 'jev' | 'core_discovery';
export type EvalAssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'toolCall'; id: string; name: 'chat_artifact'; arguments: unknown };
export interface EvalMainResult {
  text?: string;
  choices?: Array<{ message?: { content?: string } }>;
  message?: { role: 'assistant'; content: EvalAssistantBlock[] };
}
export interface EvalReset {
  episodeId: string;
  arm: EvalArm;
  seed: number;
  persona: 'owner' | 'reader';
  initialState: 'empty' | 'one-element';
  initialStateHash?: string;
  locale: 'en' | 'es';
  surface?: 'home' | 'floating';
  sandbox?: boolean;
  revisions?: Record<string, string>;
  allowedTools?: string[];
  model: { requestedModel: string; boundDescriptor: string };
}
export type EvalTransition =
  | { action: 'owner'; actor: 'a' | 'b'; org: 'a' | 'b' }
  | { action: 'page'; page: 'home' | 'sandbox' | 'crm' }
  | { action: 'session'; session: 'main' | 'other' }
  | { action: 'release_reload'; fail?: boolean; order?: 'oldest' | 'latest' }
  | { action: 'hold_reload'; hold: boolean }
  | { action: 'window_reload' }
  | { action: 'duplicate_final' }
  | { action: 'history_reload' }
  | { action: 'compaction' }
  | { action: 'registry_change' }
  | { action: 'choice' | 'artifact'; index: number };
