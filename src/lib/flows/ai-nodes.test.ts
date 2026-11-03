import { describe, expect, it } from 'vitest';
import { isAiFlowNode } from './ai-nodes';

describe('isAiFlowNode (spec 043)', () => {
  it('flags the model-calling built-ins', () => {
    for (const t of ['agent', 'llm', 'structured', 'toolAgent', 'memory'])
      expect(isAiFlowNode(t), t).toBe(true);
  });
  it('keeps the non-AI built-ins, including the router and the handoff', () => {
    for (const t of [
      'trigger',
      'schedule',
      'promptBox',
      'router',
      'transform',
      'database',
      'subflow',
      'channel',
      'handoff',
      'reaction',
      'fileWrite',
    ])
      expect(isAiFlowNode(t), t).toBe(false);
  });
  it('flags only the two AI plugin actions', () => {
    expect(isAiFlowNode('pluginAction', 'alertWatcher.classify')).toBe(true);
    expect(isAiFlowNode('pluginAction', 'alertWatcher.suggest')).toBe(true);
    expect(isAiFlowNode('pluginAction', 'alertWatcher.gate')).toBe(false);
    expect(isAiFlowNode('pluginAction', 'alertWatcher.sendAlert')).toBe(false);
    expect(isAiFlowNode('pluginAction', undefined)).toBe(false);
    expect(isAiFlowNode('pluginTrigger', 'alertWatcher.classify')).toBe(false);
  });
});
