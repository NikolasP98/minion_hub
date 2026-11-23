// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { longpress } from './longpress';

function ev(type: string, init: Partial<PointerEventInit> & { pointerType?: string } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>;
  Object.assign(e, {
    pointerType: 'touch',
    isPrimary: true,
    pointerId: 1,
    clientX: 10,
    clientY: 10,
    ...init,
  });
  return e;
}

describe('longpress', () => {
  let node: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    node = document.createElement('div');
    document.body.append(node);
  });
  afterEach(() => {
    vi.useRealTimers();
    node.remove();
  });

  it('fires after ms with position, pointer id and target', () => {
    const onhold = vi.fn();
    longpress(node, { ms: 400, onhold });
    node.dispatchEvent(ev('pointerdown', { pointerId: 7 }));
    vi.advanceTimersByTime(399);
    expect(onhold).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onhold).toHaveBeenCalledWith({ x: 10, y: 10, pointerId: 7, target: node });
  });

  it('cancels beyond slop but not within it', () => {
    const onhold = vi.fn();
    longpress(node, { slop: 12, onhold });
    node.dispatchEvent(ev('pointerdown'));
    node.dispatchEvent(ev('pointermove', { clientX: 20 }));
    vi.advanceTimersByTime(500);
    expect(onhold).toHaveBeenCalledTimes(1);
    node.dispatchEvent(ev('pointerdown'));
    node.dispatchEvent(ev('pointermove', { clientX: 30 }));
    vi.advanceTimersByTime(500);
    expect(onhold).toHaveBeenCalledTimes(1);
  });

  it('pointercancel cancels', () => {
    const onhold = vi.fn();
    longpress(node, { onhold });
    node.dispatchEvent(ev('pointerdown'));
    node.dispatchEvent(ev('pointercancel'));
    vi.advanceTimersByTime(600);
    expect(onhold).not.toHaveBeenCalled();
  });

  it('ignores mouse and non-primary pointers', () => {
    const onhold = vi.fn();
    longpress(node, { onhold });
    node.dispatchEvent(ev('pointerdown', { pointerType: 'mouse' }));
    node.dispatchEvent(ev('pointerdown', { isPrimary: false }));
    vi.advanceTimersByTime(600);
    expect(onhold).not.toHaveBeenCalled();
  });

  it('calls onend after a hold, not after a plain tap', () => {
    const onend = vi.fn();
    longpress(node, { onhold: vi.fn(), onend });
    node.dispatchEvent(ev('pointerdown'));
    node.dispatchEvent(ev('pointerup'));
    expect(onend).not.toHaveBeenCalled();
    node.dispatchEvent(ev('pointerdown'));
    vi.advanceTimersByTime(600);
    node.dispatchEvent(ev('pointerup'));
    expect(onend).toHaveBeenCalledTimes(1);
  });

  it('swallows the click after a hold once; a later click passes', () => {
    longpress(node, { onhold: vi.fn() });
    const seen = vi.fn();
    node.addEventListener('click', seen);
    node.dispatchEvent(ev('pointerdown'));
    vi.advanceTimersByTime(600);
    node.dispatchEvent(ev('pointerup'));
    node.click();
    expect(seen).not.toHaveBeenCalled();
    node.click(); // fired was consumed
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('a hold with no click cannot swallow a later click after a fresh pointerdown', () => {
    longpress(node, { onhold: vi.fn() });
    const seen = vi.fn();
    node.addEventListener('click', seen);
    node.dispatchEvent(ev('pointerdown'));
    vi.advanceTimersByTime(600);
    node.dispatchEvent(ev('pointerup'));
    node.dispatchEvent(ev('pointerdown', { pointerType: 'mouse' }));
    node.dispatchEvent(ev('pointerdown')); // touch down resets the flag
    node.dispatchEvent(ev('pointerup'));
    node.click();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('keeps the function form and 500 ms default', () => {
    const fn = vi.fn();
    longpress(node, fn);
    node.dispatchEvent(ev('pointerdown'));
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ x: 10, y: 10 }));
  });

  it('update swaps the options', () => {
    const a = vi.fn();
    const b = vi.fn();
    const act = longpress(node, { onhold: a });
    act.update({ onhold: b });
    node.dispatchEvent(ev('pointerdown'));
    vi.advanceTimersByTime(500);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });
});
