import { describe, expect, it } from 'vitest';
import { cleanInboundForDisplay } from './chat-rpc';

const PREFIX =
  'The WhatsApp brain almost entirely your personal conversations\n- Shows customers\n\n' +
  'Conversation info (untrusted metadata):\n```json\n{\n"message_id": "x"\n}\n```\n\n' +
  '[Wed 2026-09-02 19:41 UTC] ';
const ENVELOPE =
  "[In-app assistant context — the user is in the Minion dashboard. UI TOOLS — ```minion-ui\n{}\n``` Pages you may open… Keep replies tight. Don't restate this context.]";

describe('cleanInboundForDisplay', () => {
  it('keeps only the typed text: text-first layout, flattened memories, full envelope', () => {
    expect(cleanInboundForDisplay(`${PREFIX}ayudame agregar compras\n\n${ENVELOPE}`)).toBe(
      'ayudame agregar compras',
    );
  });
  it('survives gateway truncation of the envelope', () => {
    expect(
      cleanInboundForDisplay(`${PREFIX}plus\n\n${ENVELOPE.slice(0, 80)}\n...(truncated)...`),
    ).toBe('plus');
  });
  it('marks a legacy envelope-first turn the gateway truncated (words unrecoverable)', () => {
    const out = cleanInboundForDisplay(`${PREFIX}${ENVELOPE.slice(0, 80)}\n...(truncated)...`);
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toContain('In-app assistant');
  });
  it('still handles the legacy envelope-first layout and silent turns', () => {
    expect(cleanInboundForDisplay(`${PREFIX}${ENVELOPE}\n\nhola`)).toBe('hola');
    expect(
      cleanInboundForDisplay(
        "[In-app assistant context — results of the UI tools you just called:\nhub.navigate → {}\nDon't restate this context.]\n\n",
      ),
    ).toBe('');
    expect(cleanInboundForDisplay('hola')).toBe('hola');
  });
});
