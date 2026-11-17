import { describe, expect, it } from 'vitest';
import { pickStoredKeys } from './crm-meta';

describe('pickStoredKeys', () => {
  it('keeps the stored dni / edad / fecha_nacimiento a whole-namespace save would delete', () => {
    const fields = { dni: '12345678', edad: '34', distrito: 'Lince', _funnel: {} };
    expect(pickStoredKeys(fields, ['dni'])).toEqual({ dni: '12345678' });
    expect(pickStoredKeys(fields, ['edad', 'fecha_nacimiento'])).toEqual({ edad: '34' });
  });
});
