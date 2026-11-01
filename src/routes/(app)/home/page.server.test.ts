import { describe, expect, it } from 'vitest';
import { load as home } from './+page.server';
import { load as homeSettings } from './settings/+page.server';

// Spec 046 S3: the assistant moved to /chat; bookmarks to /home keep working.
describe('/home redirects', () => {
  it('/home answers 308 to /chat', async () => {
    await expect(home({} as never)).rejects.toMatchObject({ status: 308, location: '/chat' });
  });

  it('/home/settings answers 308 to /chat/settings', async () => {
    await expect(homeSettings({} as never)).rejects.toMatchObject({
      status: 308,
      location: '/chat/settings',
    });
  });
});
