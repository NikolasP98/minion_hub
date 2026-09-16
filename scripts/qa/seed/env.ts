/**
 * Writes `.env.qa.local` (mode 600): one `QA_<PERSONA>_EMAIL`/`QA_<PERSONA>_PASSWORD`
 * pair per `tenancy.user.*` matrix id, plus the `E2E_*` names
 * `tests/e2e/ui-audit/personas.ts` reads for the Playwright suite.
 */
import { writeFile } from 'node:fs/promises';
import { MATRIX } from './matrix';
import { personaEmail, QA_PASSWORD } from './ids';

const E2E_ALIASES: Record<string, string> = {
  'tenancy.user.owner': 'E2E_OWNER',
  'tenancy.user.manager': 'E2E_MANAGER',
  'tenancy.user.staff': 'E2E_MEMBER',
  'tenancy.user.viewer': 'E2E_RESTRICTED',
};

function envVarName(matrixId: string): string {
  return matrixId
    .replace(/^tenancy\.user\./, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .toUpperCase();
}

export async function writeQaEnv(filePath = '.env.qa.local'): Promise<void> {
  const users = MATRIX.filter(
    (entry) => entry.domain === 'tenancy' && entry.id.startsWith('tenancy.user.'),
  );
  const lines: string[] = [`QA_SEED_PASSWORD=${QA_PASSWORD}`];
  for (const user of users) {
    const email = personaEmail(user.id);
    lines.push(
      `QA_${envVarName(user.id)}_EMAIL=${email}`,
      `QA_${envVarName(user.id)}_PASSWORD=${QA_PASSWORD}`,
    );
    const alias = E2E_ALIASES[user.id];
    if (alias) lines.push(`${alias}_EMAIL=${email}`, `${alias}_PASSWORD=${QA_PASSWORD}`);
  }
  await writeFile(filePath, `${lines.join('\n')}\n`, { mode: 0o600 });
}
