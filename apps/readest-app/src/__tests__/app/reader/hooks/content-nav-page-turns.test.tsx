// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useBooknotesNav } from '@/app/reader/hooks/useBooknotesNav';
import { useSearchNav } from '@/app/reader/hooks/useSearchNav';
import { useSidebarStore } from '@/store/sidebarStore';
import { clearBookProgress, setBookProgress } from '@/store/readerProgressStore';
import type { BookNote, BookProgress, BookSearchMatch } from '@/types/book';
import * as CFI from 'foliate-js/epubcfi.js';

// The search and booknote bars find the results on the shown page. They stay
// mounted while reading; with no results there is nothing to find, so a page
// turn must not re-render them.

vi.mock('@/store/readerStore', () => {
  const state = { getView: () => null };
  return {
    useReaderStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});
vi.mock('@/store/bookDataStore', () => {
  const state = { getConfig: () => ({ booknotes: [] }) };
  return {
    useBookDataStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

const turnTo = (page: number) =>
  act(() =>
    setBookProgress('book-1', {
      location: `epubcfi(/6/4!/4/${2 * page + 2},/1:0,/1:10)`,
    } as unknown as BookProgress),
  );

afterEach(() => {
  cleanup();
  clearBookProgress('book-1');
  act(() => {
    useSidebarStore.getState().clearSearch('book-1');
    useSidebarStore.getState().clearBooknotesNav('book-1');
  });
});

const countRenders = (hook: () => unknown) => {
  let renders = 0;
  renderHook(() => {
    renders++;
    return hook();
  });
  return () => renders;
};

describe.each([
  ['useSearchNav', () => useSearchNav('book-1')],
  ['useBooknotesNav', () => useBooknotesNav('book-1', [])],
])('%s on a page turn', (_name, hook) => {
  it('does not re-render without results', () => {
    turnTo(1);
    const renders = countRenders(hook);
    const before = renders();

    turnTo(2);
    turnTo(3);

    expect(renders()).toBe(before);
  });
});

describe('the bars with results', () => {
  // one result on page 1 and one on page 2: on page 2 the first is behind
  const cfis = ['epubcfi(/6/4!/4/4,/1:2,/1:5)', 'epubcfi(/6/4!/4/6,/1:2,/1:5)'];

  it('finds the search results on the page turned to', () => {
    const matches: BookSearchMatch[] = cfis.map((cfi) => ({
      cfi,
      excerpt: { pre: '', match: 'x', post: '' },
    }));
    act(() => useSidebarStore.getState().setSearchResults('book-1', matches));
    turnTo(1);
    const { result } = renderHook(() => useSearchNav('book-1'));
    expect(result.current.hasPreviousPage).toBe(false);

    turnTo(2);

    expect(result.current.hasPreviousPage).toBe(true);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('falls back to full CFI matching when an ID assertion contains a bang', () => {
    const matches: BookSearchMatch[] = cfis.map((cfi) => ({
      cfi,
      excerpt: { pre: '', match: 'x', post: '' },
    }));
    act(() => {
      useSidebarStore.getState().setSearchResults('book-1', matches);
      setBookProgress('book-1', {
        location: 'epubcfi(/6/4[ch!1]!/4,/1:0,/9:10)',
      } as unknown as BookProgress);
    });
    const { result } = renderHook(() => useSearchNav('book-1'));
    expect(result.current.hasPreviousPage).toBe(false);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('only compares search hits from the current section on a page turn', () => {
    const matches: BookSearchMatch[] = Array.from({ length: 90 }, (_, chapter) =>
      Array.from({ length: 50 }, (_, match) => ({
        cfi: `epubcfi(/6/${(chapter + 1) * 2}!/4/${match * 2 + 2}:0)`,
        excerpt: { pre: '', match: 'x', post: '' },
      })),
    ).flat();
    act(() => {
      useSidebarStore.getState().setSearchResults('book-1', matches);
      setBookProgress('book-1', {
        location: 'epubcfi(/6/160[current]!/4,/2:0,/200:0)',
      } as unknown as BookProgress);
    });
    const compare = vi.spyOn(CFI, 'compare');
    try {
      renderHook(() => useSearchNav('book-1'));
      // React StrictMode renders the hook twice; each of the section's 50 hits
      // needs two boundary comparisons. The other 4450 hits need none. ID
      // assertions in the location's spine step do not change its identity.
      expect(compare.mock.calls.length).toBeGreaterThan(0);
      expect(compare.mock.calls.length).toBeLessThanOrEqual(200);
    } finally {
      compare.mockRestore();
    }
  });

  it('finds the booknotes on the page turned to', () => {
    const notes = cfis.map((cfi, i) => ({ id: `n${i}`, type: 'annotation', cfi }) as BookNote);
    act(() => {
      useSidebarStore.getState().setActiveBooknoteType('book-1', 'annotation');
      useSidebarStore.getState().setBooknoteResults('book-1', notes);
    });
    turnTo(1);
    const { result } = renderHook(() => useBooknotesNav('book-1', []));
    expect(result.current.hasPreviousPage).toBe(false);

    turnTo(2);

    expect(result.current.hasPreviousPage).toBe(true);
    expect(result.current.hasNextPage).toBe(false);
  });
});
