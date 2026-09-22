import { describe, expect, it } from 'vitest';
import { identityNamesMatch, missingFields } from './repair-verified-customer-metadata';

const registryPerson = {
  id: 'provider-id',
  nombres: 'ANA MARIA',
  apellido_paterno: 'PEREZ',
  apellido_materno: 'DIAZ',
  nombre_completo: 'PEREZ DIAZ ANA MARIA',
  genero: 'F',
  fecha_nacimiento: '01/02/2000',
  codigo_verificacion: 'x',
};

describe('verified-customer metadata repair planning', () => {
  it('selects only absent identity fields', () => {
    expect(missingFields({ name: 'Ana Pérez', dob: null, sex: 'F' })).toEqual({
      name: false,
      dob: true,
      sex: false,
    });
  });

  it('treats blank name and sex as missing', () => {
    expect(missingFields({ name: '  ', dob: '2000-01-02', sex: '' })).toEqual({
      name: true,
      dob: false,
      sex: true,
    });
  });

  it('does not plan writes for complete metadata', () => {
    expect(missingFields({ name: 'Ana Pérez', dob: '2000-01-02', sex: 'F' })).toEqual({
      name: false,
      dob: false,
      sex: false,
    });
  });

  it('requires the prior verified registry name and agrees with a populated party name', () => {
    expect(identityNamesMatch('Ana Perez Diaz', 'PEREZ DIAZ ANA MARIA', registryPerson)).toBe(true);
    expect(identityNamesMatch('Different Person', 'PEREZ DIAZ ANA MARIA', registryPerson)).toBe(
      false,
    );
    expect(identityNamesMatch('Ana Perez Diaz', null, registryPerson)).toBe(false);
  });

  it('allows a missing party name only when the prior verified registry name matches', () => {
    expect(identityNamesMatch(null, 'PEREZ DIAZ ANA MARIA', registryPerson)).toBe(true);
    expect(identityNamesMatch(' ', 'Different Person', registryPerson)).toBe(false);
  });
});
