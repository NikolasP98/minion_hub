import { describe, expect, it } from 'vitest';
import { parseUserContext } from './chat-rpc';

describe('parseUserContext', () => {
  it('splits leading context blocks into chips + typed text', () => {
    const msg =
      '[Context email: (cc) Your Wednesday evening trip with Uber]\n' +
      'Email from Uber Receipts\nSubject: trip\n' +
      '[/Context]\n\nwhats this about';
    const { chips, text } = parseUserContext(msg);
    expect(chips).toEqual([
      {
        kind: 'email',
        label: '(cc) Your Wednesday evening trip with Uber',
        text: 'Email from Uber Receipts\nSubject: trip',
      },
    ]);
    expect(text).toBe('whats this about');
  });

  it('parses newline-flattened messages (gateway records turns on one line)', () => {
    const msg =
      '[Context email: Test drag chip] Email from Uber Receipts Subject: trip [/Context] whats this about';
    const { chips, text } = parseUserContext(msg);
    expect(chips).toEqual([
      { kind: 'email', label: 'Test drag chip', text: 'Email from Uber Receipts Subject: trip' },
    ]);
    expect(text).toBe('whats this about');
  });

  it('handles multiple chips and context-only sends', () => {
    const msg = '[Context event: A]\nx\n[/Context]\n\n[Context note: B]\ny\n[/Context]';
    const { chips, text } = parseUserContext(msg);
    expect(chips.map((c) => c.label)).toEqual(['A', 'B']);
    expect(text).toBe('');
  });

  it('passes plain and legacy Context: messages through untouched', () => {
    expect(parseUserContext('hello')).toEqual({ chips: [], text: 'hello' });
    const legacy = 'Context:\nEmail from X\n\nwhats this';
    expect(parseUserContext(legacy)).toEqual({ chips: [], text: legacy });
  });
});
