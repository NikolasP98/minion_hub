/** Sentry's standard Authorization scrubber does not know our forwarded user JWT header. */
export function redactGatewayCredential<
  T extends { request?: { headers?: Record<string, string> } },
>(event: T): T {
  if (!event.request?.headers) return event;
  const headers = Object.fromEntries(
    Object.entries(event.request.headers).filter(
      ([key]) => key.toLowerCase() !== 'x-minion-user-jwt',
    ),
  );
  return { ...event, request: { ...event.request, headers } };
}
