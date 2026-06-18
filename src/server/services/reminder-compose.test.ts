import { describe, it, expect } from 'vitest';
import { reminderTemplate, composeReminder } from './reminder-compose';
import type { ReminderContext } from './reminder-compose';

const base: ReminderContext = {
  stage: 'confirmation',
  attendeeName: 'María',
  serviceTitle: 'Botox',
  staffName: 'Dra. Renzo',
  whenText: 'viernes 20 de junio, 03:00 p. m.',
  fromName: 'FACES',
  locale: 'es',
};

describe('reminderTemplate', () => {
  it('includes name, service, staff, when and business for confirmation', () => {
    const t = reminderTemplate(base);
    expect(t).toContain('María');
    expect(t).toContain('Botox');
    expect(t).toContain('Dra. Renzo');
    expect(t).toContain('FACES');
    expect(t).toContain('viernes 20 de junio');
  });

  it('uses distinct copy per stage', () => {
    const conf = reminderTemplate({ ...base, stage: 'confirmation' });
    const h24 = reminderTemplate({ ...base, stage: '24h' });
    const h2 = reminderTemplate({ ...base, stage: '2h' });
    expect(conf).not.toBe(h24);
    expect(h24).toContain('mañana');
    expect(h2).toContain('hoy');
  });

  it('handles missing name and staff gracefully', () => {
    const t = reminderTemplate({ ...base, attendeeName: null, staffName: null });
    expect(t).toContain('Hola 👋');
    expect(t).toContain('Botox');
    expect(t).not.toContain('con ');
  });
});

describe('composeReminder', () => {
  it('returns the template verbatim when personalize is off', async () => {
    const text = await composeReminder(base, false);
    expect(text).toBe(reminderTemplate(base));
  });
});
