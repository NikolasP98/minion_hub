import { describe, expect, it } from 'vitest';
import {
  setRevealIntent,
  shouldExpandIsland,
  settleRevealTransition,
  type RevealGate,
} from './dynamic-island-reveal';

const CLOSED: RevealGate = { intent: false, complete: false };

describe('DynamicIsland reveal gate', () => {
  it('waits for expansion before enabling the status popover', () => {
    const entering = setRevealIntent(CLOSED, true, false);

    expect(entering).toEqual({ intent: true, complete: false });
    expect(settleRevealTransition(entering)).toEqual({ intent: true, complete: true });
  });

  it('preserves an open gate while the pointer crosses to the popover', () => {
    const open: RevealGate = { intent: true, complete: true };
    const leaving = setRevealIntent(open, false, false);
    const reentering = setRevealIntent(leaving, true, false);

    expect(leaving).toEqual({ intent: false, complete: true });
    expect(reentering).toEqual({ intent: true, complete: true });
  });

  it('closes only after the collapse transition settles', () => {
    const leaving = setRevealIntent({ intent: true, complete: true }, false, false);

    expect(settleRevealTransition(leaving)).toEqual({ intent: false, complete: false });
  });

  it('settles immediately in either direction under reduced motion', () => {
    const open = setRevealIntent(CLOSED, true, true);
    const leaving = setRevealIntent(open, false, true);
    const reentering = setRevealIntent(leaving, true, true);

    expect(open).toEqual({ intent: true, complete: true });
    expect(leaving).toEqual({ intent: false, complete: false });
    expect(reentering).toEqual({ intent: true, complete: true });
  });

  it('holds the notch open until the status popover actually closes', () => {
    expect(shouldExpandIsland(false, false, true, false)).toBe(true);
    expect(shouldExpandIsland(false, false, false, false)).toBe(false);
  });

  it('also holds the notch open for the notifications popup', () => {
    expect(shouldExpandIsland(false, false, false, true)).toBe(true);
  });

  it('does not collapse until every popup lock is released', () => {
    expect(shouldExpandIsland(false, false, true, true)).toBe(true);
    expect(shouldExpandIsland(false, false, false, true)).toBe(true);
    expect(shouldExpandIsland(false, false, false, false)).toBe(false);
  });
});
