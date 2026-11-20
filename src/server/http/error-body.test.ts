import { describe, expect, it } from 'vitest';
import { errorBody } from './error-body';

describe('errorBody', () => {
  it('carries the sentence in message and error, and the code', () => {
    expect(errorBody('Nope', 'nope_code')).toEqual({
      message: 'Nope',
      error: 'Nope',
      code: 'nope_code',
    });
  });

  it('merges extra, and extra wins', () => {
    expect(errorBody('Nope', 'c', { items: [1], error: 'c' })).toEqual({
      message: 'Nope',
      error: 'c',
      code: 'c',
      items: [1],
    });
  });
});
