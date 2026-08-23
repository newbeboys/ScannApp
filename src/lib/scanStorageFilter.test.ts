import { beforeEach, describe, expect, it, vi } from 'vitest'

const fs = {
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => ({ data: '[]' })),
  rmdir: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}),
  getUri: vi.fn(async () => ({ uri: 'file:///data/x' })),
}

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: fs,
  Directory: { Data: 'DATA', Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, convertFileSrc: (p: string) => p },
}))

vi.mock('./blobBase64', () => ({
  blobToBase64: async (blob: Blob) => `base64:${await blob.text()}`,
  base64ToBlob: (data: string) => new Blob([data]),
}))

const { applyDocumentFilter, applyPageFilter, reorderPages, savePageEdit } = await import(
  './scanStorage'
)

const DOC_ID = 'doc-1'

/**
 * Stands in for the canvas render. Records what it was asked to filter so the
 * tests can assert *which* file the render started from — the whole point of
 * keeping geometry and colour separate.
 */
const renders: { source: string; filter: string }[] = []
const render = async (source: Blob, filter: string): Promise<Blob> => {
  renders.push({ source: await source.text(), filter })
  return new Blob([`${filter}-of-${await source.text()}`])
}

/**
 * Puts one document in the index.
 *
 * Reading a page returns its own path as the blob's contents, which is what
 * lets the render spy report *which* file a filter was derived from.
 */
function seed(pages: Record<string, unknown>[], filter?: string) {
  const index = JSON.stringify([
    {
      schemaVersion: 3,
      id: DOC_ID,
      title: 'Kontrak',
      createdAt: '2026-08-23T00:00:00.000Z',
      pageCount: pages.length,
      ...(filter ? { filter } : {}),
      pages,
    },
  ])

  fs.readFile.mockImplementation(async ({ path }: { path: string }) =>
    path === 'scans/index.json' ? { data: index } : { data: path },
  )
}

/** The index as it was last written back to disk. */
function writtenIndex() {
  const call = fs.writeFile.mock.calls.filter((c) => c[0].path === 'scans/index.json').at(-1)
  return JSON.parse(call![0].data)
}

beforeEach(() => {
  for (const fn of Object.values(fs)) fn.mockClear()
  renders.length = 0
  // readPageBlob on web reads base64 and wraps it; the mock above makes the
  // blob's text equal to whatever path was requested.
  fs.readFile.mockImplementation(async ({ path }: { path: string }) =>
    path === 'scans/index.json' ? { data: '[]' } : { data: path },
  )
})

describe('applyDocumentFilter', () => {
  it('applies a filter to every page at once', async () => {
    seed([{ original: 'a.jpg' }, { original: 'b.jpg' }])

    const doc = await applyDocumentFilter(DOC_ID, 'bw', render)

    expect(doc.filter).toBe('bw')
    expect(doc.pages.map((p) => p.filtered)).toEqual(['a-filtered.jpg', 'b-filtered.jpg'])
  })

  /**
   * The core of design decision 2.2. A filter is derived from the geometry
   * chain, so a page that was already cropped is filtered from the crop's
   * result — not from the raw scan (the crop would be lost) and not from a
   * previous filter render (filters would stack).
   */
  it('derives the filter from the cropped result, not from the raw scan', async () => {
    seed([{ original: 'a.jpg', edited: 'a-edited.jpg' }])

    await applyDocumentFilter(DOC_ID, 'magic', render)

    expect(renders).toEqual([{ source: 'a-edited.jpg', filter: 'magic' }])
  })

  it('swaps a filter without stacking it on top of the old one', async () => {
    seed([{ original: 'a.jpg', edited: 'a-edited.jpg', filtered: 'a-filtered.jpg' }], 'bw')

    await applyDocumentFilter(DOC_ID, 'grayscale', render)

    // The source stays the geometry chain, not a-filtered.jpg.
    expect(renders).toEqual([{ source: 'a-edited.jpg', filter: 'grayscale' }])
  })

  it('clears the filter and deletes the file it rendered', async () => {
    seed([{ original: 'a.jpg', filtered: 'a-filtered.jpg' }], 'bw')

    const doc = await applyDocumentFilter(DOC_ID, null, render)

    expect(doc.filter).toBeUndefined()
    expect(doc.pages[0].filtered).toBeUndefined()
    expect(fs.deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'a-filtered.jpg' }),
    )
    expect(renders).toEqual([])
  })

  /** The mixed-document case: a page with its own exception must not be swept along. */
  it('leaves a page with its own exception untouched', async () => {
    seed([{ original: 'a.jpg' }, { original: 'b.jpg', filter: 'none' }])

    await applyDocumentFilter(DOC_ID, 'bw', render)

    expect(renders).toEqual([{ source: 'a.jpg', filter: 'bw' }])
  })

  it('writes the index once, not once per page', async () => {
    seed([{ original: 'a.jpg' }, { original: 'b.jpg' }, { original: 'c.jpg' }])

    await applyDocumentFilter(DOC_ID, 'bw', render)

    const indexWrites = fs.writeFile.mock.calls.filter((c) => c[0].path === 'scans/index.json')
    expect(indexWrites).toHaveLength(1)
  })

  it('reports progress so a long document does not feel stuck', async () => {
    seed([{ original: 'a.jpg' }, { original: 'b.jpg' }])
    const progress: [number, number][] = []

    await applyDocumentFilter(DOC_ID, 'bw', render, (done, total) => progress.push([done, total]))

    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ])
  })
})

describe('applyPageFilter', () => {
  it("gives one page a filter different from the document's", async () => {
    seed([{ original: 'a.jpg' }, { original: 'b.jpg' }], 'bw')

    const doc = await applyPageFilter(DOC_ID, 1, 'magic', render)

    expect(doc.pages[1].filter).toBe('magic')
    expect(renders).toEqual([{ source: 'b.jpg', filter: 'magic' }])
  })

  it("excludes one page via 'none' without touching the others", async () => {
    seed([{ original: 'a.jpg', filtered: 'a-f.jpg' }, { original: 'b.jpg', filtered: 'b-f.jpg' }], 'bw')

    const doc = await applyPageFilter(DOC_ID, 1, 'none', render)

    expect(doc.pages[1].filtered).toBeUndefined()
    expect(doc.pages[0].filtered).toBe('a-f.jpg')
  })

  it("puts a page back under the document's filter", async () => {
    seed([{ original: 'a.jpg', filter: 'none' }], 'bw')

    const doc = await applyPageFilter(DOC_ID, 0, null, render)

    expect(doc.pages[0].filter).toBeUndefined()
    expect(renders).toEqual([{ source: 'a.jpg', filter: 'bw' }])
  })
})

describe('reorderPages', () => {
  it('moves a page to a new position', async () => {
    seed([{ original: 'a.jpg' }, { original: 'b.jpg' }, { original: 'c.jpg' }])

    const doc = await reorderPages(DOC_ID, 2, 0)

    expect(doc.pages.map((p) => p.original)).toEqual(['c.jpg', 'a.jpg', 'b.jpg'])
  })

  it('shifts by one step without scrambling the rest', async () => {
    seed([{ original: 'a.jpg' }, { original: 'b.jpg' }, { original: 'c.jpg' }])

    const doc = await reorderPages(DOC_ID, 1, 2)

    expect(doc.pages.map((p) => p.original)).toEqual(['a.jpg', 'c.jpg', 'b.jpg'])
  })

  /** The step buttons at the first/last page must not break anything. */
  it('ignores a move past either end', async () => {
    seed([{ original: 'a.jpg' }, { original: 'b.jpg' }])

    expect((await reorderPages(DOC_ID, 0, -1)).pages.map((p) => p.original)).toEqual([
      'a.jpg',
      'b.jpg',
    ])
    expect((await reorderPages(DOC_ID, 1, 2)).pages.map((p) => p.original)).toEqual([
      'a.jpg',
      'b.jpg',
    ])
  })

  it('rewrites no page file at all — only the order changes', async () => {
    seed([{ original: 'a.jpg' }, { original: 'b.jpg' }])

    await reorderPages(DOC_ID, 0, 1)

    const pageWrites = fs.writeFile.mock.calls.filter((c) => c[0].path !== 'scans/index.json')
    expect(pageWrites).toHaveLength(0)
  })

  it('carries a moved page\'s edit & filter along with it', async () => {
    seed([
      { original: 'a.jpg' },
      { original: 'b.jpg', edited: 'b-edited.jpg', filtered: 'b-filtered.jpg' },
    ])

    await reorderPages(DOC_ID, 1, 0)

    expect(writtenIndex()[0].pages[0]).toEqual({
      original: 'b.jpg',
      edited: 'b-edited.jpg',
      filtered: 'b-filtered.jpg',
    })
  })

  /**
   * The bug this guards against: `edited`/`filtered` file names used to be
   * derived from a page's *array index*, which reorderPages changes without
   * renaming anything on disk. After a's page-1 slot is taken over by b (as
   * it would be once a moved to index 1), cropping b — now at index 0 — must
   * not reuse a's already-saved edit file. Names are derived from `original`,
   * which never changes, so this stays safe regardless of where a page sits.
   */
  it("does not let a moved page's edit collide with another page's saved file", async () => {
    // As if a reorder had just put b (originally page-2.jpg) at index 0, and
    // a (originally page-1.jpg) — already cropped — at index 1. Both use the
    // real production naming (scans/<id>/page-N.jpg) so the derived paths
    // below are exactly what the app would produce.
    seed([
      { original: 'scans/doc-1/page-2.jpg' },
      { original: 'scans/doc-1/page-1.jpg', edited: 'scans/doc-1/page-1-edited.jpg' },
    ])

    const doc = await savePageEdit(DOC_ID, 0, new Blob(['b-cropped']))

    // The old, index-based scheme derived a page's edit path from whatever
    // slot it sat in — 'page-1-edited.jpg' for index 0 regardless of which
    // page that was, exactly the file a's edit already lives in. Deriving
    // from `original` instead avoids the collision.
    expect(doc.pages[0].edited).not.toBe('scans/doc-1/page-1-edited.jpg')
    expect(doc.pages[0].edited).toBe('scans/doc-1/page-2-edited.jpg')
    // a's own edit file is untouched.
    expect(doc.pages[1].edited).toBe('scans/doc-1/page-1-edited.jpg')
  })
})
