import { describe, expect, it, vi } from 'vitest';
import {
  classifySunatProbeError,
  emitterFromSunatConfig,
  probeSunatCredentials,
  parseSunatSourceConfig,
} from './sunat-source';

const config = {
  ruc: '20611172967',
  clientId: 'client-id',
  legalName: 'FACES SOCIEDAD ANONIMA CERRADA',
  ubigeo: '150101',
  address: 'Lima',
  startPeriod: '202608',
};

describe('SUNAT source configuration', () => {
  it('requires tenant emitter identity and SIRE OAuth coordinates', () => {
    expect(parseSunatSourceConfig(config)).toEqual(config);
    expect(() => parseSunatSourceConfig({ ...config, ruc: '123' })).toThrow();
    expect(() => parseSunatSourceConfig({ ...config, legalName: '' })).toThrow();
  });

  it('builds emission identity from the tenant source, never process-global env', () => {
    expect(emitterFromSunatConfig(config)).toEqual({
      ruc: '20611172967',
      razonSocial: 'FACES SOCIEDAD ANONIMA CERRADA',
      ubigeo: '150101',
      address: 'Lima',
    });
  });
});

describe('SUNAT live credential probe', () => {
  it('authenticates through a read-only periods request and returns bounded evidence', async () => {
    const periodos = vi.fn().mockResolvedValue([
      { perTributario: '202608', codEstado: '0', desEstado: 'No Presentado' },
      { perTributario: '202607', codEstado: '1', desEstado: 'Presentado' },
    ]);

    const result = await probeSunatCredentials(
      config,
      { username: 'SOLUSER', password: 'secret', clientSecret: 'client-secret' },
      () => ({ periodos }),
    );

    expect(periodos).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: 'valid',
      periodCount: 2,
      latestPeriod: '202608',
      openPeriodCount: 1,
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('does not leak upstream response bodies while classifying failures', () => {
    const rejected = classifySunatProbeError(
      new Error('sunat token failed: 401 — contains-sensitive-upstream-detail'),
    );
    expect(rejected).toEqual({
      status: 'invalid',
      message: 'SUNAT rejected the stored credentials.',
    });
    expect(JSON.stringify(rejected)).not.toContain('contains-sensitive');

    expect(
      classifySunatProbeError(new Error('Unsupported state or unable to authenticate data')),
    ).toEqual({
      status: 'invalid',
      message: 'Stored credentials could not be read. Save the credentials again.',
    });

    expect(classifySunatProbeError(new Error('sunat 503'))).toEqual({
      status: 'unavailable',
      message: 'SUNAT could not be reached. The stored credentials were not changed.',
    });
  });
});
