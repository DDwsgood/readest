import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaSearch, FaChevronDown } from 'react-icons/fa';
import { IoMdCloseCircle } from 'react-icons/io';
import { MdDeleteOutline } from 'react-icons/md';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore, useBookConfig, useBookData } from '@/store/bookDataStore';
import { getBookProgress, useBookProgressValue } from '@/store/readerProgressStore';
import { useReaderStore } from '@/store/readerStore';
import { CachedBookSearch, useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import {
  createLibrarySearchSession,
  resolveSearchResultCfis,
  searchLibraryBooks,
  type LibrarySearchSession,
} from '@/services/librarySearchService';
import { BookSearchConfig, BookSearchMatch, BookSearchResult } from '@/types/book';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { debounce } from '@/utils/debounce';
import { isCJKStr } from '@/utils/lang';
import {
  buildBookSearchKey,
  clearViewSearchHighlights,
  countBookSearchMatches,
  formatProofreadRulesRevision,
  getViewHighlightedSearchKey,
  setViewHighlightedSearchKey,
} from '@/utils/searchConfig';
import Dropdown from '@/components/Dropdown';
import SearchOptions from './SearchOptions';

const MINIMUM_SEARCH_TERM_LENGTH_DEFAULT = 2;
const MINIMUM_SEARCH_TERM_LENGTH_CJK = 1;
const SEARCH_HISTORY_KEY = 'search-history';
// Pre-search.db per-(term,config) JSON caches lived here; wiped once at
// startup now that reader search runs on the shared per-book search.db.
const LEGACY_SEARCH_CACHE_DIR = 'search';
let legacySearchCacheCleared = false;
const MAX_SEARCH_HISTORY = 10;

interface SearchBarProps {
  isVisible: boolean;
  bookKey: string;
  onHideSearchBar: () => void;
}

const SearchBar: React.FC<SearchBarProps> = ({ isVisible, bookKey, onHideSearchBar }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const getConfig = useBookDataStore((s) => s.getConfig);
  const setConfig = useBookDataStore((s) => s.setConfig);
  const saveConfig = useBookDataStore((s) => s.saveConfig);
  const { getView, getViewSettings } = useReaderStore();
  const {
    setSearchTerm,
    setSearchResults,
    setSearchProgress,
    setSearchError,
    setActiveSearchKey,
    setSearchCollapsedSections,
    getSearchNavState,
    getSearchStatus,
    setSearchStatus,
    getCachedSearches,
    getCachedSearch,
    putCachedSearch,
    clearCachedSearches,
  } = useSidebarStore();
  const viewSettings = getViewSettings(bookKey);
  const searchNavState = getSearchNavState(bookKey);

  const { searchTerm, searchError } = searchNavState;
  const activeSearchKey = searchNavState.activeSearchKey ?? null;
  const queuedSearchTerm = useRef('');
  const typingTermRef = useRef<string | null>(null);
  const suppressNextEffectTermRef = useRef<string | null>(null);
  const inFlightSearchKeyRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;
  const [isDebouncePending, setIsDebouncePending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputFocusedRef = useRef(false);

  const bookHash = useMemo(() => bookKey.split('-')[0]!, [bookKey]);
  const storedCachedSearches = getCachedSearches ? getCachedSearches(bookHash) : [];
  const historyStorageKey = useMemo(() => `${SEARCH_HISTORY_KEY}-${bookHash}`, [bookHash]);

  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(historyStorageKey);
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });

  useEffect(() => {
    const saved = localStorage.getItem(historyStorageKey);
    setSearchHistory(saved ? JSON.parse(saved) : []);
  }, [historyStorageKey]);

  const addToHistory = useCallback(
    (term: string) => {
      const filtered = searchHistory.filter((t) => t !== term);
      const updated = [term, ...filtered].slice(0, MAX_SEARCH_HISTORY);
      localStorage.setItem(historyStorageKey, JSON.stringify(updated));
      setSearchHistory(updated);
    },
    [historyStorageKey, searchHistory],
  );

  const view = getView(bookKey);
  // Reader search runs against the same per-book search.db the library page
  // uses; the session caches the opened book and index handle across queries.
  const searchSessionRef = useRef<LibrarySearchSession | null>(null);
  const searchControllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!legacySearchCacheCleared && appService) {
      legacySearchCacheCleared = true;
      void appService.deleteDir(LEGACY_SEARCH_CACHE_DIR, 'Cache', true).catch(() => {});
    }
  }, [appService]);

  const config = useBookConfig(bookKey)!;
  const bookData = useBookData(bookKey)!;
  const searchMode = (config.searchConfig as BookSearchConfig).mode;
  const readerSection = useBookProgressValue(
    isVisible && config.searchConfig?.scope === 'section' ? bookKey : null,
    (progress) => progress.section.current,
  );
  const rulesRevision = useMemo(
    () =>
      formatProofreadRulesRevision(
        viewSettings?.proofreadRules,
        settings?.globalViewSettings?.proofreadRules,
      ),
    [viewSettings?.proofreadRules, settings?.globalViewSettings?.proofreadRules],
  );
  // A recent search may belong to an older book file or proofread revision.
  // Keep cross-chapter entries, but never offer stale results for restoration.
  const cachedSearches = storedCachedSearches.filter(
    (cached) =>
      cached.searchKey ===
      buildBookSearchKey(
        cached.term,
        cached.config,
        cached.sectionIndex,
        bookData?.book?.updatedAt,
        rulesRevision,
      ),
  );

  const iconSize12 = useResponsiveSize(12);
  const iconSize16 = useResponsiveSize(16);

  const exceedMinSearchTermLength = useCallback(
    (term: string, modeOverride?: BookSearchConfig['mode']) => {
      const effectiveMode = modeOverride ?? searchMode;
      // Regex patterns can be a single character (e.g. \d), so bypass the gate.
      if (effectiveMode === 'regex') return term.length >= 1;
      const minLength = isCJKStr(term)
        ? MINIMUM_SEARCH_TERM_LENGTH_CJK
        : MINIMUM_SEARCH_TERM_LENGTH_DEFAULT;

      return term.length >= minLength;
    },
    [searchMode],
  );

  const getTargetSearchKey = useCallback(
    (term: string, cfgOverride?: BookSearchConfig) => {
      const effectiveConfig = cfgOverride ?? (getConfig(bookKey)?.searchConfig as BookSearchConfig);
      const sectionIndex =
        effectiveConfig?.scope === 'section'
          ? getBookProgress(bookKey)?.section.current
          : undefined;
      return buildBookSearchKey(
        term,
        effectiveConfig ?? {},
        sectionIndex,
        bookData?.book?.updatedAt,
        rulesRevision,
      );
    },
    [bookKey, getConfig, bookData?.book?.updatedAt, rulesRevision],
  );

  const replayViewHighlights = useCallback(
    async (
      term: string,
      searchConfig: BookSearchConfig,
      results: BookSearchResult[] | BookSearchMatch[],
      searchKey: string,
      signal: AbortSignal,
    ) => {
      const currentView = getView(bookKey);
      if (!currentView) return;
      if (results.length === 0) {
        clearViewSearchHighlights(currentView);
        return;
      }
      for await (const item of currentView.search({ ...searchConfig, query: term, results })) {
        if (signal.aborted || getSearchStatus(bookKey) === 'terminated') return;
        if (item === 'done') {
          setViewHighlightedSearchKey(currentView, searchKey);
          break;
        }
      }
    },
    [bookKey, getView, getSearchStatus],
  );

  const debouncedSearchHandlerRef = useRef<(term: string) => void>(() => {});
  const debouncedSearch = useMemo(
    () => debounce((term: string) => debouncedSearchHandlerRef.current(term), 500),
    [],
  );

  const cancelPendingDebounce = useCallback(() => {
    debouncedSearch.cancel();
    typingTermRef.current = null;
    setIsDebouncePending((pending) => (pending ? false : pending));
  }, [debouncedSearch]);

  const restoreCachedSearch = useCallback(
    (cached: CachedBookSearch) => {
      cancelPendingDebounce();
      searchControllerRef.current?.abort();
      inFlightSearchKeyRef.current = null;
      const controller = new AbortController();
      searchControllerRef.current = controller;
      queuedSearchTerm.current = cached.term;

      const currentConfig = getConfig(bookKey)?.searchConfig as BookSearchConfig | undefined;
      if (
        currentConfig &&
        (currentConfig.scope !== cached.config.scope ||
          currentConfig.mode !== cached.config.mode ||
          currentConfig.matchCase !== cached.config.matchCase ||
          currentConfig.matchDiacritics !== cached.config.matchDiacritics ||
          currentConfig.nearbyWords !== cached.config.nearbyWords)
      ) {
        setConfig(bookKey, { searchConfig: { ...cached.config } });
        saveConfig(envConfig, bookKey, getConfig(bookKey)!, settings);
      }

      if (getSearchNavState(bookKey).searchTerm !== cached.term) {
        suppressNextEffectTermRef.current = cached.term;
        setSearchTerm(bookKey, cached.term);
      }
      setSearchError(bookKey, null);
      setSearchProgress(bookKey, 1);
      setSearchStatus(bookKey, 'completed');
      setActiveSearchKey?.(bookKey, cached.searchKey, getBookProgress(bookKey)?.section.current);
      setSearchCollapsedSections?.(bookKey, cached.collapsedSections);
      setSearchResults(bookKey, cached.results);
      putCachedSearch?.(bookHash, cached);

      void replayViewHighlights(
        cached.term,
        cached.config,
        cached.results,
        cached.searchKey,
        controller.signal,
      );
    },
    [
      bookKey,
      bookHash,
      envConfig,
      settings,
      cancelPendingDebounce,
      getConfig,
      setConfig,
      saveConfig,
      getSearchNavState,
      setSearchTerm,
      setSearchError,
      setSearchProgress,
      setSearchStatus,
      setActiveSearchKey,
      setSearchCollapsedSections,
      setSearchResults,
      putCachedSearch,
      replayViewHighlights,
    ],
  );

  const handleSearch = useCallback(
    async (term: string) => {
      if (!isMountedRef.current || !isVisibleRef.current) return;
      const book = bookData.book;
      if (!book || !appService) return;

      // Read the latest config from the store, not the render closure: an option
      // change (e.g. "within N words") calls setConfig then triggers this search
      // synchronously, before this callback is recreated — so the closure's
      // `config` is stale by one change. getConfig reflects the just-set value.
      const searchConfig = getConfig(bookKey)!.searchConfig as BookSearchConfig;
      const currentReaderSection = getBookProgress(bookKey)?.section.current;
      const sectionIndex = searchConfig.scope === 'section' ? currentReaderSection : undefined;
      const targetKey = buildBookSearchKey(
        term,
        searchConfig,
        sectionIndex,
        book.updatedAt,
        rulesRevision,
      );

      if (inFlightSearchKeyRef.current === targetKey && getSearchStatus(bookKey) === 'searching') {
        return;
      }

      const currentNav = getSearchNavState(bookKey);
      if (
        currentNav.activeSearchKey === targetKey &&
        getSearchStatus(bookKey) === 'completed' &&
        currentNav.searchResults !== null &&
        currentNav.searchResults !== undefined
      ) {
        const currentView = getView(bookKey);
        if (
          currentView &&
          currentNav.searchResults.length > 0 &&
          getViewHighlightedSearchKey(currentView) !== targetKey
        ) {
          searchControllerRef.current?.abort();
          const controller = new AbortController();
          searchControllerRef.current = controller;
          await replayViewHighlights(
            term,
            searchConfig,
            currentNav.searchResults,
            targetKey,
            controller.signal,
          );
        }
        return;
      }

      const cached = getCachedSearch?.(bookHash, targetKey);
      if (cached) {
        restoreCachedSearch(cached);
        return;
      }

      console.log('searching for:', term);
      searchControllerRef.current?.abort();
      const controller = new AbortController();
      searchControllerRef.current = controller;
      inFlightSearchKeyRef.current = targetKey;
      const session = (searchSessionRef.current ??= createLibrarySearchSession(appService));

      setActiveSearchKey?.(bookKey, null);
      setSearchCollapsedSections?.(bookKey, []);
      setSearchProgress(bookKey, 0);
      setSearchStatus(bookKey, 'searching');
      setSearchError(bookKey, null);
      clearViewSearchHighlights(getView(bookKey));

      const results: BookSearchResult[] = [];
      const stopped = () =>
        !isMountedRef.current ||
        !isVisibleRef.current ||
        controller.signal.aborted ||
        getSearchStatus(bookKey) === 'terminated' ||
        queuedSearchTerm.current !== term;

      try {
        for await (const event of searchLibraryBooks(appService, [book], term, {
          config: searchConfig,
          signal: controller.signal,
          session,
          sectionIndex,
          // The library sweep caps each book so no single book floods the
          // shared results list; in-book search has no such competition and
          // must report every match.
          maxResultsPerBook: Infinity,
        })) {
          if (stopped()) return;
          if (event.type === 'progress') {
            setSearchProgress(bookKey, event.bookProgress);
          } else if (event.type === 'result') {
            // Results carry text-offset locators; resolve them to CFIs section
            // by section so the list and in-page highlights can address the DOM.
            const resolved = await resolveSearchResultCfis(
              session,
              book,
              event.result.subitems.map((match) => match.locator),
            );
            if (stopped()) return;
            const subitems: BookSearchMatch[] = [];
            event.result.subitems.forEach((match, index) => {
              const entry = resolved[index];
              if (!entry) return;
              subitems.push({
                cfi: entry.cfi,
                ...(entry.cfis ? { cfis: entry.cfis } : {}),
                excerpt: match.excerpt,
              });
            });
            if (subitems.length) {
              results.push({ index: event.result.index, label: event.result.label, subitems });
              setSearchResults(bookKey, [...results]);
            }
          } else if (event.type === 'book-error' || event.type === 'book-skipped') {
            const code = event.type === 'book-error' ? event.code : undefined;
            const message =
              code === 'INVALID_REGEX'
                ? _('Invalid regular expression')
                : code === 'NEARBY_NEEDS_TWO_WORDS'
                  ? _('Enter at least two words')
                  : code === 'FUZZY_QUERY_TOO_LONG'
                    ? _('Search query is too long')
                    : _('Search failed');
            if (event.type === 'book-error' && !code) {
              console.error('search failed:', event.error);
            }
            setSearchError(bookKey, message);
            setSearchResults(bookKey, []);
            setSearchStatus(bookKey, 'completed');
            setSearchProgress(bookKey, 1);
            return;
          } else if (event.type === 'book-completed') {
            const finalResults = [...results];
            setSearchStatus(bookKey, 'completed');
            setSearchResults(bookKey, finalResults);
            setActiveSearchKey?.(bookKey, targetKey, currentReaderSection);
            setSearchProgress(bookKey, 1);
            if (finalResults.length > 0) {
              addToHistory(term);
            }
            putCachedSearch?.(bookHash, {
              searchKey: targetKey,
              term,
              config: { ...searchConfig },
              sectionIndex,
              results: finalResults,
              matchCount: countBookSearchMatches(finalResults),
              collapsedSections: [],
            });
            console.log('search done');
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        // Replay the resolved matches through the view so every CFI gets its
        // search highlight; the view does no searching of its own here.
        if (!stopped() && results.length > 0) {
          await replayViewHighlights(term, searchConfig, results, targetKey, controller.signal);
        }
      } catch (err) {
        if (controller.signal.aborted || !isMountedRef.current) return;
        console.error('search failed:', err);
        setSearchError(bookKey, _('Search failed'));
        setSearchResults(bookKey, []);
        setSearchStatus(bookKey, 'completed');
        setSearchProgress(bookKey, 1);
      } finally {
        if (inFlightSearchKeyRef.current === targetKey) {
          inFlightSearchKeyRef.current = null;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      bookKey,
      bookHash,
      bookData,
      rulesRevision,
      appService,
      getConfig,
      getView,
      getSearchNavState,
      getSearchStatus,
      getCachedSearch,
      putCachedSearch,
      restoreCachedSearch,
      replayViewHighlights,
      setActiveSearchKey,
      setSearchCollapsedSections,
      setSearchResults,
      setSearchProgress,
      setSearchError,
      addToHistory,
    ],
  );

  const resetSearch = useCallback(() => {
    searchControllerRef.current?.abort();
    inFlightSearchKeyRef.current = null;
    setActiveSearchKey?.(bookKey, null);
    setSearchCollapsedSections?.(bookKey, []);
    setSearchResults(bookKey, null);
    clearViewSearchHighlights(view);
  }, [bookKey, view, setActiveSearchKey, setSearchCollapsedSections, setSearchResults]);

  debouncedSearchHandlerRef.current = (term: string) => {
    setIsDebouncePending(false);
    typingTermRef.current = null;
    if (!isMountedRef.current || !isVisibleRef.current) return;
    queuedSearchTerm.current = term;
    if (exceedMinSearchTermLength(term)) {
      void handleSearch(term);
    } else {
      resetSearch();
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      debouncedSearch.cancel();
      searchControllerRef.current?.abort();
      inFlightSearchKeyRef.current = null;
      void searchSessionRef.current?.close();
      searchSessionRef.current = null;
    };
  }, [debouncedSearch]);

  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.onblur = () => {
        inputFocusedRef.current = false;
      };
      inputRef.current.onfocus = () => {
        inputFocusedRef.current = true;
      };
      if (!appService?.isMobile) {
        inputRef.current.focus();
      }
    }
  }, [appService, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      cancelPendingDebounce();
      searchControllerRef.current?.abort();
      inFlightSearchKeyRef.current = null;
      return;
    }
    if (typingTermRef.current === searchTerm) return;
    if (suppressNextEffectTermRef.current === searchTerm) {
      suppressNextEffectTermRef.current = null;
      return;
    }

    cancelPendingDebounce();

    const targetKey = getTargetSearchKey(searchTerm);
    if (inFlightSearchKeyRef.current === targetKey && getSearchStatus(bookKey) === 'searching') {
      return;
    }

    const currentNav = getSearchNavState(bookKey);
    const effectiveConfig = getConfig(bookKey)?.searchConfig as BookSearchConfig;
    const currentReaderSection = getBookProgress(bookKey)?.section.current;
    const activeCached =
      currentNav.activeSearchKey && getCachedSearch
        ? getCachedSearch(bookHash, currentNav.activeSearchKey)
        : null;
    const isRestoredCrossChapterActive =
      effectiveConfig?.scope === 'section' &&
      activeCached !== null &&
      currentNav.activeReaderSection !== undefined &&
      currentNav.activeReaderSection === currentReaderSection &&
      buildBookSearchKey(
        searchTerm,
        effectiveConfig,
        activeCached.sectionIndex,
        bookData?.book?.updatedAt,
        rulesRevision,
      ) === currentNav.activeSearchKey;
    const reusableSearchKey =
      currentNav.activeSearchKey === targetKey
        ? targetKey
        : isRestoredCrossChapterActive
          ? currentNav.activeSearchKey
          : null;

    if (
      reusableSearchKey &&
      getSearchStatus(bookKey) === 'completed' &&
      currentNav.searchResults !== null &&
      currentNav.searchResults !== undefined
    ) {
      queuedSearchTerm.current = searchTerm;
      const currentView = getView(bookKey);
      if (
        currentView &&
        currentNav.searchResults.length > 0 &&
        getViewHighlightedSearchKey(currentView) !== reusableSearchKey
      ) {
        searchControllerRef.current?.abort();
        const controller = new AbortController();
        searchControllerRef.current = controller;
        void replayViewHighlights(
          searchTerm,
          effectiveConfig,
          currentNav.searchResults,
          reusableSearchKey,
          controller.signal,
        );
      }
      return;
    }

    if (exceedMinSearchTermLength(searchTerm)) {
      const cached = getCachedSearch?.(bookHash, targetKey);
      if (cached) {
        restoreCachedSearch(cached);
        return;
      }
    }

    setIsDebouncePending(true);
    debouncedSearch(searchTerm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, searchTerm, isVisible, rulesRevision, bookData?.book?.updatedAt, readerSection]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (inputRef.current && inputFocusedRef.current) {
          inputRef.current.blur();
        } else {
          onHideSearchBar();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onHideSearchBar]);

  const handleHistoryClick = (term: string) => {
    cancelPendingDebounce();
    const exactCached = getCachedSearch?.(bookHash, getTargetSearchKey(term));
    if (exactCached) {
      restoreCachedSearch(exactCached);
      return;
    }
    if (getSearchNavState(bookKey).searchTerm !== term) {
      suppressNextEffectTermRef.current = term;
      setSearchTerm(bookKey, term);
    }
    queuedSearchTerm.current = term;
    if (exceedMinSearchTermLength(term)) {
      void handleSearch(term);
    } else {
      resetSearch();
    }
  };

  const handleClearInput = () => {
    cancelPendingDebounce();
    suppressNextEffectTermRef.current = '';
    queuedSearchTerm.current = '';
    setSearchTerm(bookKey, '');
    resetSearch();
    inputRef.current?.focus();
  };

  const handleClearHistory = async () => {
    setSearchHistory([]);
    clearCachedSearches?.(bookHash);
    localStorage.removeItem(historyStorageKey);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    typingTermRef.current = value;
    setIsDebouncePending(true);
    setSearchTerm(bookKey, value);
    debouncedSearch(value);
  };

  const handleSearchConfigChange = (searchConfig: BookSearchConfig) => {
    cancelPendingDebounce();
    setConfig(bookKey, { searchConfig: { ...searchConfig } });
    // setConfig is synchronous, so getConfig now returns the merged config to persist.
    saveConfig(envConfig, bookKey, getConfig(bookKey)!, settings);
    if (!exceedMinSearchTermLength(searchTerm, searchConfig.mode)) {
      resetSearch();
      return;
    }
    const targetKey = getTargetSearchKey(searchTerm, searchConfig);
    const cached = getCachedSearch?.(bookHash, targetKey);
    if (cached) {
      restoreCachedSearch(cached);
      return;
    }
    queuedSearchTerm.current = searchTerm;
    void handleSearch(searchTerm);
  };

  return (
    <div className='relative flex flex-col gap-3 p-2'>
      <div className='bg-base-100 flex h-8 items-center rounded-lg'>
        <div className='absolute ps-3'>
          <FaSearch size={iconSize16} className='text-base-content/50' />
        </div>

        <input
          ref={inputRef}
          type='text'
          value={searchTerm}
          spellCheck={false}
          onChange={handleInputChange}
          placeholder={
            searchMode === 'regex'
              ? _('Search with regex')
              : searchMode === 'nearby-words'
                ? _('Words to find near each other')
                : _('Search...')
          }
          className='search-input w-full bg-transparent p-2 pr-0 ps-10 font-sans text-sm font-light focus:outline-hidden'
        />

        {searchTerm && (
          <button
            onClick={handleClearInput}
            className='absolute end-10 flex h-8 w-8 items-center justify-center bg-transparent'
            aria-label={_('Clear search')}
          >
            <IoMdCloseCircle size={iconSize16} className='text-base-content/75' />
          </button>
        )}

        <div
          className={clsx(
            'absolute end-2 flex h-8 w-8 items-center rounded-r-lg',
            viewSettings?.isEink ? 'bg-transparent' : 'bg-base-300',
          )}
        >
          <Dropdown
            label={_('Search Options')}
            className={clsx(
              window.innerWidth < 640 ? 'dropdown-end' : 'dropdown-center',
              'dropdown-bottom',
            )}
            menuClassName={clsx('no-triangle mt-1', window.innerWidth < 640 ? '' : 'relative!')}
            buttonClassName={clsx(
              'btn btn-ghost h-8 min-h-8 w-8 p-0 rounded-none rounded-r-lg',
              viewSettings?.isEink ? 'bg-transparent! hover:bg-transparent!' : '',
            )}
            toggleButton={<FaChevronDown size={iconSize12} className='text-base-content/50' />}
          >
            <SearchOptions
              isEink={!!viewSettings?.isEink}
              searchConfig={config.searchConfig as BookSearchConfig}
              onSearchConfigChanged={handleSearchConfigChange}
            />
          </Dropdown>
        </div>
      </div>

      {searchError && <div className='text-error px-2 text-xs'>{searchError}</div>}

      {cachedSearches.length > 0 && Boolean(searchTerm) && (
        <div
          className='scrollbar-hidden flex items-center gap-1.5 overflow-x-auto px-0.5'
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          role='group'
          aria-label={_('Recent searches')}
        >
          {cachedSearches.map((entry) => {
            const isActive =
              entry.searchKey === activeSearchKey &&
              entry.term === searchTerm &&
              !isDebouncePending;
            return (
              <button
                key={entry.searchKey}
                type='button'
                aria-current={isActive ? 'true' : undefined}
                onClick={() => {
                  cancelPendingDebounce();
                  if (!isActive) {
                    restoreCachedSearch(entry);
                  }
                }}
                className={clsx(
                  'flex max-w-[48%] shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs transition-colors',
                  isActive
                    ? 'btn-contrast font-medium'
                    : 'eink-bordered bg-base-100 text-base-content/75 hover:bg-base-300',
                )}
              >
                <span className='truncate'>{entry.term}</span>
                {entry.config.scope === 'section' && entry.sectionIndex !== undefined && (
                  <span
                    className={clsx(
                      'shrink-0 text-[10px]',
                      isActive ? 'opacity-75' : 'text-base-content/45',
                    )}
                  >
                    {`§${entry.sectionIndex + 1}`}
                  </span>
                )}
                <span
                  className={clsx(
                    'shrink-0 text-[10px]',
                    isActive ? 'opacity-80' : 'text-base-content/50',
                  )}
                >
                  {entry.matchCount}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {searchHistory.length > 0 && !searchTerm && (
        <div className='relative flex'>
          <div
            className={clsx(
              'from-base-200 pointer-events-none absolute start-0 top-0 h-full w-3 bg-linear-to-r to-transparent',
              viewSettings?.isEink ? 'hidden' : '',
            )}
            aria-hidden='true'
          />
          <div
            className='scrollbar-hidden flex flex-1 gap-1.5 overflow-x-auto'
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {searchHistory.map((term, index) => {
              const cachedHit = getCachedSearch?.(bookHash, getTargetSearchKey(term));
              return (
                <button
                  key={index}
                  type='button'
                  onClick={() => handleHistoryClick(term)}
                  className='eink-bordered hover:bg-base-300 text-base-content/70 bg-base-100 flex max-w-[60%] shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-0.5 text-xs'
                >
                  <p className='truncate'>{term}</p>
                  {cachedHit && (
                    <span className='text-base-content/50 shrink-0 text-[10px]'>
                      {cachedHit.matchCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div
            className={clsx(
              'from-base-200 pointer-events-none absolute end-6 top-0 h-full w-6 bg-linear-to-l to-transparent',
              viewSettings?.isEink ? 'hidden' : '',
            )}
            aria-hidden='true'
          />
          <button
            onClick={handleClearHistory}
            className={clsx(
              'text-base-content/50 hover:text-base-content/80 shrink-0 items-center',
              'flex h-6 min-h-6 w-8 min-w-8 items-center justify-center p-0',
            )}
            title={_('Clear search history')}
            aria-label={_('Clear search history')}
          >
            <MdDeleteOutline size={iconSize16} />
          </button>
        </div>
      )}
    </div>
  );
};

export default SearchBar;
