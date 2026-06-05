import { describe, expect, it } from 'vitest';
import { MIN_TOKEN_LEN, STOP_WORDS, tokenize } from './tokenize';

describe('tokenize', () => {
  it('lowercases', () => {
    expect(tokenize('HELLO World')).toEqual(new Set(['hello', 'world']));
  });

  it('drops stop words', () => {
    const tokens = tokenize('The Best Remix');
    expect(tokens.has('the')).toBe(false);
    expect(tokens.has('remix')).toBe(false);
    expect(tokens.has('best')).toBe(true);
  });

  it('drops short tokens', () => {
    // Single-character tokens should be dropped (MIN_TOKEN_LEN >= 2)
    const tokens = tokenize('a b cd');
    expect(tokens.has('a')).toBe(false);
    expect(tokens.has('b')).toBe(false);
    expect(tokens.has('cd')).toBe(true);
  });

  it('splits on punctuation', () => {
    const tokens = tokenize("Rock'n'Roll!! (Remix)");
    expect(tokens.has('rock')).toBe(true);
    expect(tokens.has('roll')).toBe(true);
  });

  it('returns empty set for empty string', () => {
    expect(tokenize('')).toEqual(new Set());
  });

  it('returns empty set for null / undefined', () => {
    expect(tokenize(null)).toEqual(new Set());
    expect(tokenize(undefined)).toEqual(new Set());
  });

  it('exposes the public constants', () => {
    expect(MIN_TOKEN_LEN).toBeGreaterThanOrEqual(2);
    expect(STOP_WORDS.has('the')).toBe(true);
  });
});
