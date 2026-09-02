import { describe, expect, it } from 'vitest';
import { cleanInboundForDisplay } from './chat-rpc';

describe('cleanInboundForDisplay', () => {
  it('hides everything up to the page envelope even when the memories block is flattened', () => {
    const recorded =
      'The WhatsApp brain almost entirely your personal conversations\n- Shows customers\n\n' +
      'Conversation info (untrusted metadata):\n```json\n{\n"message_id": "x"\n}\n```\n\n' +
      "[Wed 2026-09-02 19:41 UTC] [In-app assistant context — the user is in the Minion dashboard. UI TOOLS — ```minion-ui\n{}\n``` Pages you may open… Keep replies tight. Don't restate this context.]\n\n" +
      'ayudame agregar nuevas compras de inventario';
    expect(cleanInboundForDisplay(recorded)).toBe('ayudame agregar nuevas compras de inventario');
  });
  it('hides a silent UI-results turn completely and leaves plain text alone', () => {
    expect(
      cleanInboundForDisplay(
        "[In-app assistant context — results of the UI tools you just called:\nhub.navigate → {}\nDon't restate this context.]\n\n",
      ),
    ).toBe('');
    expect(cleanInboundForDisplay('hola')).toBe('hola');
  });
});
