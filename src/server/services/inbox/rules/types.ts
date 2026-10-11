import type { CoreCtx } from '$server/auth/core-ctx';
import type { Draft } from '$server/services/inbox/inbox.service';

export interface RuleResult {
  upserts: Draft[];
  /** Dedupe keys of previously-fired rows whose condition has cleared. */
  resolve: string[];
}

export interface Rule {
  key: string;
  evaluate(ctx: CoreCtx, now: Date): Promise<RuleResult>;
}
