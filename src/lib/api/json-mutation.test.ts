import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonMutation, mutationErrorMessage } from './json-mutation';

afterEach(() => vi.unstubAllGlobals());

describe('jsonMutation', () => {
  it('does not commit local UI state for a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'Conflict' }, { status: 409 })),
    );
    const onSuccess = vi.fn();

    await expect(
      jsonMutation({ input: '/api/item', init: { method: 'DELETE' }, onSuccess }),
    ).rejects.toMatchObject({ status: 409, message: 'Conflict' });

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('commits only after the successful response body is available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'created' })));
    const committed: string[] = [];

    await jsonMutation<{ id: string }>({
      input: '/api/item',
      init: { method: 'POST' },
      onSuccess: ({ id }) => {
        committed.push(id);
      },
    });

    expect(committed).toEqual(['created']);
  });
});

describe('mutationErrorMessage', () => {
  it('keeps a meaningful API error and otherwise uses the supplied fallback', () => {
    expect(mutationErrorMessage(new Error('Permission denied'), 'Request failed')).toBe(
      'Permission denied',
    );
    expect(mutationErrorMessage('offline', 'Request failed')).toBe('Request failed');
  });
});
