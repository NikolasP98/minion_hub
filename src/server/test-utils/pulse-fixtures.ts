import type { openPulsePostgres } from './pulse-postgres';
export const PULSE_FIXTURE_ORG = '10000000-0000-4000-8000-000000000001';
export const PULSE_FIXTURE_PROFILE = '20000000-0000-4000-8000-000000000001';
export const PULSE_FIXTURE_GATEWAY = '30000000-0000-4000-8000-000000000001';
export async function seedPulseAuthority(
  fixture: Awaited<ReturnType<typeof openPulsePostgres>>,
  endpoint: string,
) {
  const pg = fixture.pg;
  await pg`insert into organizations(id,name,kind,status) values(${PULSE_FIXTURE_ORG},'Pulse fixture','personal','active')`;
  await pg`insert into profiles(id,email,personal_agent_id) values(${PULSE_FIXTURE_PROFILE},'pulse@example.invalid','personal-fixture')`;
  await pg`insert into organization_members(organization_id,profile_id,role) values(${PULSE_FIXTURE_ORG},${PULSE_FIXTURE_PROFILE},'owner')`;
  await pg`insert into gateway(id,org_id,name,url,channel,token_ciphertext,token_iv) values(${PULSE_FIXTURE_GATEWAY},${PULSE_FIXTURE_ORG},'Fixture',${endpoint},'prd','disposable-fixture-token','')`;
  await pg`insert into user_gateway(profile_id,gateway_id) values(${PULSE_FIXTURE_PROFILE},${PULSE_FIXTURE_GATEWAY})`;
  await pg`insert into personal_agents(id,profile_id,agent_id,gateway_id,display_name,provisioning_status) values('fixture-personal-agent',${PULSE_FIXTURE_PROFILE},'personal-fixture',${PULSE_FIXTURE_GATEWAY},'Fixture','active')`;
  await pg`insert into gateway_lease(org_id,channel,gateway_id,expires_at) values(${PULSE_FIXTURE_ORG},'prd',${PULSE_FIXTURE_GATEWAY},now()+interval '1 hour')`;
  const config = {
    enabled: true,
    tenantId: PULSE_FIXTURE_ORG,
    ownerProfileId: PULSE_FIXTURE_PROFILE,
    gatewayId: PULSE_FIXTURE_GATEWAY,
    channel: 'prd',
    endpoint,
    version: 'fixture-v1',
    commit: 'a'.repeat(40),
    bindingContract: 'cron-binding-v1',
    evidence: 'local-websocket-fixture',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    revision: 'fixture-1',
  };
  process.env.MINION_PULSE_WORKER_CONFIG = JSON.stringify(config);
  return config;
}
