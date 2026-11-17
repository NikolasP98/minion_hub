import { describe, expect, it, vi } from 'vitest';
import {
  assertOperatorNativeAuthFixture,
  installOperatorNativeAuthFixture,
  type OwnedChildIdentity,
} from './operator-native-auth-fixture';

const id: OwnedChildIdentity = {
  name: `minion_qc_faces_audit_${'a'.repeat(32)}`,
  marker: 'minion-360-disposable:v1',
  prefix: 'audit',
};

describe('operator native auth fixture guards', () => {
  it('refuses a controller or shared database before any DDL', async () => {
    const unsafe = vi.fn();
    await expect(
      installOperatorNativeAuthFixture({ unsafe }, { ...id, name: 'minion_qc_vectors' }),
    ).rejects.toThrow(/owned feature child/);
    expect(unsafe).not.toHaveBeenCalled();
  });

  it('refuses a child whose recorded identity does not match the connection', async () => {
    const unsafe = vi.fn(async () => [{ db: 'other', marker: id.marker, super: true }]);
    await expect(assertOperatorNativeAuthFixture({ unsafe }, id)).rejects.toThrow(
      /qualified owned child/,
    );
    expect(unsafe).toHaveBeenCalledTimes(1);
  });

  it('refuses a non-inert pre-existing sentinel role', async () => {
    const unsafe = vi.fn(async (q: string) =>
      q.includes('current_database()')
        ? [{ db: id.name, marker: id.marker, super: true }]
        : [
            {
              rolcanlogin: true,
              rolinherit: false,
              rolsuper: false,
              rolbypassrls: false,
              edges: false,
            },
          ],
    );
    await expect(installOperatorNativeAuthFixture({ unsafe }, id)).rejects.toThrow(/not inert/);
  });
});
