import { describe, test, expect, beforeAll } from 'vitest';
import { uiToolsBriefing, UI_TOOL_RULES } from './briefing';
import { allPages } from './site-map';
import { FORM_CATALOG } from './catalog';
import { getTools } from './model-context';
import { registerGlobalTools } from './global-tools';

/**
 * The token budget the JEV turn router exists to cut. The page list and the
 * form catalog are withheld by passing an empty array, so this suite pins the
 * behaviour that makes that safe (the headers go with them) and reports the
 * before/after size over the REAL catalogs.
 */
beforeAll(() => {
  registerGlobalTools();
});

const pages = () => allPages();
const forms = () => FORM_CATALOG;

describe('uiToolsBriefing section gating', () => {
  test('the full briefing lists every page and form', () => {
    const full = uiToolsBriefing(getTools(), pages(), forms());
    expect(full).toContain('Pages you may open');
    expect(full).toContain('Forms you can fill');
    expect(full).toContain('UI TOOLS');
  });

  test('an empty page list drops the "Pages you may open" header with it', () => {
    const briefing = uiToolsBriefing(getTools(), [], forms());
    // An orphan header reads to the agent as "there are no pages here", which
    // is a worse answer than not raising the subject.
    expect(briefing).not.toContain('Pages you may open');
    expect(briefing).toContain('Forms you can fill');
    expect(briefing).toContain('UI TOOLS');
  });

  test('an empty form catalog drops the forms header with it', () => {
    const briefing = uiToolsBriefing(getTools(), pages(), []);
    expect(briefing).not.toContain('Forms you can fill');
    expect(briefing).toContain('Pages you may open');
  });

  test('the UI-tool protocol and intent rules survive both (they are core)', () => {
    const core = uiToolsBriefing(getTools(), [], []);
    expect(core).toContain('UI TOOLS');
    expect(core).toContain('minion-ui');
    expect(core).toContain('Intent rules:');
  });

  test('no registered tools still yields nothing at all (unchanged)', () => {
    expect(uiToolsBriefing([], pages(), forms())).toBe('');
  });
});

describe('briefing size budget', () => {
  // Printed, not pinned to an exact number: these catalogs grow with the
  // product, and a char-exact assertion would fail on every new page for no
  // behavioural reason. The ratios are what the feature promises.
  test('reports the briefing size per routed turn', () => {
    const sizes = {
      full: uiToolsBriefing(getTools(), pages(), forms()).length,
      navigate_pages_only: uiToolsBriefing(getTools(), pages(), []).length,
      record_action_forms_only: uiToolsBriefing(getTools(), [], forms()).length,
      core_only: uiToolsBriefing(getTools(), [], []).length,
      pages_count: pages().length,
      forms_count: forms().length,
      tools_count: getTools().length,
    };
    console.info('[ui briefing chars]', JSON.stringify(sizes));
    // The page list is the single biggest slice of the envelope.
    expect(sizes.core_only).toBeLessThan(sizes.full * 0.5);
    expect(sizes.navigate_pages_only).toBeGreaterThan(sizes.core_only);
    expect(sizes.record_action_forms_only).toBeGreaterThan(sizes.core_only);
  });
});

describe('answer-first instruction contract', () => {
  test('information questions use answers and source links; navigation requires an explicit request', () => {
    expect(UI_TOOL_RULES).toContain('answer in chat with specifics and clickable source links');
    expect(UI_TOOL_RULES).toContain('the user must click');
    expect(UI_TOOL_RULES).toContain('Never combine hub.navigate with fill_<id> or ui.guide');
    expect(UI_TOOL_RULES).not.toContain('navigate there');
    expect(UI_TOOL_RULES).toContain('explain in chat with a link');
  });
});
