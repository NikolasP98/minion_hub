import { json, type RequestHandler } from '@sveltejs/kit';
import * as Sentry from '@sentry/sveltekit';
import {
  authorizeWorkshopSave,
  GatewayAuthorityError,
} from '$server/services/gateway-resource-authority.service';

/** Admission is read-only and authenticates both credentials independently of browser cookies. */
export const GET: RequestHandler = async ({ params, request }) => {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    return json(
      await authorizeWorkshopSave({
        saveId: params.id ?? '',
        authorization: request.headers.get('authorization'),
        userJwt: request.headers.get('x-minion-user-jwt'),
        serverId: request.headers.get('x-minion-server-id'),
      }),
      { headers },
    );
  } catch (error) {
    if (error instanceof GatewayAuthorityError) {
      return json({ error: error.message }, { status: error.status, headers });
    }
    // Do not attach the request, signed user token, bearer, or decrypted credential.
    Sentry.captureException(new Error('Workshop authority unavailable'), {
      tags: { operation: 'workshop.authority' },
    });
    return json({ error: 'Workshop authority unavailable' }, { status: 503, headers });
  }
};
