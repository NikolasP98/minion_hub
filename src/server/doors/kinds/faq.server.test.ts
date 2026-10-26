import { describe, expect, it } from 'vitest';
import { publicView } from './faq.server';
import { getServerDoorKind } from '../kinds';
import type { DoorRow } from '$lib/doors/types';

const door = (config: unknown) => ({ id: 'd1', kind: 'faq', config }) as unknown as DoorRow;

describe('faq publicView', () => {
  it('is registered', () => {
    expect(getServerDoorKind('faq')?.publicView).toBe(publicView);
  });

  it('returns approved entries only — drafts never reach the public page', async () => {
    const data = await publicView({} as never, {
      ...door({
        entries: [
          { id: 'q1', q: 'Uno', a: 'A1', status: 'approved' },
          { id: 'q3', q: 'Secreto', a: 'Borrador sin aprobar', status: 'draft' },
          { id: 'q2', q: 'Dos', a: 'A2', status: 'approved' },
        ],
        whatsappNumber: '+51900000000',
      }),
    });
    expect(data).toEqual({
      entries: [
        { q: 'Uno', a: 'A1' },
        { q: 'Dos', a: 'A2' },
      ],
      whatsappNumber: '+51900000000',
    });
    expect(JSON.stringify(data)).not.toContain('Borrador');
  });

  it('shows nothing for a config that fails the schema', async () => {
    expect(await publicView({} as never, door({ entries: 'nope' }))).toEqual({
      entries: [],
      whatsappNumber: null,
    });
  });
});
