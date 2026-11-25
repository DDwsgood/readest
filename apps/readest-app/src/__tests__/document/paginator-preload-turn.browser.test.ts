import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { Renderer } from '@/types/view';

// A page turn past a section's end waits for the background preload, which
// may load several more sections meanwhile. The turn must still enter the
// section right after the one it left, not the one after the new last view.
// And a preload whose view is dropped before its iframe loads must still end,
// or every later turn and preload waits on it for good.

type Paginator = Renderer & { primaryIndex: number };
type Section = { id: string; linear: string; size: number; load: () => Promise<string> };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const makeSection = (i: number, load?: (src: string) => Promise<string>): Section => {
  const html = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><style>p { font: 16px/1.5 serif; margin: 0 0 1em; }</style></head>
<body><h2>Chapter ${i}</h2><p>Text of chapter ${i}.</p></body></html>`;
  const src = URL.createObjectURL(new Blob([html], { type: 'application/xhtml+xml' }));
  return {
    id: `c${i}`,
    linear: 'yes',
    size: html.length,
    load: load ? () => load(src) : async () => src,
  };
};

describe('Paginator page turn during a preload', () => {
  let paginator: Paginator;

  beforeAll(async () => {
    await import('foliate-js/paginator.js');
  }, 30000);

  const open = async (sections: Section[]) => {
    paginator = document.createElement('foliate-paginator') as unknown as Paginator;
    // One page a spread: a section that fits a page is exactly one page.
    (paginator as unknown as HTMLElement).setAttribute('max-column-count', '1');
    Object.assign((paginator as unknown as HTMLElement).style, {
      width: '800px',
      height: '600px',
      position: 'absolute',
      left: '0',
      top: '0',
    });
    document.body.appendChild(paginator as unknown as HTMLElement);
    paginator.open({ dir: 'ltr', sections } as unknown as Parameters<Renderer['open']>[0]);
    await paginator.goTo({ index: 0, anchor: 0 });
  };

  const loadedIndices = () => paginator.getContents().map((c) => c.index);

  afterEach(() => {
    paginator?.destroy();
    (paginator as unknown as HTMLElement)?.remove();
  });

  it('enters the next section when the preload loads past it meanwhile', async () => {
    // Every section fits one page, so opening starts preloading several of
    // them; the first is slow, so the turn below waits for the whole run.
    const sections = Array.from({ length: 12 }, (_, i) =>
      makeSection(i, i === 1 ? (src) => wait(300).then(() => src) : undefined),
    );
    await open(sections);
    await paginator.next();
    expect(loadedIndices().length).toBeGreaterThan(2);
    expect(paginator.primaryIndex).toBe(1);
    expect(paginator.getPageTurnKey?.()).toBe('1:0');
    await paginator.next();
    expect(paginator.getPageTurnKey?.()).toBe('2:0');
  }, 10000);

  it('keeps preloading after a section is dropped while it loads', async () => {
    let jumped = false;
    const sections = Array.from({ length: 30 }, (_, i) =>
      makeSection(i, async (src) => {
        // Navigate away right after the preload has created this view and
        // before its iframe loads: the navigation drops the view.
        if (i === 1 && !jumped) {
          jumped = true;
          setTimeout(() => paginator.goTo({ index: 20, anchor: 0 }), 0);
        }
        return src;
      }),
    );
    await open(sections);
    await expect.poll(() => paginator.primaryIndex, { timeout: 2000 }).toBe(20);
    await expect.poll(() => loadedIndices().includes(21), { timeout: 3000 }).toBe(true);
    await paginator.next();
    await paginator.next();
    expect(paginator.primaryIndex).toBeGreaterThan(20);
  }, 10000);
});
