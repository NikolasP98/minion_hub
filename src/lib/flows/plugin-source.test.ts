import { describe, expect, it } from 'vitest';
import { flowPluginId, flowSourceFrom } from './plugin-source';

describe('flow plugin-source', () => {
  it('extracts pluginId from a config JSON string', () => {
    const config = JSON.stringify({ source: { pluginId: 'alert-watcher', templateId: 'pipeline' } });
    expect(flowPluginId(config)).toBe('alert-watcher');
    expect(flowSourceFrom(config)).toEqual({ pluginId: 'alert-watcher', templateId: 'pipeline' });
  });

  it('extracts pluginId from an already-parsed object', () => {
    expect(flowPluginId({ source: { pluginId: 'weekly-recon' } })).toBe('weekly-recon');
  });

  it('returns null for user-authored flows (no source)', () => {
    expect(flowPluginId('{}')).toBeNull();
    expect(flowPluginId(JSON.stringify({ someOtherTrigger: true }))).toBeNull();
    expect(flowPluginId(null)).toBeNull();
    expect(flowPluginId(undefined)).toBeNull();
  });

  it('returns null for malformed config (never throws)', () => {
    expect(flowPluginId('not json')).toBeNull();
    expect(flowPluginId(JSON.stringify({ source: { pluginId: '' } }))).toBeNull();
    expect(flowPluginId(JSON.stringify({ source: { pluginId: 123 } }))).toBeNull();
  });
});
