import { z } from 'zod';
import { SunatSireClient, type SireCreds } from './sunat-sire-client';

const optionalTrimmed = (max: number) => z.string().trim().min(1).max(max).optional();

export const sunatSourceConfigSchema = z.object({
  ruc: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'RUC must contain 11 digits'),
  clientId: z.string().trim().min(1).max(500),
  legalName: z.string().trim().min(1).max(240),
  ubigeo: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Ubigeo must contain 6 digits')
    .optional(),
  address: optionalTrimmed(500),
  startPeriod: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Start period must use YYYYMM')
    .optional(),
});

export type SunatSourceConfig = z.infer<typeof sunatSourceConfigSchema>;

export function parseSunatSourceConfig(config: unknown): SunatSourceConfig {
  return sunatSourceConfigSchema.parse(config);
}

export function emitterFromSunatConfig(config: unknown) {
  const parsed = parseSunatSourceConfig(config);
  return {
    ruc: parsed.ruc,
    razonSocial: parsed.legalName,
    ...(parsed.ubigeo ? { ubigeo: parsed.ubigeo } : {}),
    ...(parsed.address ? { address: parsed.address } : {}),
  };
}

export type SunatProbeResult = {
  status: 'valid';
  latencyMs: number;
  periodCount: number;
  latestPeriod: string | null;
  openPeriodCount: number;
};

type PeriodClient = Pick<SunatSireClient, 'periodos'>;
type PeriodClientFactory = (creds: SireCreds) => PeriodClient;

/**
 * Authenticate and perform one read-only SIRE request. This never submits,
 * changes, or acknowledges a SUNAT book and is safe to use as a live probe.
 */
export async function probeSunatCredentials(
  rawConfig: unknown,
  secrets: { username: string; password: string; clientSecret?: string },
  makeClient: PeriodClientFactory = (creds) => new SunatSireClient(creds),
): Promise<SunatProbeResult> {
  const config = parseSunatSourceConfig(rawConfig);
  if (!secrets.username || !secrets.password || !secrets.clientSecret) {
    throw new Error('stored SUNAT credentials are incomplete');
  }
  const startedAt = performance.now();
  const periods = await makeClient({
    ruc: config.ruc,
    clientId: config.clientId,
    username: secrets.username,
    password: secrets.password,
    clientSecret: secrets.clientSecret,
  }).periodos();
  const latestPeriod = periods.reduce<string | null>(
    (latest, row) => (!latest || row.perTributario > latest ? row.perTributario : latest),
    null,
  );
  return {
    status: 'valid',
    latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
    periodCount: periods.length,
    latestPeriod,
    openPeriodCount: periods.filter((row) => /^no\s+presentado$/i.test(row.desEstado.trim()))
      .length,
  };
}

export function classifySunatProbeError(cause: unknown): {
  status: 'invalid' | 'unavailable';
  message: string;
} {
  const raw = cause instanceof Error ? cause.message : String(cause);
  if (/decrypt|authenticate data|authentication tag|bad key/i.test(raw)) {
    return {
      status: 'invalid',
      message: 'Stored credentials could not be read. Save the credentials again.',
    };
  }
  const invalid =
    /sunat token failed:\s*(400|401|403)\b/i.test(raw) ||
    /credentials are incomplete|requires config|RUC must|Client ID|Legal name/i.test(raw);
  return invalid
    ? { status: 'invalid', message: 'SUNAT rejected the stored credentials.' }
    : {
        status: 'unavailable',
        message: 'SUNAT could not be reached. The stored credentials were not changed.',
      };
}
