import { describe, it, expect } from 'vitest';
import { cleanText, extractText } from './text';

describe('cleanText', () => {
  it('strips <think> blocks for assistant role', () => {
    expect(cleanText('<think>internal</think>Hello', 'assistant')).toBe('Hello');
  });

  it('strips <thinking> blocks for assistant role', () => {
    expect(cleanText('<thinking>hmm</thinking>Result', 'assistant')).toBe('Result');
  });

  it('keeps <think> blocks for user role', () => {
    expect(cleanText('<think>my thought</think>Hi', 'user')).toBe('<think>my thought</think>Hi');
  });

  it('strips [[reply_to_current]]', () => {
    expect(cleanText('[[reply_to_current]]Hello', 'user')).toBe('Hello');
  });

  it('strips [[audio_as_voice]]', () => {
    expect(cleanText('[[audio_as_voice]]Hi', 'user')).toBe('Hi');
  });

  it('strips <env> prefix', () => {
    expect(cleanText('<env>some env info</env>Actual text', 'user')).toBe('Actual text');
  });

  it('collapses whitespace', () => {
    expect(cleanText('hello   world', 'user')).toBe('hello world');
  });

  it('trims leading/trailing whitespace', () => {
    expect(cleanText('  hello  ', 'user')).toBe('hello');
  });

  it('normalizes newlines with surrounding spaces', () => {
    expect(cleanText('hello  \n  world', 'user')).toBe('hello\nworld');
  });
});

describe('extractText', () => {
  it('returns null for null', () => expect(extractText(null)).toBe(null));
  it('returns null for non-object', () => expect(extractText('string')).toBe(null));
  it('returns null for undefined', () => expect(extractText(undefined)).toBe(null));

  it('extracts string content', () => {
    expect(extractText({ role: 'user', content: 'Hello' })).toBe('Hello');
  });

  it('extracts text from content array', () => {
    const msg = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Part 1' },
        { type: 'image', url: 'http://example.com' },
        { type: 'text', text: 'Part 2' },
      ],
    };
    expect(extractText(msg)).toBe('Part 1\nPart 2');
  });

  it('falls back to .text property', () => {
    expect(extractText({ role: 'user', text: 'fallback' })).toBe('fallback');
  });

  it('applies cleanText to assistant content', () => {
    const msg = { role: 'assistant', content: '<think>x</think>Answer' };
    expect(extractText(msg)).toBe('Answer');
  });

  it('returns null for object with no text', () => {
    expect(extractText({ role: 'user', data: 123 })).toBe(null);
  });
});
