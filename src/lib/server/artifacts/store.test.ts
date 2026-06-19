import { describe, it, expect } from 'vitest';
import { artifactRowToDescriptor } from './store';
import type { AgentArtifactRow } from '$server/db/pg-artifacts-schema';

const row: AgentArtifactRow = {
  id: '11111111-1111-1111-1111-111111111111',
  orgId: 'org1', agentId: 'reminders', title: 'My Dash', description: 'desc',
  icon: 'BarChart3', html: '<!doctype html>', createdBy: 'u1',
  createdAt: new Date(0), updatedAt: new Date(0),
};

describe('artifactRowToDescriptor', () => {
  it('maps a row to a deletable static descriptor', () => {
    expect(artifactRowToDescriptor(row)).toEqual({
      id: '11111111-1111-1111-1111-111111111111', agentId: 'reminders', slot: 'detail',
      title: 'My Dash', description: 'desc', icon: 'BarChart3', kind: 'static',
      entrypoint: 'index.html', deletable: true,
    });
  });
});
