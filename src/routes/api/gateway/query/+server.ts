import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { ASSISTANT_SQL_DISABLED } from '$server/services/assistant-query.service';

/**
 * The old arbitrary-SQL endpoint is unavailable. Do not parse caller SQL or
 * initialize identity/database clients here. Module-specific /query/* routes
 * continue to enforce their own principal and capability contracts.
 */
export const POST: RequestHandler = async () => json(ASSISTANT_SQL_DISABLED, { status: 503 });
