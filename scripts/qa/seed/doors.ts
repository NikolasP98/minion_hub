/**
 * Doors — collection points (spec 041 S0, pairs with migration
 * 20261025100000_crm_doors.sql and, for the shared rate limit, 20261025110000_public_rate_limits.sql).
 * One active booking link (the scheduling seed
 * has only an expired one), one door per kind, a switched-off door, one form
 * submission, three days of anonymous counters and one contact whose
 * `first_touch` names the form door — so `/crm/doors` shows numbers on a
 * fresh stack. Configs follow contracts/data-model.md so S2/S5/S6 render them
 * unchanged once their kind modules land.
 */
import { createHash } from 'node:crypto';
import { matrixUuid, humanId } from './ids';
import { ORG_BUSINESS } from './tenancy';
import { EVENT_TYPE_PLAIN } from './scheduling';
import { PRODUCT_SERVICE_PLAIN, PRODUCT_TRACKED } from './catalog';
import type { SeedContext } from './db';

export const DOOR_BOOK_LINK = matrixUuid('doors.book-link.active');
export const DOOR_FORM = matrixUuid('doors.form.active');
export const DOOR_FAQ = matrixUuid('doors.faq.mixed-entries');
export const DOOR_OFFER = matrixUuid('doors.offer.two-products');
export const DOOR_OFF = matrixUuid('doors.door.inactive');
export const DOOR_CONTACT = matrixUuid('doors.contact.first-touch');
export const DOOR_SUBMISSION = matrixUuid('doors.submission.one');

const FORM_CONFIG = {
  fields: [
    { key: 'nombre', label: 'Nombre completo', type: 'text', required: true },
    { key: 'telefono', label: 'Teléfono', type: 'phone', required: true },
    { key: 'email', label: 'Correo', type: 'email', required: false },
    {
      key: 'motivo',
      label: 'Motivo de consulta',
      type: 'select',
      required: true,
      options: ['Botox', 'Rellenos', 'Otro'],
    },
  ],
  consentText: 'Acepto que FACES QA use mis datos para contactarme sobre mi consulta.',
  consentRequired: true,
};

export async function seed(ctx: SeedContext): Promise<void> {
  const { sql, register, now } = ctx;

  await sql`
    insert into sched_links (id, org_id, slug, title, event_type_ids, active, expires_at)
    values (${DOOR_BOOK_LINK}, ${ORG_BUSINESS}, 'qa-door-book', 'QA Door Booking Link', ${sql.array([EVENT_TYPE_PLAIN])}::uuid[], true, null)
    on conflict (org_id, slug) do update set active = true, expires_at = null
  `;
  register('doors.book-link.active', { table: 'sched_links', where: { id: DOOR_BOOK_LINK } });

  const doors: Array<{
    matrixId: string;
    id: string;
    kind: 'form' | 'faq' | 'offer';
    slug: string;
    title: string;
    active: boolean;
    config: unknown;
  }> = [
    {
      matrixId: 'doors.form.active',
      id: DOOR_FORM,
      kind: 'form',
      slug: 'qa-intake',
      title: 'Ficha de ingreso QA',
      active: true,
      config: FORM_CONFIG,
    },
    {
      matrixId: 'doors.faq.mixed-entries',
      id: DOOR_FAQ,
      kind: 'faq',
      slug: 'qa-faq',
      title: 'Preguntas frecuentes QA',
      active: true,
      config: {
        entries: [
          { id: 'q1', q: '¿Cuánto dura una consulta?', a: 'Unos 30 minutos.', status: 'approved' },
          { id: 'q2', q: '¿Atienden sábados?', a: 'Sí, de 9:00 a 13:00.', status: 'approved' },
          { id: 'q3', q: '¿Aceptan tarjeta?', a: 'Borrador sin aprobar.', status: 'draft' },
        ],
        whatsappNumber: '+51900000000',
      },
    },
    {
      matrixId: 'doors.offer.two-products',
      id: DOOR_OFFER,
      kind: 'offer',
      slug: 'qa-offer',
      title: 'Oferta QA',
      active: true,
      config: {
        productIds: [PRODUCT_SERVICE_PLAIN, PRODUCT_TRACKED],
        whatsappNumber: '+51900000000',
        bookingLinkId: DOOR_BOOK_LINK,
      },
    },
    {
      matrixId: 'doors.door.inactive',
      id: DOOR_OFF,
      kind: 'form',
      slug: 'qa-door-off',
      title: 'Puerta apagada QA',
      active: false,
      config: FORM_CONFIG,
    },
  ];
  for (const d of doors) {
    await sql`
      insert into crm_doors (id, org_id, kind, slug, title, active, config)
      values (${d.id}, ${ORG_BUSINESS}, ${d.kind}, ${d.slug}, ${d.title}, ${d.active}, ${sql.json(d.config as never)})
      on conflict (id) do update set
        slug = excluded.slug, title = excluded.title, active = excluded.active, config = excluded.config
    `;
    register(d.matrixId, { table: 'crm_doors', where: { id: d.id } });
  }

  const firstTouch = {
    door: `door:${DOOR_FORM}`,
    utm_source: 'instagram',
    utm_campaign: 'octubre',
    at: now.toISOString(),
  };
  await sql`
    insert into crm_contacts (id, org_id, human_id, display_name, source, first_touch)
    values (${DOOR_CONTACT}, ${ORG_BUSINESS}, ${humanId('CONT', 'doors.contact.first-touch')}, 'QA Door Lead', 'door:qa-intake', ${sql.json(firstTouch)})
    on conflict (id) do update set first_touch = excluded.first_touch, source = excluded.source
  `;
  await sql`
    insert into crm_contact_identities (org_id, contact_id, channel, external_id, handle)
    values (${ORG_BUSINESS}, ${DOOR_CONTACT}, 'whatsapp', '+51900000099', 'QA Door Lead')
    on conflict (org_id, channel, external_id) do nothing
  `;
  register('doors.contact.first-touch', { table: 'crm_contacts', where: { id: DOOR_CONTACT } });

  await sql`
    insert into crm_door_submissions (id, org_id, door_id, contact_id, payload, consent, consent_text, attribution)
    values (
      ${DOOR_SUBMISSION}, ${ORG_BUSINESS}, ${DOOR_FORM}, ${DOOR_CONTACT},
      ${sql.json({ nombre: 'QA Door Lead', telefono: '+51 900 000 099', motivo: 'Botox' })},
      true, ${FORM_CONFIG.consentText}, ${sql.json(firstTouch)}
    )
    on conflict (id) do nothing
  `;
  register('doors.submission.one', {
    table: 'crm_door_submissions',
    where: { id: DOOR_SUBMISSION },
  });

  // Three days of counters for the form door and the booking link (today-2 … today).
  for (let back = 0; back < 3; back++) {
    const day = new Date(now.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    for (const key of [`door:${DOOR_FORM}`, `book:${DOOR_BOOK_LINK}`]) {
      await sql`
        insert into crm_door_stats_daily (org_id, door_key, day, views, submissions, clicks)
        values (${ORG_BUSINESS}, ${key}, ${day}::date, ${5 + back}, ${back === 0 ? 1 : 0}, ${back})
        on conflict (org_id, door_key, day) do update set views = excluded.views, submissions = excluded.submissions, clicks = excluded.clicks
      `;
    }
  }
  register('doors.stats.three-days', {
    table: 'crm_door_stats_daily',
    where: { org_id: ORG_BUSINESS, door_key: `door:${DOOR_FORM}` },
  });

  // Same key shape and hash as src/server/auth/shared-rate-limit.ts + the submit route.
  const bucket = createHash('sha256').update('door-submit:203.0.113.41:qa-intake').digest('hex');
  await sql`
    insert into public_rate_limits (bucket, window_start, hits)
    values (${bucket}, now() - interval '10 minutes', 5)
    on conflict (bucket) do update set window_start = excluded.window_start, hits = excluded.hits
  `;
  register('doors.rate-limit.stale-window', { table: 'public_rate_limits', where: { bucket } });
}
