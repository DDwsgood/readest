interface ContainsSearchOptions {
  matchCase: boolean;
  matchDiacritics: boolean;
}

interface FoldedText {
  value: string;
  starts?: number[];
  ends?: number[];
}

// NFD recursively decomposes Hangul syllables and adds no value for the other
// large CJK blocks. Leave those runs (and ASCII) untouched instead of paying
// for Unicode normalization on every character in Chinese/Japanese/Korean books.
const NORMALIZE_RUN =
  /[^\u0000-\u007f\u1100-\u11ff\u2e80-\u303e\u3040-\u30ff\u3130-\u318f\u31c0-\u31ef\u3200-\u32ff\u3300-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\u{20000}-\u{2fa1f}]+/gu;
const FORMAT_OR_COLLAPSED_WHITESPACE = /\p{Format}|\s{2,}/u;

const endsBeforeCombiningMark = (text: string, end: number) => /^\p{M}/u.test(text.slice(end));

// Fold in bulk first and return UTF-16 source maps whenever characters are
// dropped, collapsed, or change length so matches map back to original text.
export const foldSearchText = (
  value: string,
  { matchCase = false, matchDiacritics = false }: Partial<ContainsSearchOptions> = {},
  locales?: string,
): FoldedText => {
  let locale = locales;
  if (!matchCase && locale) {
    try {
      ''.toLocaleLowerCase(locale);
    } catch {
      locale = undefined;
    }
  }

  const foldSource = (source: string, finalSigma = false) => {
    let folded = source;
    if (!matchCase) {
      if (source === '\u03a3') folded = finalSigma ? '\u03c2' : '\u03c3';
      else folded = source.toLocaleLowerCase(locale);
    }
    if (!matchDiacritics) {
      folded = folded.replace(NORMALIZE_RUN, (run) => run.normalize('NFD')).replace(/\p{M}/gu, '');
    }
    return folded;
  };

  const foldWhole = (input: string) => {
    let folded = matchCase ? input : input.toLocaleLowerCase(locale);
    if (!matchDiacritics) {
      folded = folded.replace(NORMALIZE_RUN, (run) => run.normalize('NFD')).replace(/\p{M}/gu, '');
    }
    return folded.replace(/\p{Format}/gu, '').replace(/\s+/gu, ' ');
  };

  const folded = foldWhole(value);
  // No removed characters, collapsed runs, or net length change: folded and
  // source UTF-16 offsets are aligned, so avoid two large mapping arrays.
  if (folded.length === value.length && !FORMAT_OR_COLLAPSED_WHITESPACE.test(value)) {
    return { value: folded };
  }

  const starts: number[] = [];
  const ends: number[] = [];
  let output = '';
  let sourceOffset = 0;
  let pendingWhitespace: { start: number; end: number } | null = null;

  const extendPrevious = (end: number) => {
    if (pendingWhitespace) pendingWhitespace.end = end;
    else if (ends.length) ends[ends.length - 1] = end;
  };

  const flushWhitespace = () => {
    if (!pendingWhitespace) return;
    output += ' ';
    starts.push(pendingWhitespace.start);
    ends.push(pendingWhitespace.end);
    pendingWhitespace = null;
  };

  for (const source of value) {
    const start = sourceOffset;
    sourceOffset += source.length;
    if (/^\p{Format}$/u.test(source)) {
      extendPrevious(sourceOffset);
      continue;
    }
    if (/^\s$/u.test(source)) {
      if (pendingWhitespace) pendingWhitespace.end = sourceOffset;
      else pendingWhitespace = { start, end: sourceOffset };
      continue;
    }

    // Match whole-string lowercase for Greek final sigma even when later
    // whitespace or formatting forces this mapped path.
    const finalSigma =
      source === '\u03a3' &&
      /\p{Cased}[\p{Case_Ignorable}]*$/u.test(value.slice(0, start)) &&
      !/^\p{Case_Ignorable}*\p{Cased}/u.test(value.slice(sourceOffset));
    const transformed = foldSource(source, finalSigma);
    if (!transformed) {
      extendPrevious(sourceOffset);
      continue;
    }
    flushWhitespace();
    output += transformed;
    for (let index = 0; index < transformed.length; index++) {
      starts.push(start);
      ends.push(sourceOffset);
    }
  }
  flushWhitespace();
  return { value: output, starts, ends };
};

export const foldValue = (value: string, options: ContainsSearchOptions, locale?: string): string =>
  foldSearchText(value, options, locale).value;

export function* findContainsMatches(
  text: string,
  query: string,
  options: ContainsSearchOptions,
  locale?: string,
) {
  if (!query) return;
  if (options.matchCase && options.matchDiacritics) {
    let index = text.indexOf(query);
    while (index >= 0) {
      const end = index + query.length;
      if (!endsBeforeCombiningMark(text, end)) yield { start: index, end };
      index = text.indexOf(query, index + 1);
    }
    return;
  }

  const haystack = foldSearchText(text, options, locale);
  const needle = foldSearchText(query, options, locale).value;
  if (!needle) return;
  let index = haystack.value.indexOf(needle);
  while (index >= 0) {
    const last = index + needle.length - 1;
    const end = haystack.ends?.[last] ?? last + 1;
    if (!options.matchDiacritics || !endsBeforeCombiningMark(text, end)) {
      yield { start: haystack.starts?.[index] ?? index, end };
    }
    index = haystack.value.indexOf(needle, index + 1);
  }
}
