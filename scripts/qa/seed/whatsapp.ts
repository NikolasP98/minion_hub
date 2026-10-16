import { matrixUuid, matrixTextId } from './ids';
import { ORG_BUSINESS } from './tenancy';
import type { SeedContext } from './db';

/** Synthetic accounts remain transport-disabled and cannot send real messages. */
export async function seed(ctx: SeedContext) {
  const gatewayId = matrixUuid('whatsapp.gateway');
  await ctx.sql`insert into gateway(id,org_id,name,url,channel) values(${gatewayId},${ORG_BUSINESS},'QA WhatsApp','http://127.0.0.1:18791','dev') on conflict(id) do nothing`;
  for (const [key, phone] of [
    ['reserved', '19995550101'],
    ['second-account', '19995550102'],
  ] as const) {
    const id = matrixTextId(`whatsapp.account.${key}`);
    await ctx.sql`insert into channels(id,tenant_id,gateway_id,type,label,account_id,provider_account_id,auth_ref,enabled,replies,settings)
    values(${id},${ORG_BUSINESS},${gatewayId},'whatsapp',${`QA ${key}`},${`qa-${key}`},${phone},${`whatsapp/qa-${key}`},false,'none','{"assistantMode":"off"}') on conflict(id) do nothing`;
    ctx.register(`whatsapp.account.${key}`, { table: 'channels', where: { id, enabled: false } });
  }
  ctx.register('whatsapp.lease.absent', {
    table: 'whatsapp_account_leases',
    where: { channel_id: matrixTextId('whatsapp.account.reserved') },
    expect: 'absent',
  });
}
