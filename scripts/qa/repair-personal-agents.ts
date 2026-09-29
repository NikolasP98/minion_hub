#!/usr/bin/env bun
import postgres from 'postgres';
import { assertLoopback } from './seed/db';
import type { SeedContext } from './seed/db';
import { ensureSeededPersonalAgent } from './seed/tenancy';

export const QA_PERSONAL_AGENT_REPAIR_EMAILS = [
  'formula.persona.finance-masked@qa.minion.test',
  'presentation.persona.finance-masked-manager@qa.minion.test',
  'ui-audit-owner@minion.test',
  'ui-audit-manager@minion.test',
  'ui-audit-member@minion.test',
  'ui-audit-restricted@minion.test',
] as const;

export async function repairQaPersonalAgents(options: { apply: boolean }): Promise<{
  matched: number;
  needsRepair: number;
  repaired: number;
}> {
  const databaseUrl = assertLoopback(process.env.SUPABASE_DB_URL, 'SUPABASE_DB_URL');
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 1,
    connection: { application_name: 'minion-qa-personal-agent-repair' },
  });
  try {
    const profiles = await sql<
      {
        id: string;
        email: string;
        display_name: string | null;
        agent_id: string | null;
        provisioning_status: string | null;
        personal_agent_id: string | null;
      }[]
    >`
      select p.id, p.email, p.display_name, pa.agent_id, pa.provisioning_status,
        p.personal_agent_id
      from profiles p
      left join personal_agents pa on pa.profile_id = p.id
      where lower(btrim(p.email)) = any(${[...QA_PERSONAL_AGENT_REPAIR_EMAILS]})
      order by p.email
    `;
    if (profiles.length !== QA_PERSONAL_AGENT_REPAIR_EMAILS.length) {
      throw new Error(
        `Expected ${QA_PERSONAL_AGENT_REPAIR_EMAILS.length} QA profiles; found ${profiles.length}`,
      );
    }
    const needsRepair = profiles.filter(
      (profile) =>
        !profile.agent_id ||
        profile.provisioning_status !== 'active' ||
        profile.personal_agent_id !== profile.agent_id,
    );
    if (options.apply) {
      for (const profile of needsRepair) {
        await ensureSeededPersonalAgent(
          { sql: sql as SeedContext['sql'] },
          {
            profileId: profile.id,
            agentId: `personal-${profile.id}`,
            displayName: `${profile.display_name ?? 'QA'} agent`,
          },
        );
      }
    }
    return {
      matched: profiles.length,
      needsRepair: needsRepair.length,
      repaired: options.apply ? needsRepair.length : 0,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  const apply = process.argv.includes('--apply');
  const result = await repairQaPersonalAgents({ apply });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...result }, null, 2));
}
