import { describe, expect, it } from 'vitest';
import { OperatorAuthorityError } from '$server/auth/active-operator-principal';
import { active, constraintOf } from './stock-corrections.service';

const fail = (code: ConstructorParameters<typeof OperatorAuthorityError>[0]) =>
  active(Promise.reject(new OperatorAuthorityError(code)));

describe('authority refusal mapping', () => {
  it.each(['operator_principal_inactive', 'operator_scope_invalid'] as const)(
    '%s is a 403',
    async (code) => {
      await expect(fail(code)).rejects.toMatchObject({ code: 'forbidden' });
    },
  );
  it.each([
    'operator_authority_unavailable',
    'operator_authority_limit',
    'operator_authority_inconsistent',
  ] as const)('%s is a retryable 503, not a refusal', async (code) => {
    await expect(fail(code)).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('other errors pass through', async () => {
    const e = new Error('x');
    await expect(active(Promise.reject(e))).rejects.toBe(e);
  });
});

describe('constraintOf', () => {
  it('reads the violated constraint from the driver error or its cause', () => {
    const e = new Error('wrap', { cause: { code: '23505', constraint_name: 'other_uniq' } });
    expect(constraintOf(e)).toBe('other_uniq');
    expect(constraintOf(new Error('x'))).toBeNull();
  });
});
