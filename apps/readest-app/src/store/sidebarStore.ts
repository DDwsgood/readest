import { create } from 'zustand';
import {
  BookNote,
  BookNoteType,
  BookSearchConfig,
  BookSearchMatch,
  BookSearchResult,
} from '@/types/book';
import { MAX_RECENT_SEARCH_RESULTS } from '@/utils/searchConfig';

type SearchStatus = 'searching' | 'completed' | 'terminated';

export interface CachedBookSearch {
  searchKey: string;
  term: string;
  config: BookSearchConfig;
  sectionIndex?: number;
  results: BookSearchResult[] | BookSearchMatch[];
  matchCount: number;
  collapsedSections: string[];
}

// Per-book search navigation state
interface SearchNavState {
  searchTerm: string;
  searchResults: BookSearchResult[] | BookSearchMatch[] | null;
  searchResultIndex: number;
  searchProgress: number; // 0 to 1, where 1 means search complete
  searchError: string | null; // invalid regex / nearby-words parse error, shown inline
  activeSearchKey: string | null;
  activeReaderSection?: number;
  collapsedSections: string[];
}

// Per-book booknotes navigation state
interface BooknotesNavState {
  activeBooknoteType: BookNoteType | null;
  booknoteResults: BookNote[] | null;
  booknoteIndex: number;
}

interface SidebarState {
  sideBarBookKey: string | null;
  sideBarWidth: string;
  isSideBarVisible: boolean;
  isSideBarPinned: boolean;
  isSearchBarVisible: boolean;
  // Per-book navigation states
  searchNavStates: Record<string, SearchNavState>;
  booknotesNavStates: Record<string, BooknotesNavState>;
  searchStatuses: Record<string, SearchStatus>;
  // Per-bookHash LRU cache of recent completed searches (up to MAX_RECENT_SEARCH_RESULTS)
  recentSearchCaches: Record<string, CachedBookSearch[]>;
  getIsSideBarVisible: () => boolean;
  getSideBarWidth: () => string;
  setSideBarBookKey: (key: string) => void;
  setSideBarWidth: (width: string) => void;
  toggleSideBar: () => void;
  toggleSideBarPin: () => void;
  setSideBarVisible: (visible: boolean) => void;
  setSideBarPin: (pinned: boolean) => void;
  setSearchBarVisible: (visible: boolean) => void;
  // Search actions (per bookKey)
  getSearchNavState: (bookKey: string) => SearchNavState;
  setSearchTerm: (bookKey: string, term: string) => void;
  setSearchStatus: (bookKey: string, status: SearchStatus) => void;
  getSearchStatus: (bookKey: string) => SearchStatus | null;
  setSearchResults: (
    bookKey: string,
    results: BookSearchResult[] | BookSearchMatch[] | null,
  ) => void;
  setSearchResultIndex: (bookKey: string, index: number) => void;
  setSearchProgress: (bookKey: string, progress: number) => void;
  setSearchError: (bookKey: string, error: string | null) => void;
  setActiveSearchKey: (bookKey: string, searchKey: string | null, readerSection?: number) => void;
  setSearchCollapsedSections: (bookKey: string, collapsedSections: string[]) => void;
  getCachedSearches: (bookHash: string) => CachedBookSearch[];
  getCachedSearch: (bookHash: string, searchKey: string) => CachedBookSearch | null;
  putCachedSearch: (bookHash: string, entry: CachedBookSearch) => void;
  clearCachedSearches: (bookHash: string) => void;
  clearSearch: (bookKey: string) => void;
  // Booknotes navigation actions (per bookKey)
  getBooknotesNavState: (bookKey: string) => BooknotesNavState;
  setActiveBooknoteType: (bookKey: string, type: BookNoteType | null) => void;
  setBooknoteResults: (bookKey: string, results: BookNote[] | null) => void;
  setBooknoteIndex: (bookKey: string, index: number) => void;
  clearBooknotesNav: (bookKey: string) => void;
}

const defaultSearchNavState: SearchNavState = {
  searchTerm: '',
  searchResults: null,
  searchResultIndex: 0,
  searchProgress: 1,
  searchError: null,
  activeSearchKey: null,
  activeReaderSection: undefined,
  collapsedSections: [],
};

const EMPTY_CACHED_SEARCHES: CachedBookSearch[] = [];

const defaultBooknotesNavState: BooknotesNavState = {
  activeBooknoteType: null,
  booknoteResults: null,
  booknoteIndex: 0,
};

export const useSidebarStore = create<SidebarState>((set, get) => ({
  sideBarBookKey: null,
  sideBarWidth: '',
  isSideBarVisible: false,
  isSideBarPinned: false,
  isSearchBarVisible: false,
  // Per-book navigation states
  searchNavStates: {},
  booknotesNavStates: {},
  searchStatuses: {},
  recentSearchCaches: {},
  getIsSideBarVisible: () => get().isSideBarVisible,
  getSideBarWidth: () => get().sideBarWidth,
  setSideBarBookKey: (key: string) => set({ sideBarBookKey: key }),
  setSideBarWidth: (width: string) => set({ sideBarWidth: width }),
  toggleSideBar: () => set((state) => ({ isSideBarVisible: !state.isSideBarVisible })),
  toggleSideBarPin: () => set((state) => ({ isSideBarPinned: !state.isSideBarPinned })),
  setSideBarVisible: (visible: boolean) => set({ isSideBarVisible: visible }),
  setSideBarPin: (pinned: boolean) => set({ isSideBarPinned: pinned }),
  setSearchBarVisible: (visible: boolean) => set({ isSearchBarVisible: visible }),
  // Search actions
  getSearchStatus: (bookKey: string) => {
    return get().searchStatuses[bookKey] || null;
  },
  getSearchNavState: (bookKey: string) => {
    return get().searchNavStates[bookKey] || defaultSearchNavState;
  },
  setSearchTerm: (bookKey: string, term: string) =>
    set((state) => ({
      searchNavStates: {
        ...state.searchNavStates,
        [bookKey]: {
          ...(state.searchNavStates[bookKey] || defaultSearchNavState),
          searchTerm: term,
          activeReaderSection: undefined,
        },
      },
    })),
  setSearchResults: (bookKey: string, results: BookSearchResult[] | BookSearchMatch[] | null) =>
    set((state) => ({
      searchNavStates: {
        ...state.searchNavStates,
        [bookKey]: {
          ...(state.searchNavStates[bookKey] || defaultSearchNavState),
          searchResults: results,
        },
      },
    })),
  setSearchResultIndex: (bookKey: string, index: number) =>
    set((state) => ({
      searchNavStates: {
        ...state.searchNavStates,
        [bookKey]: {
          ...(state.searchNavStates[bookKey] || defaultSearchNavState),
          searchResultIndex: index,
        },
      },
    })),
  setSearchProgress: (bookKey: string, progress: number) =>
    set((state) => ({
      searchNavStates: {
        ...state.searchNavStates,
        [bookKey]: {
          ...(state.searchNavStates[bookKey] || defaultSearchNavState),
          searchProgress: progress,
        },
      },
    })),
  setSearchError: (bookKey: string, error: string | null) =>
    set((state) => ({
      searchNavStates: {
        ...state.searchNavStates,
        [bookKey]: {
          ...(state.searchNavStates[bookKey] || defaultSearchNavState),
          searchError: error,
        },
      },
    })),
  setActiveSearchKey: (bookKey: string, searchKey: string | null, readerSection?: number) =>
    set((state) => ({
      searchNavStates: {
        ...state.searchNavStates,
        [bookKey]: {
          ...(state.searchNavStates[bookKey] || defaultSearchNavState),
          activeSearchKey: searchKey,
          activeReaderSection: searchKey ? readerSection : undefined,
        },
      },
    })),
  setSearchCollapsedSections: (bookKey: string, collapsedSections: string[]) =>
    set((state) => {
      const currentNav = state.searchNavStates[bookKey] || defaultSearchNavState;
      const bookHash = bookKey.split('-')[0]!;
      const existingCaches = state.recentSearchCaches[bookHash];
      const nextCaches =
        currentNav.activeSearchKey && existingCaches?.length
          ? existingCaches.map((entry) =>
              entry.searchKey === currentNav.activeSearchKey
                ? { ...entry, collapsedSections }
                : entry,
            )
          : existingCaches;

      return {
        searchNavStates: {
          ...state.searchNavStates,
          [bookKey]: {
            ...currentNav,
            collapsedSections,
          },
        },
        ...(nextCaches
          ? {
              recentSearchCaches: {
                ...state.recentSearchCaches,
                [bookHash]: nextCaches,
              },
            }
          : {}),
      };
    }),
  getCachedSearches: (bookHash: string) => {
    return get().recentSearchCaches[bookHash] || EMPTY_CACHED_SEARCHES;
  },
  getCachedSearch: (bookHash: string, searchKey: string) => {
    const list = get().recentSearchCaches[bookHash];
    if (!list) return null;
    return list.find((entry) => entry.searchKey === searchKey) || null;
  },
  putCachedSearch: (bookHash: string, entry: CachedBookSearch) =>
    set((state) => {
      const current = state.recentSearchCaches[bookHash] || EMPTY_CACHED_SEARCHES;
      const filtered = current.filter((item) => item.searchKey !== entry.searchKey);
      const updated = [entry, ...filtered].slice(0, MAX_RECENT_SEARCH_RESULTS);
      return {
        recentSearchCaches: {
          ...state.recentSearchCaches,
          [bookHash]: updated,
        },
      };
    }),
  clearCachedSearches: (bookHash: string) =>
    set((state) => {
      if (!state.recentSearchCaches[bookHash]) return state;
      const next = { ...state.recentSearchCaches };
      delete next[bookHash];
      return { recentSearchCaches: next };
    }),
  clearSearch: (bookKey: string) =>
    set((state) => ({
      searchNavStates: {
        ...state.searchNavStates,
        [bookKey]: { ...defaultSearchNavState },
      },
      searchStatuses: {
        ...state.searchStatuses,
        [bookKey]: 'terminated',
      },
    })),
  setSearchStatus: (bookKey: string, status: SearchStatus) =>
    set((state) => ({
      searchStatuses: {
        ...state.searchStatuses,
        [bookKey]: status,
      },
    })),
  // Booknotes navigation actions
  getBooknotesNavState: (bookKey: string) => {
    return get().booknotesNavStates[bookKey] || defaultBooknotesNavState;
  },
  setActiveBooknoteType: (bookKey: string, type: BookNoteType | null) =>
    set((state) => ({
      booknotesNavStates: {
        ...state.booknotesNavStates,
        [bookKey]: {
          ...(state.booknotesNavStates[bookKey] || defaultBooknotesNavState),
          activeBooknoteType: type,
        },
      },
    })),
  setBooknoteResults: (bookKey: string, results: BookNote[] | null) =>
    set((state) => ({
      booknotesNavStates: {
        ...state.booknotesNavStates,
        [bookKey]: {
          ...(state.booknotesNavStates[bookKey] || defaultBooknotesNavState),
          booknoteResults: results,
        },
      },
    })),
  setBooknoteIndex: (bookKey: string, index: number) =>
    set((state) => ({
      booknotesNavStates: {
        ...state.booknotesNavStates,
        [bookKey]: {
          ...(state.booknotesNavStates[bookKey] || defaultBooknotesNavState),
          booknoteIndex: index,
        },
      },
    })),
  clearBooknotesNav: (bookKey: string) =>
    set((state) => ({
      booknotesNavStates: {
        ...state.booknotesNavStates,
        [bookKey]: { ...defaultBooknotesNavState },
      },
    })),
}));
