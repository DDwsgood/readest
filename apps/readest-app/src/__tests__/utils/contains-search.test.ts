// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { findContainsMatches } from '@/utils/containsSearch';

describe('findContainsMatches', () => {
  it('preserves UTF-16 source offsets while applying case and diacritic options independently', () => {
    const text = 'Cafe\u0301 cafe CAFÉ';

    expect([
      ...findContainsMatches(text, 'cafe', { matchCase: false, matchDiacritics: false }, 'en'),
    ]).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 10 },
      { start: 11, end: 15 },
    ]);
    expect([
      ...findContainsMatches(text, 'cafe', { matchCase: false, matchDiacritics: true }, 'en'),
    ]).toEqual([{ start: 6, end: 10 }]);
    expect([
      ...findContainsMatches(text, 'Cafe', { matchCase: true, matchDiacritics: false }, 'en'),
    ]).toEqual([{ start: 0, end: 5 }]);
    expect([
      ...findContainsMatches(text, 'Cafe', { matchCase: true, matchDiacritics: true }, 'en'),
    ]).toEqual([]);
    expect([
      ...findContainsMatches(text, 'Cafe\u0301', { matchCase: true, matchDiacritics: true }, 'en'),
    ]).toEqual([{ start: 0, end: 5 }]);
  });

  it('keeps source offsets when a dropped soft hyphen offsets a lengthening fold', () => {
    // U+00AD is removed while İ lowercases to i + U+0307: same total length.
    expect([
      ...findContainsMatches(
        '\u00ADİ',
        '\u0130',
        { matchCase: false, matchDiacritics: true },
        'en',
      ),
    ]).toEqual([{ start: 1, end: 2 }]);
  });

  it('uses identical case folding in mapped and unmapped text', () => {
    // Whole-string lowercase uses a final sigma in ΟΣ. Per-character lowercase
    // must not produce a different result only because whitespace later in the
    // text requires source-offset mapping.
    expect([
      ...findContainsMatches('ΟΣ  x', 'ος', {
        matchCase: false,
        matchDiacritics: false,
      }),
    ]).toEqual([{ start: 0, end: 2 }]);
  });

  it('collapses whitespace and drops format characters without losing source offsets', () => {
    const text = '🙂 Cafe\u0301 quick \n\u200B  fox';
    expect([
      ...findContainsMatches(text, 'cafe quick fox', {
        matchCase: false,
        matchDiacritics: false,
      }),
    ]).toEqual([{ start: 3, end: text.length }]);

    expect([
      ...findContainsMatches(text, 'Cafe quick fox', {
        matchCase: true,
        matchDiacritics: false,
      }),
    ]).toEqual([{ start: 3, end: text.length }]);
  });

  it('keeps exact offsets after surrogate pairs and matches CJK text', () => {
    expect([
      ...findContainsMatches('🙂 Cafe\u0301 黄仁勋 한국어', 'cafe', {
        matchCase: false,
        matchDiacritics: false,
      }),
    ]).toEqual([{ start: 3, end: 8 }]);
    expect([
      ...findContainsMatches('黄仁勋 한국어', '黄仁勋', {
        matchCase: false,
        matchDiacritics: false,
      }),
    ]).toEqual([{ start: 0, end: 3 }]);
    expect([
      ...findContainsMatches('黄仁勋 한국어', '한국어', {
        matchCase: false,
        matchDiacritics: false,
      }),
    ]).toEqual([{ start: 4, end: 7 }]);
  });
});
