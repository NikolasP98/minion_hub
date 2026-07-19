import type { RequestEvent } from '@sveltejs/kit';
import { WebSocket } from 'ws';
import { supabaseAdmin } from '$server/supabase';
import { workforceClientForOrg } from '$lib/server/workforce-fetch';
import { ensureDefaultGatewayForUser } from '$server/services/gateway.pg.service';
import { gatewayCallAsUser } from '$lib/server/gateway-rpc';
import { issueGatewayJwt } from '$server/services/gateway-jwt.service';
import { getDb } from '$server/db/client';

export type OrganizationProvisionStepId =
  | 'organization'
  | 'membership'
  | 'rbac'
  | 'workforce'
  | 'gateway'
  | 'workstation'
  | 'readiness';

export interface OrganizationProvisionStep {
  id: OrganizationProvisionStepId;
  status: 'complete' | 'failed' | 'skipped';
  durationMs: number;
  detail: string;
}

export interface OrganizationProvisionResult {
  ok: boolean;
  organization: { id: string; name: string; slug: string } | null;
  steps: OrganizationProvisionStep[];
  startedAt: string;
  completedAt: string;
}

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
}

export function normalizeOrganizationName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Organization name is required');
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < 2 || normalized.length > 80) {
    throw new Error('Organization name must be between 2 and 80 characters');
  }
  return normalized;
}

export function organizationSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  if (!slug) throw new Error('Organization name must contain letters or numbers');
  return slug;
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown provisioning error';
  return message.replace(/(token|secret|password|authorization)=[^\s,;]+/gi, '$1=[redacted]');
}

async function findOrganization(slug: string): Promise<OrganizationRow | null> {
  const { data, error } = await supabaseAdmin()
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`Organization lookup failed: ${error.message}`);
  return (data as OrganizationRow | null) ?? null;
}

function optionalOrganizationId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('Existing Workforce company ID must be a valid UUID');
  }
  return value.toLowerCase();
}

async function ensureOrganization(
  name: string,
  slug: string,
  existingWorkforceCompanyId: string | null,
): Promise<OrganizationRow> {
  const existing = await findOrganization(slug);
  if (existing) {
    if (existingWorkforceCompanyId && existing.id !== existingWorkforceCompanyId) {
      throw new Error('Organization slug already exists with a different Workforce company ID');
    }
    return existing;
  }

  const candidate: OrganizationRow & { paperclip_company_id?: string } = {
    id: existingWorkforceCompanyId ?? crypto.randomUUID(),
    name,
    slug,
    ...(existingWorkforceCompanyId
      ? { paperclip_company_id: existingWorkforceCompanyId }
      : {}),
  };
  const { data, error } = await supabaseAdmin()
    .from('organizations')
    .insert(candidate)
    .select('id, name, slug')
    .single();
  if (!error && data) return data as OrganizationRow;

  // A concurrent click can win the unique-slug insert. Resolve that race by
  // adopting the row it created; every later step is idempotent too.
  if ((error as { code?: string } | null)?.code === '23505') {
    const raced = await findOrganization(slug);
    if (raced) return raced;
  }
  throw new Error(`Organization creation failed: ${error?.message ?? 'no row returned'}`);
}

async function verifyOrganization(orgId: string, profileId: string): Promise<void> {
  const admin = supabaseAdmin();
  const [org, membership, role] = await Promise.all([
    admin.from('organizations').select('id').eq('id', orgId).maybeSingle(),
    admin
      .from('organization_members')
      .select('organization_id')
      .eq('organization_id', orgId)
      .eq('profile_id', profileId)
      .maybeSingle(),
    admin
      .from('member_roles')
      .select('role_key')
      .eq('org_id', orgId)
      .eq('profile_id', profileId)
      .eq('role_key', 'owner')
      .maybeSingle(),
  ]);
  const failed = [org, membership, role].find((result) => result.error);
  if (failed?.error) throw new Error(`Readiness check failed: ${failed.error.message}`);
  if (!org.data || !membership.data || !role.data) {
    throw new Error('Readiness check failed: organization access is incomplete');
  }
}

async function ensureProvisionedWorkforceCompany(
  event: RequestEvent,
  orgId: string,
  name: string,
): Promise<void> {
  const user = event.locals.user;
  const client = await workforceClientForOrg(orgId, {
    id: user?.supabaseId ?? user?.id,
    name: user?.displayName,
    email: user?.email,
  });
  try {
    const company = await client.companies.get(orgId);
    if (company.name !== name) await client.companies.update(orgId, { name });
    return;
  } catch (cause) {
    if ((cause as { status?: number })?.status !== 404) throw cause;
  }

  const created = await client.request<{ id: string }>({
    method: 'POST',
    path: '/api/companies',
    body: { id: orgId, name },
  });
  if (created.id !== orgId) {
    if (created.id) await client.companies.remove(created.id).catch(() => undefined);
    throw new Error('Workforce backend ignored the requested organization ID');
  }
}

/**
 * Mint a hub-signed gateway JWT asserting `orgId` for a profile whose
 * membership in that org has already been verified server-side (by the
 * caller). This is the only trusted channel the gateway accepts for
 * org-scoped shells.* RPCs — see gatewayCallWithCreds' `jwt` option and
 * minion's shells.ts `requireOrgScope`.
 */
async function mintOrgGatewayJwt(orgId: string, profileId: string): Promise<string> {
  const { token } = await issueGatewayJwt({ db: getDb(), tenantId: orgId }, profileId);
  return token;
}

async function verifyTerminalAccess(url: string, token?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url, token ? [token] : undefined);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Terminal access verification timed out'));
    }, 15_000);
    timer.unref?.();
    socket.once('open', () => {
      clearTimeout(timer);
      socket.close();
      resolve();
    });
    socket.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Terminal access relay rejected the capability'));
    });
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      response.resume();
      reject(new Error(`Terminal access relay returned HTTP ${response.statusCode}`));
    });
  });
}

/**
 * Provision every server-side prerequisite for a new organization. Each step is
 * idempotent, so an admin can safely retry a partial run without duplicates.
 */
export async function provisionOrganization(
  event: RequestEvent,
  params: { name: string; profileId: string; existingWorkforceCompanyId?: string | null },
): Promise<OrganizationProvisionResult> {
  const startedAt = new Date().toISOString();
  const steps: OrganizationProvisionStep[] = [];
  const name = normalizeOrganizationName(params.name);
  const slug = organizationSlug(name);
  const existingWorkforceCompanyId = optionalOrganizationId(params.existingWorkforceCompanyId);
  let organization: OrganizationRow | null = null;
  let failed = false;

  async function step(
    id: OrganizationProvisionStepId,
    detail: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    if (failed) {
      steps.push({ id, status: 'skipped', durationMs: 0, detail: 'Skipped after an earlier failure' });
      return;
    }
    const start = performance.now();
    try {
      await operation();
      steps.push({ id, status: 'complete', durationMs: Math.round(performance.now() - start), detail });
    } catch (error) {
      failed = true;
      steps.push({
        id,
        status: 'failed',
        durationMs: Math.round(performance.now() - start),
        detail: safeMessage(error),
      });
    }
  }

  await step('organization', `Organization ${slug} is registered`, async () => {
    organization = await ensureOrganization(name, slug, existingWorkforceCompanyId);
  });
  await step('membership', 'Provisioning admin is an organization owner', async () => {
    if (!organization) throw new Error('Organization was not created');
    const { error } = await supabaseAdmin().from('organization_members').upsert(
      {
        organization_id: organization.id,
        profile_id: params.profileId,
        role: 'owner',
      },
      { onConflict: 'organization_id,profile_id' },
    );
    if (error) throw new Error(`Owner membership failed: ${error.message}`);
  });
  await step('rbac', 'Owner role and full organization capabilities are active', async () => {
    if (!organization) throw new Error('Organization was not created');
    const { error } = await supabaseAdmin().from('member_roles').upsert(
      {
        org_id: organization.id,
        profile_id: params.profileId,
        role_key: 'owner',
        granted_by: params.profileId,
      },
      { onConflict: 'org_id,profile_id,role_key' },
    );
    if (error) throw new Error(`Owner role assignment failed: ${error.message}`);
  });
  await step('workforce', 'Workforce workspace is ready', async () => {
    if (!organization) throw new Error('Organization was not created');
    await ensureProvisionedWorkforceCompany(event, organization.id, name);
  });
  await step('gateway', 'Provisioning admin has a default gateway route', async () => {
    if (!organization) throw new Error('Organization was not created');
    await ensureDefaultGatewayForUser(params.profileId, organization.id);
  });
  await step('workstation', 'Default cloud workstation is provisioned', async () => {
    if (!organization) throw new Error('Organization was not created');
    // The gateway's shells.* RPCs no longer trust a caller-supplied `orgId`
    // param (that let any admin-scoped session provision into an arbitrary
    // org — see minion's shells.ts requireOrgScope). Membership + RBAC for
    // `organization.id`/`params.profileId` were already verified by the
    // 'membership'/'rbac' steps above, so this JWT asserts a claim the
    // gateway can actually validate (signed, org-scoped), instead of a bare
    // unauthenticated param.
    const jwt = await mintOrgGatewayJwt(organization.id, params.profileId);
    await gatewayCallAsUser(
      'shells.provision',
      {
        displayName: `${name} Workspace`,
        harness: 'hermes',
        runtimes: ['hermes'],
        blueprint: 'minion-workstation-v1',
        image: 'minion-workstation-v1',
        cpu: 2,
        memoryMB: 8192,
        diskGB: 100,
        archiveIdleMs: null,
        backupCadence: 'daily',
        isDefault: true,
      },
      params.profileId,
      { orgId: organization.id, timeoutMs: 180_000, jwt },
    );
  });
  await step('readiness', 'Organization, owner membership, and RBAC access verified', async () => {
    if (!organization) throw new Error('Organization was not created');
    await verifyOrganization(organization.id, params.profileId);
    const jwt = await mintOrgGatewayJwt(organization.id, params.profileId);
    const listed = await gatewayCallAsUser<{ shells?: Array<{ orgId?: string; isDefault?: boolean }> }>(
      'shells.list',
      {},
      params.profileId,
      { orgId: organization.id, timeoutMs: 30_000, jwt },
    );
    const defaultShell = listed.shells?.find(
      (shell) => shell.orgId === organization?.id && shell.isDefault,
    ) as { shellId?: string } | undefined;
    if (!defaultShell?.shellId) {
      throw new Error('Readiness check failed: default workstation was not found');
    }
    const [desktop, terminal] = await Promise.all([
      gatewayCallAsUser<{ url: string }>(
        'shells.access',
        { shellId: defaultShell.shellId, kind: 'desktop' },
        params.profileId,
        { orgId: organization.id, timeoutMs: 30_000, jwt },
      ),
      gatewayCallAsUser<{ url: string; token?: string }>(
        'shells.access',
        { shellId: defaultShell.shellId, kind: 'terminal' },
        params.profileId,
        { orgId: organization.id, timeoutMs: 30_000, jwt },
      ),
    ]);
    const desktopResponse = await fetch(desktop.url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    const desktopBody = await desktopResponse.text();
    if (!desktopResponse.ok || /invalid or missing authentication|shell access expired/i.test(desktopBody)) {
      throw new Error(`Desktop access relay rejected the capability (HTTP ${desktopResponse.status})`);
    }
    await verifyTerminalAccess(terminal.url, terminal.token);
  });

  return {
    ok: !failed,
    organization,
    steps,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}
