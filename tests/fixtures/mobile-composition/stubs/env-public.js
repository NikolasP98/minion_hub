// Fixture stub for $env/dynamic/public and $env/static/public: no secrets, no
// real endpoints. The gateway URL stays empty so nothing connects.
// The synthetic fixtures have no hub session, so the JEV turn router stays
// off: the credential-free journey harness blocks every non-GET request.
export const env = { PUBLIC_ASSISTANT_ROUTER: 'off' };
export const PUBLIC_GATEWAY_URL = '';
