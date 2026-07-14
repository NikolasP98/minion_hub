import type { CapturePersonaId } from '../../../src/lib/routes/route-design-manifest';

export interface CapturePersona {
  id: CapturePersonaId;
  emailEnv?: string;
  passwordEnv?: string;
  expectedAccess: 'public' | 'all' | 'configured' | 'restricted';
}

export const CAPTURE_PERSONAS: readonly CapturePersona[] = [
  {
    id: 'anonymous',
    expectedAccess: 'public',
  },
  {
    id: 'owner-admin',
    emailEnv: 'E2E_OWNER_EMAIL',
    passwordEnv: 'E2E_OWNER_PASSWORD',
    expectedAccess: 'all',
  },
  {
    id: 'manager-editor',
    emailEnv: 'E2E_MANAGER_EMAIL',
    passwordEnv: 'E2E_MANAGER_PASSWORD',
    expectedAccess: 'configured',
  },
  {
    id: 'member-viewer',
    emailEnv: 'E2E_MEMBER_EMAIL',
    passwordEnv: 'E2E_MEMBER_PASSWORD',
    expectedAccess: 'configured',
  },
  {
    id: 'restricted-no-module',
    emailEnv: 'E2E_RESTRICTED_EMAIL',
    passwordEnv: 'E2E_RESTRICTED_PASSWORD',
    expectedAccess: 'restricted',
  },
] as const;

const LEGACY_PERSONA_ALIASES: Readonly<Record<string, CapturePersonaId>> = {
  owner: 'owner-admin',
  manager: 'manager-editor',
  member: 'member-viewer',
  restricted: 'restricted-no-module',
};

export function resolvePersonaId(value: string): CapturePersonaId {
  const id = LEGACY_PERSONA_ALIASES[value] ?? value;
  const persona = CAPTURE_PERSONAS.find((candidate) => candidate.id === id);
  if (!persona) {
    throw new Error(
      `Unknown UI-audit persona ${value}. Expected ${CAPTURE_PERSONAS.map((item) => item.id).join(', ')}.`,
    );
  }
  return persona.id;
}

export function selectedPersonaIds(environment: NodeJS.ProcessEnv): readonly CapturePersonaId[] {
  const raw =
    environment.E2E_UI_AUDIT_PERSONAS ?? environment.E2E_UI_AUDIT_PERSONA ?? 'owner-admin';
  if (raw === 'all') return CAPTURE_PERSONAS.map((persona) => persona.id);
  const ids = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(resolvePersonaId);
  if (ids.length === 0) throw new Error('UI-audit persona selection cannot be empty.');
  return [...new Set(ids)];
}

export function capturePersona(id: CapturePersonaId): CapturePersona {
  const persona = CAPTURE_PERSONAS.find((candidate) => candidate.id === id);
  if (!persona) throw new Error(`Capture persona ${id} is not registered.`);
  return persona;
}

export function personaCredentials(
  persona: CapturePersona,
  environment: NodeJS.ProcessEnv,
): { email: string; password: string } | null {
  if (persona.id === 'anonymous') return null;
  if (!persona.emailEnv || !persona.passwordEnv) return null;
  const email = environment[persona.emailEnv];
  const password = environment[persona.passwordEnv];
  return email && password ? { email, password } : null;
}
