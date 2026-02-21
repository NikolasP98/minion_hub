import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getDb } from '$server/db/client';
import { upsertMarketplaceAgents, type MarketplaceAgentUpsert } from '$server/services/marketplace.service';

const GITHUB_REPO = 'NikolasP98/minions';
const GITHUB_API = 'https://api.github.com';

async function fetchGitHubJson(path: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'minion-hub',
  };
  if (env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${env.GITHUB_TOKEN}`;
  }
  const res = await fetch(`${GITHUB_API}/${path}`, { headers });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function decodeBase64(encoded: string): string {
  // Remove newlines from base64 content, then decode as UTF-8
  const clean = encoded.replace(/\n/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401);

  const errors: string[] = [];
  const agents: MarketplaceAgentUpsert[] = [];

  try {
    const contents = await fetchGitHubJson(`repos/${GITHUB_REPO}/contents/agents`) as Array<{
      name: string;
      type: string;
      path: string;
    }>;

    const dirs = contents.filter((c) => c.type === 'dir');

    await Promise.all(
      dirs.map(async (dir) => {
        try {
          const basePath = `repos/${GITHUB_REPO}/contents/agents/${dir.name}`;

          // Fetch agent.json + all md files in parallel
          const [agentJsonRes, soulRes, identityRes, userRes, contextRes, skillsRes] =
            await Promise.allSettled([
              fetchGitHubJson(`${basePath}/agent.json`),
              fetchGitHubJson(`${basePath}/SOUL.md`),
              fetchGitHubJson(`${basePath}/IDENTITY.md`),
              fetchGitHubJson(`${basePath}/USER.md`),
              fetchGitHubJson(`${basePath}/CONTEXT.md`),
              fetchGitHubJson(`${basePath}/SKILLS.md`),
            ]);

          if (agentJsonRes.status !== 'fulfilled') {
            errors.push(`${dir.name}: missing agent.json`);
            return;
          }

          const agentFile = agentJsonRes.value as { content?: string; encoding?: string };
          if (!agentFile.content) {
            errors.push(`${dir.name}: empty agent.json`);
            return;
          }

          const agentJson = JSON.parse(decodeBase64(agentFile.content)) as {
            id: string;
            name: string;
            role: string;
            category: string;
            tags: string[];
            description: string;
            catchphrase?: string;
            version: string;
            model?: string;
            avatarSeed: string;
          };

          const decode = (res: PromiseSettledResult<unknown>): string | undefined => {
            if (res.status !== 'fulfilled') return undefined;
            const f = res.value as { content?: string };
            if (!f.content) return undefined;
            try { return decodeBase64(f.content); } catch { return undefined; }
          };

          agents.push({
            id: agentJson.id,
            name: agentJson.name,
            role: agentJson.role,
            category: agentJson.category,
            tags: agentJson.tags ?? [],
            description: agentJson.description,
            catchphrase: agentJson.catchphrase,
            version: agentJson.version,
            model: agentJson.model,
            avatarSeed: agentJson.avatarSeed,
            githubPath: `agents/${dir.name}`,
            soulMd: decode(soulRes),
            identityMd: decode(identityRes),
            userMd: decode(userRes),
            contextMd: decode(contextRes),
            skillsMd: decode(skillsRes),
          });
        } catch (err) {
          errors.push(`${dir.name}: ${(err as Error).message}`);
        }
      }),
    );

    const db = getDb();
    const results = await upsertMarketplaceAgents(db, agents);
    const synced = results.filter((r) => r.ok).length;

    return json({ synced, errors });
  } catch (err) {
    throw error(500, `Sync failed: ${(err as Error).message}`);
  }
};
