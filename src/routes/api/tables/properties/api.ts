import { error } from '@sveltejs/kit';
import type { CoreCtx } from '$server/auth/core-ctx';
import { CustomPropertyError } from '$server/services/custom-properties.service';

export function propertyApiError(cause: unknown): never {
  if (cause instanceof CustomPropertyError) throw error(cause.status, cause.code);
  throw cause;
}

export function requireActor(ctx: CoreCtx): void {
  if (!ctx.profileId) throw error(401, 'authentication_required');
}
