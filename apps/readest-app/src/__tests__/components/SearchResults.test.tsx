// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SearchResults from '@/app/reader/components/sidebar/SearchResults';
import { BookSearchResult } from '@/types/book';

const navState = vi.hoisted(() => ({ searchProgress: 1 }));
const virtuosoState = vi.hoisted(() => ({
  renderLimit: Number.POSITIVE_INFINITY,
  groupCounts: [] as number[],
  initialTopMostItemIndex: undefined as unknown,
  scrollToIndex: [] as unknown[],
}));
const cfiState = vi.hoisted(() => ({
  locationChecks: 0,
  nearestCfi: null as string | null,
}));
const readerStoreState = vi.hoisted(() => ({
  getProgress: () => ({ location: '' }),
  getView: () => null,
}));

vi.mock('@/store/readerStore', () => ({
  // Emulate zustand's selector semantics: with a selector return its result,
  // without (SearchResultItem's whole-store destructure) return the state.
  useReaderStore: (selector?: (s: typeof readerStoreState) => unknown) =>
    selector ? selector(readerStoreState) : readerStoreState,
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    getSearchNavState: () => ({
      searchProgress: navState.searchProgress,
      searchError: null,
    }),
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/utils/cfi', () => ({
  findNearestCfi: () => cfiState.nearestCfi,
  createCfiLocationMatcher: () => () => {
    cfiState.locationChecks++;
    return false;
  },
}));

// happy-dom has no layout engine for the real virtualizer to measure. This
// stub renders every row for interaction tests, or only the configured number
// of rows to model a small viewport for the virtualization regression test.
vi.mock('react-virtuoso', async () => {
  const ReactMod = await import('react');
  return {
    GroupedVirtuoso: ReactMod.forwardRef(
      (
        props: {
          groupCounts: number[];
          initialTopMostItemIndex?: unknown;
          groupContent?: (index: number) => React.ReactNode;
          itemContent?: (index: number, groupIndex: number) => React.ReactNode;
        },
        ref: React.Ref<unknown>,
      ) => {
        ReactMod.useImperativeHandle(ref, () => ({
          scrollToIndex: (options: unknown) => virtuosoState.scrollToIndex.push(options),
        }));
        virtuosoState.groupCounts = [...props.groupCounts];
        virtuosoState.initialTopMostItemIndex = props.initialTopMostItemIndex;
        let remaining = virtuosoState.renderLimit;
        let offset = 0;
        return (
          <div data-virtuoso-scroller='true'>
            {props.groupCounts.map((count, groupIndex) => {
              const start = offset;
              offset += count;
              const renderedCount = Math.max(0, Math.min(count, remaining));
              remaining -= renderedCount;
              return (
                <div key={groupIndex}>
                  {props.groupContent?.(groupIndex)}
                  {Array.from({ length: renderedCount }, (_, index) => (
                    <React.Fragment key={start + index}>
                      {props.itemContent?.(start + index, groupIndex)}
                    </React.Fragment>
                  ))}
                </div>
              );
            })}
          </div>
        );
      },
    ),
  };
});

const makeResults = (): BookSearchResult[] =>
  ['Chapter One', 'Chapter Two'].map((label, chapter) => ({
    label,
    subitems: [0, 1].map((match) => ({
      cfi: `epubcfi(/6/${chapter + 2}!/4/${match + 1})`,
      excerpt: { pre: 'pre ', match: 'hit', post: ' post' },
    })),
  }));

const renderResults = (results = makeResults()) =>
  render(<SearchResults bookKey='book-1' results={results} onSelectResult={vi.fn()} />);

const resultItems = () => screen.getAllByRole('button').filter((el) => el.tagName === 'LI');

describe('SearchResults chapter sections', () => {
  afterEach(() => {
    cleanup();
    navState.searchProgress = 1;
    virtuosoState.renderLimit = Number.POSITIVE_INFINITY;
    virtuosoState.groupCounts = [];
    virtuosoState.initialTopMostItemIndex = undefined;
    virtuosoState.scrollToIndex = [];
    cfiState.locationChecks = 0;
    cfiState.nearestCfi = null;
  });

  it('collapses and expands a chapter section when its header is toggled', () => {
    renderResults();
    expect(resultItems()).toHaveLength(4);

    const header = screen.getByRole('button', { name: /Chapter One/ });
    fireEvent.click(header);
    expect(resultItems()).toHaveLength(2);
    expect(header.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(header);
    expect(resultItems()).toHaveLength(4);
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  // A new search resets searchProgress to 0 but leaves the previous results
  // mounted until the first hit arrives. Sections are keyed by index+label, so
  // without an explicit reset the reused key kept the section collapsed for
  // results the reader had never seen.
  it('expands every section again when a new search starts', () => {
    const { rerender } = renderResults();
    fireEvent.click(screen.getByRole('button', { name: /Chapter One/ }));
    expect(resultItems()).toHaveLength(2);

    navState.searchProgress = 0;
    rerender(<SearchResults bookKey='book-1' results={makeResults()} onSelectResult={vi.fn()} />);

    expect(resultItems()).toHaveLength(4);
    const header = screen.getByRole('button', { name: /Chapter One/ });
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it('styles the chapter header for RTL and e-ink', () => {
    renderResults();
    const header = screen.getByRole('button', { name: /Chapter One/ });

    // DESIGN.md 2.8: logical properties only, the sidebar flips direction for RTL books.
    expect(header.innerHTML).not.toMatch(/\bml-2\b/);
    expect(header.innerHTML).toMatch(/\bms-2\b/);
    // The sidebar itself is bg-base-100 under e-ink, so a bare bg-base-200 header
    // would render as a grey band there.
    const sticky = header.closest('h3')!;
    expect(sticky.className).toContain('eink:bg-base-100');
    expect(sticky.className).toContain('not-eink:bg-base-200');
  });

  it('opens at the match nearest the reading position instead of the first chapter', () => {
    const results = makeResults();
    const nearest = results[1]!.subitems[1]!;
    cfiState.nearestCfi = nearest.cfi;

    renderResults(results);

    // Four matches precede/grouped as [chapter 1: 2, chapter 2: 2]; the
    // nearest match is the fourth item (flat index 3).
    expect(virtuosoState.initialTopMostItemIndex).toEqual({ index: 3, align: 'center' });
  });

  it('scrolls to the nearest match when a repeated search publishes its final results', () => {
    const results = makeResults();
    navState.searchProgress = 0;
    const { rerender } = renderResults(results);

    const finalResults = makeResults();
    navState.searchProgress = 1;
    cfiState.nearestCfi = finalResults[1]!.subitems[1]!.cfi;
    rerender(<SearchResults bookKey='book-1' results={finalResults} onSelectResult={vi.fn()} />);

    expect(virtuosoState.scrollToIndex).toContainEqual({
      index: 3,
      align: 'center',
      behavior: 'smooth',
    });
  });

  it('renders and location-checks only viewport rows after 4500 results arrive', () => {
    virtuosoState.renderLimit = 10;
    const results: BookSearchResult[] = Array.from({ length: 90 }, (_, chapter) => ({
      index: chapter,
      label: `Chapter ${chapter}`,
      subitems: Array.from({ length: 50 }, (_, match) => ({
        cfi: `epubcfi(/6/${(chapter + 1) * 2}!/4/${match + 2}:0)`,
        excerpt: { pre: 'before ', match: 'name', post: ' after' },
      })),
    }));

    renderResults(results);

    expect(resultItems()).toHaveLength(10);
    expect(virtuosoState.groupCounts.reduce((sum, count) => sum + count, 0)).toBe(4500);
    // The old full list checked all 4500 rows; a ten-row viewport checks ten.
    expect(cfiState.locationChecks).toBe(10);
  });
});
