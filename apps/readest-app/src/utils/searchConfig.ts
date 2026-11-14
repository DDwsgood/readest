import {
  BookSearchConfig,
  BookSearchMatch,
  BookSearchResult,
  ProofreadRule,
  SearchMode,
} from '@/types/book';

export const DEFAULT_NEARBY_WORDS = 10;
export const MAX_RECENT_SEARCH_RESULTS = 3;

export const modeToWholeWords = (mode: SearchMode): boolean => mode === 'whole-words';

// v2 configs (and pre-v3 sync peers) encode whole-word matching as a boolean and
// have no `mode`. Derive the mode from the boolean when `mode` is absent.
export const ensureSearchMode = (config: Partial<BookSearchConfig>): SearchMode =>
  config.mode ?? (config.matchWholeWords ? 'whole-words' : 'contains');

export const formatProofreadRulesRevision = (
  bookRules?: ProofreadRule[],
  globalRules?: ProofreadRule[],
): string => {
  const active = [...(globalRules ?? []), ...(bookRules ?? [])].filter(
    (rule) => rule.enabled && !rule.deletedAt && !rule.onlyForTTS,
  );
  if (active.length === 0) return '';
  return active
    .map(
      (rule) =>
        `${rule.id}:${rule.order}:${rule.pattern}:${rule.replacement}:${rule.isRegex ? 1 : 0}:${rule.wholeWord ? 1 : 0}:${rule.caseSensitive === false ? 0 : 1}`,
    )
    .join('|');
};

export const buildBookSearchKey = (
  term: string,
  config: Partial<BookSearchConfig>,
  sectionIndex?: number,
  bookUpdatedAt?: number,
  rulesRevision = '',
): string => {
  const mode = ensureSearchMode(config);
  const scopePart = config.scope === 'section' ? `section:${sectionIndex ?? 'all'}` : 'book';
  const nearbyPart =
    mode === 'nearby-words' ? String(config.nearbyWords ?? DEFAULT_NEARBY_WORDS) : '';
  // Diacritics modifier has no effect under regex mode.
  const diacriticsPart = mode === 'regex' ? '0' : config.matchDiacritics ? '1' : '0';
  return [
    String(bookUpdatedAt ?? 0),
    rulesRevision,
    scopePart,
    mode,
    config.matchCase ? '1' : '0',
    diacriticsPart,
    nearbyPart,
    term,
  ].join('\0');
};

export const countBookSearchMatches = (results: BookSearchResult[] | BookSearchMatch[]): number =>
  results.reduce((sum, result) => sum + ('subitems' in result ? result.subitems.length : 1), 0);

const highlightedViewSearchKeys = new WeakMap<object, string>();

export const getViewHighlightedSearchKey = (view: object | null | undefined): string | undefined =>
  view ? highlightedViewSearchKeys.get(view) : undefined;

export const setViewHighlightedSearchKey = (
  view: object | null | undefined,
  searchKey: string,
): void => {
  if (view) {
    highlightedViewSearchKeys.set(view, searchKey);
  }
};

export const clearViewSearchHighlights = (
  view: ({ clearSearch: () => void } & object) | null | undefined,
): void => {
  if (!view) return;
  highlightedViewSearchKeys.delete(view);
  view.clearSearch();
};
