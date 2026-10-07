import { describe, expect, it } from 'vitest';
import { canonicalNotificationPayload } from '$lib/notifications/canonical';
import type { ClaimedNotificationEvent } from '../outbox-claim';
import { projectJoinAudience, projectionSetDigest } from './join-adapter';

const ORG = '10000000-0000-4000-8000-000000000001';
const EVENT = '20000000-0000-4000-8000-000000000001';
const REQUEST = '30000000-0000-4000-8000-000000000001';
const APPLICANT = '40000000-0000-4000-8000-000000000001';
const MANAGER = '50000000-0000-4000-8000-000000000001';
const CREATED = '2026-10-03T12:00:00.000Z';

function event(kind: 'join.requested' | 'join.approved' | 'join.denied'): ClaimedNotificationEvent {
  const decidedAt = kind === 'join.requested' ? undefined : CREATED;
  return {
    id: EVENT,
    organization_id: ORG,
    kind,
    schema_version: 1,
    catalog_revision: '2026-10-03.1',
    producer_id: 'membership.join',
    subject_type: 'join_request',
    subject_id: REQUEST,
    subject_revision: `${kind === 'join.requested' ? 'pending' : kind === 'join.approved' ? 'approved' : 'denied'}:${CREATED}`,
    source_identity: 'fixture',
    occurred_at: CREATED,
    dedupe_key: 'fixture',
    payload_canonical: canonicalNotificationPayload({
      applicantProfileId: APPLICANT,
      ...(decidedAt ? { decidedAt } : {}),
      requestId: REQUEST,
    }),
    payload_sha256: 'a'.repeat(64),
    semantic_sha256: 'b'.repeat(64),
    lease: {
      eventId: EVENT,
      ownerId: '60000000-0000-4000-8000-000000000001',
      generation: '1',
      expiresAt: '2026-10-03T12:00:30.000Z',
      hardDeadline: '2026-10-03T12:01:00.000Z',
    },
  };
}

function request(status: 'pending' | 'approved' | 'denied') {
  return {
    id: REQUEST,
    organizationId: ORG,
    supabaseId: APPLICANT,
    userId: APPLICANT,
    status,
    createdAt: CREATED,
    reviewedAt: status === 'pending' ? null : CREATED,
    profileExists: true,
    organizationActive: true,
  } as const;
}

const managers = [
  {
    profileId: MANAGER,
    audienceMode: 'users_manage' as const,
    evidence: canonicalNotificationPayload({ roles: ['owner'] }),
  },
];

describe('join notification audience adapter', () => {
  it('projects requested only to managers and outcomes to the applicant plus managers', () => {
    const requested = projectJoinAudience({
      event: event('join.requested'),
      request: request('pending'),
      managers,
    });
    const approved = projectJoinAudience({
      event: event('join.approved'),
      request: request('approved'),
      managers,
    });
    expect(requested.state).toBe('ready');
    expect(approved.state).toBe('ready');
    if (requested.state !== 'ready' || approved.state !== 'ready')
      throw new Error('fixture failed');
    expect(requested.candidates.map((row) => row.recipientProfileId)).toEqual([MANAGER]);
    expect(approved.candidates.map((row) => row.recipientProfileId)).toEqual([APPLICANT, MANAGER]);
    expect(JSON.stringify(approved.candidates)).not.toMatch(/email|displayName|message|reason/i);
    expect(projectionSetDigest(approved.candidates)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns one no-leak invalid outcome for divergent applicant identity or subject revision', () => {
    expect(
      projectJoinAudience({
        event: event('join.approved'),
        request: { ...request('approved'), userId: MANAGER },
        managers,
      }),
    ).toEqual({ state: 'invalid' });
    expect(
      projectJoinAudience({
        event: { ...event('join.approved'), subject_revision: `approved:2026-10-03T12:00:01.000Z` },
        request: request('approved'),
        managers,
      }),
    ).toEqual({ state: 'invalid' });
  });
});
