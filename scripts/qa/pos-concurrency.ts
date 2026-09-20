/** Seeded-loopback qualification: bun scripts/qa/pos-concurrency.ts.
 * Uses a private owner HTTP session and fresh fixture IDs; never resets seeds.
 * Leaves its marked, voided tickets as audit evidence in the disposable QA DB.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import postgres from 'postgres';
import { matrixUuid } from './seed/ids';

const env = parseEnv(readFileSync('.env.qa', 'utf8'));
const personas = parseEnv(readFileSync('.env.qa.local', 'utf8'));
const origin = 'http://127.0.0.1:5199';
const dbUrl = new URL(env.SUPABASE_DB_URL!);
assert(['127.0.0.1', 'localhost'].includes(dbUrl.hostname), 'QA DB must be loopback');
assert(['127.0.0.1', 'localhost'].includes(new URL(env.PUBLIC_SUPABASE_URL!).hostname));
const sql = postgres(dbUrl.toString(), { max: 3 });
const org = matrixUuid('tenancy.org.business');
const party = matrixUuid('crm.contact.dni-verified', 'party');
const run = `pos-concurrency-${crypto.randomUUID()}`;
const cookies = new Map<string, string>([['active_org', org]]);
const tickets = new Set<string>();
let fixtureGrant: string | null = null;
let fixturePlan: string | null = null;
type ApiBody = {
  code?: string;
  error?: string;
  ok?: boolean;
  ticket?: { id: string };
  redemption?: { id: string };
  plan?: { id: string };
};
async function api(path: string, body?: unknown) {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const split = pair!.indexOf('=');
    cookies.set(pair!.slice(0, split), pair!.slice(split + 1));
  }
  const result = (await response.json()) as ApiBody;
  if (response.status === 201 && result.ticket) tickets.add(result.ticket.id);
  return { status: response.status, body: result };
}
const report: Record<string, unknown> = { run };
try {
  const login = await api('/api/auth/password-login', {
    identifier: personas.QA_OWNER_EMAIL,
    password: personas.QA_OWNER_PASSWORD,
  });
  assert.equal(login.status, 200, 'seeded owner login');
  const [source] = await sql`select * from pos_package_grants where org_id=${org} limit 1`;
  assert(source, 'seeded package grant required');
  const grant = crypto.randomUUID();
  fixtureGrant = grant;
  await sql`insert into pos_package_grants
    (id,org_id,party_id,source_ticket_id,source_line_id,package_product_id,service_product_id,sessions_total,unit_value)
    values (${grant},${org},${party},${source.source_ticket_id},${source.source_line_id},
      ${source.package_product_id},${source.service_product_id},1,80)`;
  report.grantId = grant;
  const draws = await Promise.all(
    [1, 2].map(() => api(`/api/pos/packages/grants/${grant}/redeem`, {})),
  );
  report.concurrentDraw = draws.map((r) => ({ status: r.status, code: r.body.code }));
  assert.deepEqual(draws.map((r) => r.status).sort(), [201, 409]);
  const redemption = draws.find((r) => r.status === 201)!.body.redemption!.id;
  const redeemedTicket = {
    partyId: party,
    note: run,
    payments: [],
    lines: [
      {
        kind: 'service',
        finProductId: source.service_product_id,
        description: run,
        qty: 1,
        unitPrice: 0,
        redemptionId: redemption,
      },
    ],
  };
  const charges = await Promise.all([1, 2].map(() => api('/api/pos/tickets', redeemedTicket)));
  report.concurrentRedemptionCharge = charges.map((r) => ({ status: r.status, code: r.body.code }));
  assert.deepEqual(charges.map((r) => r.status).sort(), [201, 409]);
  const redeemedTicketId = charges.find((r) => r.status === 201)!.body.ticket!.id;
  const voids = await Promise.all(
    [1, 2].map(() => api(`/api/pos/tickets/${redeemedTicketId}/void`, {})),
  );
  report.concurrentRedemptionVoid = voids.map((r) => ({ status: r.status, code: r.body.code }));
  assert.deepEqual(voids.map((r) => r.status).sort(), [200, 409]);
  const [red] =
    await sql`select reversed_at,ticket_id from pos_package_redemptions where id=${redemption}`;
  assert(red?.reversed_at, 'counter redemption reversed once');
  assert.equal(red.ticket_id, null);
  const redrawn = await api(`/api/pos/packages/grants/${grant}/redeem`, {});
  assert.equal(redrawn.status, 201, 'void restores counter session');
  report.redrawAfterVoid = redrawn.status;

  const planResponse = await api('/api/pos/plans', { partyId: party, title: run, totalAmount: 80 });
  assert.equal(planResponse.status, 201);
  const plan = planResponse.body.plan!.id;
  fixturePlan = plan;
  report.planId = plan;
  const instalment = (amount: number) => ({
    partyId: party,
    note: run,
    lines: [{ kind: 'service', description: run, qty: 1, unitPrice: amount, planId: plan }],
    payments: [{ method: 'cash', amount }],
  });
  const instalments = await Promise.all([1, 2].map(() => api('/api/pos/tickets', instalment(40))));
  report.concurrentInstalments = instalments.map((r) => ({ status: r.status, code: r.body.code }));
  assert.deepEqual(
    instalments.map((r) => r.status),
    [201, 201],
  );
  const paid = async () => {
    const [row] = await sql`select coalesce(sum(l.total),0)::text paid from pos_ticket_lines l
      join pos_tickets t on t.id=l.ticket_id and t.org_id=l.org_id
      where l.plan_id=${plan} and l.org_id=${org} and t.status not in ('void','voided')`;
    return Number(row!.paid);
  };
  assert.equal(await paid(), 80);
  const first = instalments[0]!.body.ticket!.id;
  const planVoids = await Promise.all([1, 2].map(() => api(`/api/pos/tickets/${first}/void`, {})));
  report.concurrentInstalmentVoid = planVoids.map((r) => ({ status: r.status, code: r.body.code }));
  assert.deepEqual(planVoids.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await paid(), 40);
  const replacement = await api('/api/pos/tickets', instalment(40));
  assert.equal(replacement.status, 201);
  assert.equal(await paid(), 80);
  report.instalmentReplacement = { status: replacement.status, paidToDate: await paid() };
  const overlap = await Promise.all([
    api(`/api/pos/tickets/${replacement.body.ticket!.id}/void`, {}),
    api('/api/pos/tickets', instalment(40)),
  ]);
  assert.deepEqual(
    overlap.map((r) => r.status),
    [200, 201],
  );
  assert.equal(await paid(), 80);
  report.instalmentSubmitDuringVoid = {
    statuses: overlap.map((r) => r.status),
    paidToDate: await paid(),
  };
  report.ticketIds = [...tickets];
  console.log(JSON.stringify(report, null, 2));
} finally {
  // Exact IDs created by this run only; retain financial history through void.
  for (const ticket of tickets) {
    const result = await api(`/api/pos/tickets/${ticket}/void`, {});
    assert([200, 409].includes(result.status), 'fixture ticket cleanup');
    if (result.status === 409) assert.equal(result.body.code, 'already_void');
  }
  // These IDs were inserted by this process, never seeded originals. Mark the
  // synthetic entitlement inactive so QA Accounts keeps its previous obligations.
  if (fixtureGrant) {
    await sql`update pos_package_redemptions set reversed_at=coalesce(reversed_at,now()),
      reversal_reason=coalesce(reversal_reason,${run + ' fixture cleanup'})
      where org_id=${org} and grant_id=${fixtureGrant}`;
    await sql`update pos_package_grants set status='cancelled',cancelled_at=now()
      where org_id=${org} and id=${fixtureGrant}`;
  }
  if (fixturePlan)
    await sql`update pos_payment_plans set status='cancelled',cancelled_at=now()
    where org_id=${org} and id=${fixturePlan}`;
  await sql.end();
}
