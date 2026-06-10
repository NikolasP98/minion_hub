import { describeGatewayError, type GatewayErrorCtaKind } from '$lib/services/gateway-errors';

export const conn = $state({
  connected: false,
  connecting: false,
  closed: true,
  connectedAt: null as number | null,
  backoffMs: 800,
  particleHue: 'red' as 'blue' | 'amber' | 'red',
  // Human-readable headline for the current connection failure (set via
  // setConnectError → describeGatewayError). Null when connected / no error.
  connectError: null as string | null,
  // Actionable one-liner + raw machine reason + suggested CTA, for the banner.
  connectErrorHint: null as string | null,
  connectErrorRaw: null as string | null,
  connectErrorCta: 'none' as GatewayErrorCtaKind,
});

/** Set the structured connection error from a raw gateway reason. */
export function setConnectError(rawReason: string | null | undefined): void {
  const info = describeGatewayError(rawReason);
  conn.connectError = info.title;
  conn.connectErrorHint = info.hint;
  conn.connectErrorRaw = info.raw;
  conn.connectErrorCta = info.cta;
}

/** Clear any connection-error state (on successful connect / disconnect). */
export function clearConnectError(): void {
  conn.connectError = null;
  conn.connectErrorHint = null;
  conn.connectErrorRaw = null;
  conn.connectErrorCta = 'none';
}
