// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SearchBar from '@/app/reader/components/sidebar/SearchBar';
import SearchResults from '@/app/reader/components/sidebar/SearchResults';
import { useSidebarStore } from '@/store/sidebarStore';
import { setBookProgress } from '@/store/readerProgressStore';
import type { BookProgress, BookSearchConfig, ProofreadRule } from '@/types/book';

const mocks = vi.hoisted(() => {
  const createView = () => ({
    search: vi.fn(),
    clearSearch: vi.fn(),
  });
  return {
    progress: { section: { current: 1 }, location: '' } as {
      section: { current: number };
      location: string;
    } | null,
    searchLibraryBooks: vi.fn(),
    resolveSearchResultCfis: vi.fn(),
    createView,
    activeView: createView(),
    bookUpdatedAt: 100,
    viewSettings: {} as { isEink?: boolean; proofreadRules?: ProofreadRule[] },
    searchConfig: {
      scope: 'book',
      mode: 'contains',
      matchCase: false,
      matchDiacritics: false,
      matchWholeWords: false,
    } as BookSearchConfig,
    appService: { deleteDir: vi.fn().mockResolvedValue(undefined) },
  };
});

vi.mock('@/services/librarySearchService', () => ({
  createLibrarySearchSession: () => ({ close: vi.fn().mockResolvedValue(undefined) }),
  resolveSearchResultCfis: mocks.resolveSearchResultCfis,
  searchLibraryBooks: mocks.searchLibraryBooks,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: mocks.appService }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: {} }),
}));

vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({
    getBookData: () => ({
      book: { hash: 'bookhash', primaryLanguage: 'en', updatedAt: mocks.bookUpdatedAt },
    }),
    getConfig: () => ({ searchConfig: mocks.searchConfig }),
    setConfig: (_key: string, patch: { searchConfig?: BookSearchConfig }) => {
      if (patch.searchConfig) {
        mocks.searchConfig = { ...patch.searchConfig };
      }
    },
    saveConfig: vi.fn(),
  })),
}));

vi.mock('@/store/readerProgressStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/readerProgressStore')>()),
  getBookProgress: () => mocks.progress,
  useBookProgress: () => mocks.progress,
}));

vi.mock('@/store/readerStore', () => {
  const state = {
    getView: () => mocks.activeView,
    getViewSettings: () => mocks.viewSettings,
    getProgress: () => mocks.progress ?? { location: '' },
  };
  return {
    useReaderStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) =>
    params ? key.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(params[k] ?? '')) : key,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
  useDefaultIconSize: () => 16,
}));

vi.mock('@/utils/cfi', () => ({
  findNearestCfi: () => null,
  isCfiInLocation: () => false,
}));

function SearchSurface({
  bookKey = 'bookhash-pane1',
  isVisible = true,
}: {
  bookKey?: string;
  isVisible?: boolean;
}) {
  const nav = useSidebarStore().getSearchNavState(bookKey);
  return (
    <div>
      <SearchBar isVisible={isVisible} bookKey={bookKey} onHideSearchBar={vi.fn()} />
      {isVisible && nav.searchResults && (
        <SearchResults bookKey={bookKey} results={nav.searchResults} onSelectResult={vi.fn()} />
      )}
    </div>
  );
}

describe('SearchBar remount & 3-entry LRU cache integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mocks.progress = { section: { current: 1 }, location: '' };
    setBookProgress('bookhash-pane1', mocks.progress as BookProgress);
    mocks.bookUpdatedAt = 100;
    mocks.viewSettings = {};
    mocks.activeView = mocks.createView();
    mocks.activeView.search.mockImplementation(async function* () {
      yield 'done';
    });
    mocks.searchConfig = {
      scope: 'book',
      mode: 'contains',
      matchCase: false,
      matchDiacritics: false,
      matchWholeWords: false,
    };
    useSidebarStore.setState({
      sideBarBookKey: 'bookhash-pane1',
      sideBarWidth: '',
      isSideBarVisible: true,
      isSideBarPinned: false,
      isSearchBarVisible: true,
      searchNavStates: {},
      booknotesNavStates: {},
      searchStatuses: {},
      recentSearchCaches: {},
    });

    mocks.resolveSearchResultCfis.mockReset().mockImplementation(async (_s, _b, locators) =>
      (locators as Array<{ section: number; start: number }>).map((loc, idx) => ({
        cfi: `epubcfi(/6/${(loc.section + 1) * 2}!/4/${idx + 1})`,
      })),
    );
    mocks.searchLibraryBooks.mockReset().mockImplementation(async function* (
      _svc: unknown,
      _books: unknown,
      query: string,
    ) {
      yield {
        type: 'result',
        result: {
          index: 0,
          label: 'Chapter One',
          subitems: [
            {
              locator: { section: 0, start: 0, end: query.length },
              excerpt: { pre: 'before ', match: query, post: ' after' },
            },
          ],
        },
      };
      yield {
        type: 'result',
        result: {
          index: 1,
          label: 'Chapter Two',
          subitems: [
            {
              locator: { section: 1, start: 0, end: query.length },
              excerpt: { pre: 'second ', match: query, post: ' end' },
            },
          ],
        },
      };
      yield { type: 'book-completed', book: { hash: 'bookhash' }, matchCount: 2 };
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const typeAndCompleteSearch = async (term: string) => {
    const input = screen.getByPlaceholderText('Search...');
    fireEvent.change(input, { target: { value: term } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
  };

  it('does NOT re-run search or lose collapsed chapters when remounting after jumping to a result', async () => {
    const { unmount } = render(<SearchSurface />);

    await typeAndCompleteSearch('alice');
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);
    expect(screen.getByText('2 results')).toBeTruthy();

    // Collapse Chapter One before clicking a result (which unmounts SideBar)
    fireEvent.click(screen.getByRole('button', { name: /Chapter One/ }));
    expect(screen.getByRole('button', { name: /Chapter One/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );

    mocks.activeView.clearSearch.mockClear();
    mocks.activeView.search.mockClear();

    // Simulate SideBar hiding when user jumps to a search result
    unmount();

    // Simulate user reopening the search results page on the same FoliateView
    render(<SearchSurface />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    // Must NOT re-run searchLibraryBooks, clear highlights, or redundantly replay highlights
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);
    expect(mocks.activeView.clearSearch).not.toHaveBeenCalled();
    expect(mocks.activeView.search).not.toHaveBeenCalled();
    expect(screen.getByText('2 results')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Chapter One/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('caches the 3 most recent searches (LRU), keeps E-ink contrast classes, switches in 0ms, and evicts the 4th', async () => {
    render(<SearchSurface />);

    await typeAndCompleteSearch('alice');
    await typeAndCompleteSearch('rabbit');
    await typeAndCompleteSearch('queen');
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(3);

    // Active pill uses btn-contrast (without eink-bordered); inactive pills use eink-bordered
    const group = screen.getByRole('group', { name: 'Recent searches' });
    const pills = Array.from(group.querySelectorAll('button'));
    expect(pills.map((b) => b.textContent)).toEqual(['queen2', 'rabbit2', 'alice2']);
    expect(pills[0]!.getAttribute('aria-current')).toBe('true');
    expect(pills[0]!.className).toContain('btn-contrast');
    expect(pills[0]!.className).not.toContain('eink-bordered');
    expect(pills[1]!.className).toContain('eink-bordered');

    // Click 'alice' pill -> restores immediately in 0ms WITHOUT advancing debounce timers
    act(() => {
      fireEvent.click(pills[2]!);
    });
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(3);
    expect(useSidebarStore.getState().getSearchNavState('bookhash-pane1').searchTerm).toBe('alice');

    // Now 'alice' was promoted to MRU, so order is ['alice', 'queen', 'rabbit'].
    // Searching a 4th term 'hatter' must evict 'rabbit' and keep ['hatter', 'alice', 'queen'].
    await typeAndCompleteSearch('hatter');
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(4);

    const updatedGroup = screen.getByRole('group', { name: 'Recent searches' });
    const updatedPills = Array.from(updatedGroup.querySelectorAll('button'));
    expect(updatedPills.map((b) => b.textContent)).toEqual(['hatter2', 'alice2', 'queen2']);

    // Restoring after closing search via clearSearch also hits cache in 0ms
    act(() => {
      useSidebarStore.getState().clearSearch('bookhash-pane1');
    });
    const queenHistoryBtn = screen.getByRole('button', { name: /queen/ });
    await act(async () => {
      fireEvent.click(queenHistoryBtn);
    });
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(4);
    expect(useSidebarStore.getState().getSearchNavState('bookhash-pane1').searchTerm).toBe('queen');
  });

  it('cancels pending debounce on unmount or hide after history updates (H1)', async () => {
    const { rerender, unmount } = render(<SearchSurface />);

    // First search updates searchHistory
    await typeAndCompleteSearch('alice');
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);

    // Type a new term and hide before 500ms elapses
    const input = screen.getByPlaceholderText('Search...');
    fireEvent.change(input, { target: { value: 'wonderland' } });
    rerender(<SearchSurface isVisible={false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);

    // Show again, type another term, and unmount within 500ms
    rerender(<SearchSurface isVisible />);
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'cheshire' } });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);
  });

  it('cancels pending typing timer on external search-term update or active pill click (H2)', async () => {
    render(<SearchSurface />);
    await typeAndCompleteSearch('alice');
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);

    // Start typing 'bob' (debounce pending)
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'bob' } });

    // External Annotator search sets term back to 'alice' before 500ms
    act(() => {
      useSidebarStore.getState().setSearchTerm('bookhash-pane1', 'alice');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);
    expect(useSidebarStore.getState().getSearchNavState('bookhash-pane1').searchTerm).toBe('alice');

    // Type 'dormouse', then click the 'alice' cached pill within 500ms
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'dormouse' } });
    const group = screen.getByRole('group', { name: 'Recent searches' });
    const alicePill = Array.from(group.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('alice'),
    )!;
    act(() => {
      fireEvent.click(alicePill);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);
    expect(useSidebarStore.getState().getSearchNavState('bookhash-pane1').searchTerm).toBe('alice');
  });

  it('preserves cross-chapter cached pill results without overwriting with current chapter (H3)', async () => {
    mocks.searchConfig = { ...mocks.searchConfig, scope: 'section' };
    mocks.progress = { section: { current: 0 }, location: '' };

    const { unmount } = render(<SearchSurface />);
    await typeAndCompleteSearch('alice');
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);
    expect(mocks.searchLibraryBooks.mock.calls[0]![3].sectionIndex).toBe(0);

    // Move to chapter 5 (index 4) and search 'rabbit'
    mocks.progress = { section: { current: 4 }, location: '' };
    await typeAndCompleteSearch('rabbit');
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(2);
    expect(mocks.searchLibraryBooks.mock.calls[1]![3].sectionIndex).toBe(4);

    // Click 'alice §1' pill while still on chapter 5 -> must NOT re-search chapter 5!
    const group = screen.getByRole('group', { name: 'Recent searches' });
    const alicePill = Array.from(group.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('alice'),
    )!;
    expect(alicePill.textContent).toContain('§1');
    act(() => {
      fireEvent.click(alicePill);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(2);
    expect(useSidebarStore.getState().getSearchNavState('bookhash-pane1').searchTerm).toBe('alice');

    // Closing and reopening SideBar without changing chapters keeps 'alice §1' intact
    unmount();
    const reopened = render(<SearchSurface />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(2);

    // Turning pages to chapter 6 (index 5) and reopening searches chapter 6
    reopened.unmount();
    mocks.progress = { section: { current: 5 }, location: '' };
    render(<SearchSurface />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(3);
    expect(mocks.searchLibraryBooks.mock.calls[2]![3].sectionIndex).toBe(5);
  });

  it('replays highlights when FoliateView is recreated and invalidates on proofreadRules change (M1)', async () => {
    const { unmount } = render(<SearchSurface />);
    await typeAndCompleteSearch('alice');
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);
    expect(mocks.activeView.search).toHaveBeenCalledTimes(1);

    // Recreate FoliateView (same rules) and remount -> replays view.search without re-running searchLibraryBooks
    unmount();
    const freshView = mocks.createView();
    freshView.search.mockImplementation(async function* () {
      yield 'done';
    });
    mocks.activeView = freshView;
    const secondMount = render(<SearchSurface />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);
    expect(freshView.search).toHaveBeenCalledTimes(1);

    // Add an active proofread rule -> invalidates searchKey and runs fresh search
    mocks.viewSettings = {
      proofreadRules: [
        {
          id: 'r1',
          scope: 'book',
          pattern: 'alice',
          replacement: 'Alice',
          enabled: true,
          isRegex: false,
          wholeWord: false,
          onlyForTTS: false,
          order: 0,
        },
      ],
    };
    secondMount.rerender(<SearchSurface />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(2);
  });

  it('refreshes a mounted section search when the reader changes chapters', async () => {
    mocks.searchConfig = { ...mocks.searchConfig, scope: 'section' };
    render(<SearchSurface />);
    await typeAndCompleteSearch('alice');
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);

    act(() => {
      mocks.progress = { section: { current: 4 }, location: '' };
      setBookProgress('bookhash-pane1', mocks.progress as BookProgress);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(2);
    expect(mocks.searchLibraryBooks.mock.calls[1]![3].sectionIndex).toBe(4);
  });

  it.each([
    'rules',
    'book',
  ] as const)('hides stale cache pills after %s changes', async (change) => {
    const surface = render(<SearchSurface />);
    await typeAndCompleteSearch('alice');
    await typeAndCompleteSearch('rabbit');

    if (change === 'rules') {
      mocks.viewSettings = {
        proofreadRules: [
          {
            id: 'r1',
            scope: 'book',
            pattern: 'alice',
            replacement: 'Alice',
            enabled: true,
            isRegex: false,
            wholeWord: false,
            onlyForTTS: false,
            order: 0,
          },
        ],
      };
    } else {
      mocks.bookUpdatedAt = 200;
    }
    surface.rerender(<SearchSurface />);

    expect(screen.queryByRole('button', { name: /^alice2$/ })).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(3);
  });

  it('invalidates results when rule order changes without reordering the stored array', async () => {
    const rule: ProofreadRule = {
      id: 'r1',
      scope: 'book',
      pattern: 'alice',
      replacement: 'queen',
      enabled: true,
      isRegex: false,
      wholeWord: false,
      onlyForTTS: false,
      order: 0,
    };
    mocks.viewSettings = {
      proofreadRules: [
        rule,
        { ...rule, id: 'r2', pattern: 'queen', replacement: 'rabbit', order: 1 },
      ],
    };
    const surface = render(<SearchSurface />);
    await typeAndCompleteSearch('alice');
    mocks.viewSettings = {
      proofreadRules: mocks.viewSettings.proofreadRules!.map((entry) => ({
        ...entry,
        order: entry.order === 0 ? 1 : 0,
      })),
    };
    surface.rerender(<SearchSurface />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(2);
  });

  it('caches 0-match completed searches and runs slow (>500ms) uncached history clicks only once (M3 & M4)', async () => {
    // Seed uncached history 'slowterm'
    localStorage.setItem('search-history-bookhash', JSON.stringify(['slowterm']));

    mocks.searchLibraryBooks.mockImplementation(async function* (
      _svc: unknown,
      _books: unknown,
      query: string,
    ) {
      if (query === 'nomatch') {
        yield { type: 'book-completed', book: { hash: 'bookhash' }, matchCount: 0 };
        return;
      }
      // Slow scan taking 800ms (> 500ms debounce)
      await new Promise((resolve) => setTimeout(resolve, 800));
      yield {
        type: 'result',
        result: {
          index: 0,
          label: 'Chapter One',
          subitems: [
            {
              locator: { section: 0, start: 0, end: query.length },
              excerpt: { pre: '', match: query, post: '' },
            },
          ],
        },
      };
      yield { type: 'book-completed', book: { hash: 'bookhash' }, matchCount: 1 };
    });

    render(<SearchSurface />);

    // M4: Click uncached history chip 'slowterm' -> must NOT re-trigger at 500ms
    fireEvent.click(screen.getByRole('button', { name: /slowterm/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(1);

    // M3: Run 0-match search 'nomatch', switch to 'slowterm', then switch back to 'nomatch' -> 0ms cache hit!
    await typeAndCompleteSearch('nomatch');
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(2);

    const group = screen.getByRole('group', { name: 'Recent searches' });
    const pills = Array.from(group.querySelectorAll('button'));
    expect(pills.map((b) => b.textContent)).toEqual(['nomatch0', 'slowterm1']);

    act(() => {
      fireEvent.click(pills[1]!);
    });
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(2);

    const groupAfter = screen.getByRole('group', { name: 'Recent searches' });
    const nomatchPill = Array.from(groupAfter.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('nomatch'),
    )!;
    act(() => {
      fireEvent.click(nomatchPill);
    });
    expect(mocks.searchLibraryBooks).toHaveBeenCalledTimes(2);
    expect(useSidebarStore.getState().getSearchNavState('bookhash-pane1').searchResults).toEqual(
      [],
    );
  });
});
