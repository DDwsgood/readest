import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SearchResults from '@/app/reader/components/sidebar/SearchResults';
import type { BookSearchResult } from '@/types/book';
import '@/styles/globals.css';

const progress = vi.hoisted(() => ({
  location: 'epubcfi(/6/160!/4/51:0)',
}));

vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => progress,
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (selector: (state: { getView: () => null }) => unknown) =>
    selector({ getView: () => null }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    getSearchNavState: () => ({ searchProgress: 1, searchError: null }),
  }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

afterEach(cleanup);

describe('SearchResults real virtualized viewport', () => {
  it('mounts only visible rows and opens near the current reading position', async () => {
    const results: BookSearchResult[] = Array.from({ length: 90 }, (_, chapter) => ({
      index: chapter,
      label: `Chapter ${chapter}`,
      subitems: Array.from({ length: 50 }, (_, match) => ({
        cfi: `epubcfi(/6/${(chapter + 1) * 2}!/4/${match + 2}:0)`,
        excerpt: {
          pre: '',
          match: `match-${chapter}-${match}`,
          post: '',
        },
      })),
    }));

    render(
      <div style={{ display: 'flex', height: 600, width: 400 }}>
        <SearchResults bookKey='book-1' results={results} onSelectResult={() => {}} />
      </div>,
    );

    // The target is chapter 79, match 49 (flat result index 3999), not the
    // first chapter. This uses the real GroupedVirtuoso layout and scrolling.
    await waitFor(
      () => {
        expect(screen.getByText('match-79-49')).toBeTruthy();
        expect(document.querySelectorAll('li').length).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
    // Let the initial scroll and measurement pass settle; the target must not
    // be a transient row that disappears on the next virtualizer update.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByText('match-79-49')).toBeTruthy();
    expect(document.querySelectorAll('li').length).toBeLessThan(100);
    expect(screen.queryByText('match-0-0')).toBeNull();
  });
});
