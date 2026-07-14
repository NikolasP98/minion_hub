import { describe, expect, it, vi } from 'vitest';

vi.mock('$server/config/urls', () => ({
  hubBaseUrl: () => 'https://hub.example.test:8443/base',
}));

import { trustedWorkforceMutationHeaders } from './workforce-fetch';

describe('trustedWorkforceMutationHeaders', () => {
  it('derives the mutation boundary from canonical server config', () => {
    expect(trustedWorkforceMutationHeaders()).toEqual({
      origin: 'https://hub.example.test:8443',
      referer: 'https://hub.example.test:8443/',
      'x-forwarded-host': 'hub.example.test:8443',
      'x-forwarded-proto': 'https',
    });
  });
});
