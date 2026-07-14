export type CapturePersonaId = 'owner' | 'manager' | 'member' | 'restricted';

export interface CapturePersona {
  id: CapturePersonaId;
  emailEnv: string;
  passwordEnv: string;
  expectedAccess: 'all' | 'configured' | 'restricted';
}

export const CAPTURE_PERSONAS: readonly CapturePersona[] = [
  {
    id: 'owner',
    emailEnv: 'E2E_OWNER_EMAIL',
    passwordEnv: 'E2E_OWNER_PASSWORD',
    expectedAccess: 'all',
  },
  {
    id: 'manager',
    emailEnv: 'E2E_MANAGER_EMAIL',
    passwordEnv: 'E2E_MANAGER_PASSWORD',
    expectedAccess: 'configured',
  },
  {
    id: 'member',
    emailEnv: 'E2E_MEMBER_EMAIL',
    passwordEnv: 'E2E_MEMBER_PASSWORD',
    expectedAccess: 'configured',
  },
  {
    id: 'restricted',
    emailEnv: 'E2E_RESTRICTED_EMAIL',
    passwordEnv: 'E2E_RESTRICTED_PASSWORD',
    expectedAccess: 'restricted',
  },
] as const;

export function configuredPersona(id: CapturePersonaId): CapturePersona | null {
  const persona = CAPTURE_PERSONAS.find((candidate) => candidate.id === id);
  if (!persona || !process.env[persona.emailEnv] || !process.env[persona.passwordEnv]) return null;
  return persona;
}
