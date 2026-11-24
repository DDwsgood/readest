interface ContainsSearchOptions {
  matchCase: boolean;
  matchDiacritics: boolean;
}

interface SourceRun {
  foldedStart: number;
  sourceStart: number;
  foldedLength: number;
  sourceLength: number;
  extendedEnd?: number;
  aligned: boolean;
}

interface FoldedText {
  value: string;
  runs?: SourceRun[];
}

// NFD recursively decomposes Hangul syllables and adds no value for the other
// large CJK blocks. Leave those runs (and ASCII) untouched instead of paying
// for Unicode normalization on every character in Chinese/Japanese/Korean books.
const NORMALIZE_RUN =
  /[^\u0000-\u007f\u1100-\u11ff\u2e80-\u303e\u3040-\u30ff\u3130-\u318f\u31c0-\u31ef\u3200-\u32ff\u3300-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\u{20000}-\u{2fa1f}]+/gu;
const FORMAT_OR_COLLAPSED_WHITESPACE = /\p{Format}|\s{2,}/u;

const endsBeforeCombiningMark = (text: string, end: number) => /^\p{M}/u.test(text.slice(end));

const MAPPING_BOUNDARY = /\p{Format}+|\s{2,}/gu;
const SURROGATE = /[\uD800-\uDFFF]/;

const validLocale = (locale: string | undefined, matchCase: boolean) => {
  if (matchCase || !locale) return locale;
  try {
    ''.toLocaleLowerCase(locale);
    return locale;
  } catch {
    return undefined;
  }
};

const foldTextValue = (
  value: string,
  { matchCase = false, matchDiacritics = false }: Partial<ContainsSearchOptions> = {},
  locale?: string,
): string => {
  let folded = matchCase ? value : value.toLocaleLowerCase(locale);
  if (!matchDiacritics) {
    folded = folded.replace(NORMALIZE_RUN, (run) => run.normalize('NFD')).replace(/\p{M}/gu, '');
  }
  return folded.replace(/\p{Format}/gu, '').replace(/\s+/gu, ' ');
};

// Fold in bulk first and return UTF-16 source maps whenever characters are
// dropped, collapsed, or change length so matches map back to original text.
export const foldSearchText = (
  value: string,
  options: Partial<ContainsSearchOptions> = {},
  locale?: string,
): FoldedText => {
  const { matchCase = false, matchDiacritics = false } = options;
  locale = validLocale(locale, matchCase);
  const folded = foldTextValue(value, options, locale);
  // No removed characters, collapsed runs, or net length change: folded and
  // source UTF-16 offsets are aligned, so avoid two large mapping arrays.
  if (folded.length === value.length && !FORMAT_OR_COLLAPSED_WHITESPACE.test(value)) {
    return { value: folded };
  }

  const foldSource = (source: string, finalSigma = false) => {
    let transformed = source;
    if (!matchCase) {
      if (source === '\u03a3') transformed = finalSigma ? '\u03c2' : '\u03c3';
      else transformed = source.toLocaleLowerCase(locale);
    }
    if (!matchDiacritics) {
      transformed = transformed
        .replace(NORMALIZE_RUN, (run) => run.normalize('NFD'))
        .replace(/\p{M}/gu, '');
    }
    return transformed.replace(/\s+/gu, ' ');
  };

  const runs: SourceRun[] = [];
  let output = '';
  let pendingWhitespace: { start: number; end: number } | null = null;

  const extendPrevious = (end: number) => {
    if (pendingWhitespace) pendingWhitespace.end = end;
    else if (runs.length) runs[runs.length - 1]!.extendedEnd = end;
  };

  const flushWhitespace = () => {
    if (!pendingWhitespace) return;
    runs.push({
      foldedStart: output.length,
      sourceStart: pendingWhitespace.start,
      foldedLength: 1,
      sourceLength: pendingWhitespace.end - pendingWhitespace.start,
      aligned: false,
    });
    output += ' ';
    pendingWhitespace = null;
  };

  const append = (source: string, start: number, finalSigma = false) => {
    const end = start + source.length;
    if (/^\s$/u.test(source)) {
      if (pendingWhitespace) pendingWhitespace.end = end;
      else pendingWhitespace = { start, end };
      return;
    }
    const transformed = foldSource(source, finalSigma);
    if (!transformed) {
      extendPrevious(end);
      return;
    }
    flushWhitespace();
    runs.push({
      foldedStart: output.length,
      sourceStart: start,
      foldedLength: transformed.length,
      sourceLength: source.length,
      aligned: false,
    });
    output += transformed;
  };

  const appendOneByOne = (run: string, start: number) => {
    let sourceOffset = start;
    for (const source of run) {
      const sourceStart = sourceOffset;
      sourceOffset += source.length;
      const finalSigma =
        source === '\u03a3' &&
        /\p{Cased}[\p{Case_Ignorable}]*$/u.test(value.slice(0, sourceStart)) &&
        !/^\p{Case_Ignorable}*\p{Cased}/u.test(value.slice(sourceOffset));
      append(source, sourceStart, finalSigma);
    }
  };

  const appendRun = (originalRun: string, originalStart: number) => {
    if (!originalRun) return;
    let run = originalRun;
    let start = originalStart;
    let trailingWhitespace = '';
    // Keep edge whitespace pending so removing a format or combining character
    // cannot split what the whole-value fold turns into one collapsed space.
    if (/^\s/u.test(run)) {
      append(run[0]!, start);
      run = run.slice(1);
      start++;
    }
    if (run && /^\s/u.test(run.at(-1)!)) {
      trailingWhitespace = run.at(-1)!;
      run = run.slice(0, -1);
    }

    if (run) {
      const transformed = foldSource(run);
      if (
        !run.includes('\u03a3') &&
        transformed.length === run.length &&
        !SURROGATE.test(run) &&
        !(pendingWhitespace && /^\s/u.test(transformed)) &&
        !/\s$/u.test(transformed)
      ) {
        flushWhitespace();
        runs.push({
          foldedStart: output.length,
          sourceStart: start,
          foldedLength: run.length,
          sourceLength: run.length,
          aligned: true,
        });
        output += transformed;
      } else {
        appendOneByOne(run, start);
      }
    }
    if (trailingWhitespace) append(trailingWhitespace, originalStart + originalRun.length - 1);
  };

  let sourceOffset = 0;
  for (const match of value.matchAll(MAPPING_BOUNDARY)) {
    const start = match.index;
    appendRun(value.slice(sourceOffset, start), sourceOffset);
    const end = start + match[0].length;
    if (/^\p{Format}/u.test(match[0])) {
      extendPrevious(end);
    } else {
      if (pendingWhitespace) pendingWhitespace.end = end;
      else pendingWhitespace = { start, end };
    }
    sourceOffset = end;
  }
  appendRun(value.slice(sourceOffset), sourceOffset);
  flushWhitespace();
  return { value: output, runs };
};

export const foldValue = (value: string, options: ContainsSearchOptions, locale?: string): string =>
  foldSearchText(value, options, locale).value;

const sourceOffset = (runs: SourceRun[], index: number, end: boolean): number => {
  let low = 0;
  let high = runs.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (runs[middle]!.foldedStart <= index) low = middle;
    else high = middle - 1;
  }
  const run = runs[low]!;
  const offset = index - run.foldedStart;
  if (end && offset === run.foldedLength - 1 && run.extendedEnd !== undefined) {
    return run.extendedEnd;
  }
  if (!run.aligned) return run.sourceStart + (end ? run.sourceLength : 0);
  return run.sourceStart + offset + (end ? 1 : 0);
};

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
    const end = haystack.runs ? sourceOffset(haystack.runs, last, true) : last + 1;
    if (!options.matchDiacritics || !endsBeforeCombiningMark(text, end)) {
      yield { start: haystack.runs ? sourceOffset(haystack.runs, index, false) : index, end };
    }
    index = haystack.value.indexOf(needle, index + 1);
  }
}
