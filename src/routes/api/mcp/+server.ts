import { json, type RequestHandler } from '@sveltejs/kit';
import {
  runWithEffectiveAuthority,
  runWithRequestCapabilities,
} from '$server/auth/effective-authority';
import { resolveMcpCaller } from '$server/mcp/caller';
import { handleMcp } from '$server/mcp/protocol';
import { sandboxFailure, sandboxToolsFor } from '$server/mcp/sandbox-tools';
import { hasOrgCapability } from '$server/services/rbac.service';

// Spec 136 S5 + 143. Stateless JSON-RPC over POST; no GET (SvelteKit answers 405 for the
// missing verb). Authentication — org API key or hub-issued connection credential — is
// decided in `resolveMcpCaller`, before the body is read.
const MAX_BODY_CHARS = 256 * 1024;

export const POST: RequestHandler = async (event) => {
  const caller = await resolveMcpCaller(event);
  if (caller instanceof Response) return caller;

  const text = await event.request.text();
  if (text.length > MAX_BODY_CHARS)
    return json({ error: 'The request body is too large.' }, { status: 413 });

  const reply =
    caller.kind === 'key'
      ? await handleMcp(
          text,
          sandboxToolsFor('key'),
          { ctx: caller.ctx, keyId: caller.keyId },
          sandboxFailure,
        )
      : // A cookie on the same request may carry role simulation or admitted capabilities; neither
        // may apply to a connection credential (P4), so both scopes are cleared for the dispatch.
        await runWithEffectiveAuthority(undefined, () =>
          runWithRequestCapabilities(undefined, async () => {
            const mayUseSandbox =
              !caller.sandboxBlocked &&
              (await hasOrgCapability(caller.locals, 'settings', 'manage'));
            return handleMcp(
              text,
              sandboxToolsFor('user'),
              { ctx: caller.ctx, locals: caller.locals, sandboxBlocked: caller.sandboxBlocked },
              sandboxFailure,
              sandboxToolsFor('user', mayUseSandbox),
            );
          }),
        );
  return reply.body === undefined
    ? new Response(null, { status: reply.status })
    : json(reply.body, { status: reply.status });
};
