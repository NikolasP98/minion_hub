/** A read-only handle to one authenticated gateway epoch, never a presentation timestamp. */
export interface GatewaySessionOwner {
  readonly token: symbol;
  readonly actorId: string;
  readonly orgId: string;
  readonly hostId: string;
  readonly hostUrl: string;
  readonly methods: readonly string[] | null;
  readonly current: () => boolean;
  readonly request: (method: string, params?: unknown) => Promise<unknown>;
}

let active = $state.raw<GatewaySessionOwner | null>(null);

/** Called only by the gateway facade after authenticated publication. */
export function publishGatewaySessionOwner(
  input: Omit<GatewaySessionOwner, 'token'>,
): GatewaySessionOwner {
  const owner: GatewaySessionOwner = Object.freeze({
    ...input,
    token: Symbol('authenticated-gateway-session'),
    methods: input.methods ? Object.freeze([...input.methods]) : null,
    current: () => active === owner && input.current(),
  });
  active = owner;
  return owner;
}

/** A stale socket must not retire the replacement's authenticated handle. */
export function retireGatewaySessionOwner(owner?: GatewaySessionOwner): void {
  if (owner && active !== owner) return;
  active = null;
}

export function captureGatewaySessionOwner(): GatewaySessionOwner | null {
  const owner = active;
  return owner?.current() ? owner : null;
}
