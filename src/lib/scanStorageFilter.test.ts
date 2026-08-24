import { beforeEach, describe, expect, it, vi } from 'vitest'

const fs = {
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => ({ data: '[]' })),
  rmdir: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}),
  getUri: vi.fn(async () => ({ uri: 'file:///data/x' })),
  readdir: vi.fn(async () => ({ files: [] })),
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

const {
  applyDocumentFilter,
  applyPageDerived,
  applyPageFilter,
  resetPageEdit,
  reorderPages,
  savePageEdit,
  pruneUnusedSignatures,
  savePageMarks,
  saveSignatureImage,
} = await import(
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
 * Stands in for the ink renderer. Records the marks it was asked to draw and
 * which file it was asked to draw them onto — the pair that proves ink is
 * always composited onto the filter render rather than onto its own last one.
 */
const markRenders: { source: string; marks: unknown[] }[] = []
const markRender = async (source: Blob, marks: unknown[]): Promise<Blob> => {
  const text = await source.text()
  markRenders.push({ source: text, marks })
  return new Blob([`ink-on-${text}`])
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
      schemaVersion: 4,
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
  markRenders.length = 0
  // readPageBlob on web reads base64 and wraps it; the mock above makes the
  // blob's text equal to whatever path was requested.
  fs.readFile.mockImplementation(async ({ path }: { path: string }) =>
    path === 'scans/index.json' ? { data: '[]' } : { data: path },
  )
})

describe('applyDocumentFilter', () => {
  it('applies a filter to every page at once', async () => {
    seed([{ original: 'a.jpg' }, { original: 'b.jpg' }])

    const doc = await applyDocumentFilter(DOC_ID, 'bw', render, markRender)

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

    await applyDocumentFilter(DOC_ID, 'magic', render, markRender)

    expect(renders).toEqual([{ source: 'a-edited.jpg', filter: 'magic' }])
  })

  it('swaps a filter without stacking it on top of the old one', async () => {
    seed([{ original: 'a.jpg', edited: 'a-edited.jpg', filtered: 'a-filtered.jpg' }], 'bw')

    await applyDocumentFilter(DOC_ID, 'grayscale', render, markRender)

    // The source stays the geometry chain, not a-filtered.jpg.
    expect(renders).toEqual([{ source: 'a-edited.jpg', filter: 'grayscale' }])
  })

  it('clears the filter and deletes the file it rendered', async () => {
    seed([{ original: 'a.jpg', filtered: 'a-filtered.jpg' }], 'bw')

    const doc = await applyDocumentFilter(DOC_ID, null, render, markRender)

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

    await applyDocumentFilter(DOC_ID, 'bw', render, markRender)

    expect(renders).toEqual([{ source: 'a.jpg', filter: 'bw' }])
  })

  it('writes the index once, not once per page', async () => {
    seed([{ original: 'a.jpg' }, { original: 'b.jpg' }, { original: 'c.jpg' }])

    await applyDocumentFilter(DOC_ID, 'bw', render, markRender)

    const indexWrites = fs.writeFile.mock.calls.filter((c) => c[0].path === 'scans/index.json')
    expect(indexWrites).toHaveLength(1)
  })

  it('reports progress so a long document does not feel stuck', async () => {
    seed([{ original: 'a.jpg' }, { original: 'b.jpg' }])
    const progress: [number, number][] = []

    await applyDocumentFilter(DOC_ID, 'bw', render, markRender, (done, total) => progress.push([done, total]))

    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ])
  })
})

describe('applyPageFilter', () => {
  it("gives one page a filter different from the document's", async () => {
    seed([{ original: 'a.jpg' }, { original: 'b.jpg' }], 'bw')

    const doc = await applyPageFilter(DOC_ID, 1, 'magic', render, markRender)

    expect(doc.pages[1].filter).toBe('magic')
    expect(renders).toEqual([{ source: 'b.jpg', filter: 'magic' }])
  })

  it("excludes one page via 'none' without touching the others", async () => {
    seed([{ original: 'a.jpg', filtered: 'a-f.jpg' }, { original: 'b.jpg', filtered: 'b-f.jpg' }], 'bw')

    const doc = await applyPageFilter(DOC_ID, 1, 'none', render, markRender)

    expect(doc.pages[1].filtered).toBeUndefined()
    expect(doc.pages[0].filtered).toBe('a-f.jpg')
  })

  it("puts a page back under the document's filter", async () => {
    seed([{ original: 'a.jpg', filter: 'none' }], 'bw')

    const doc = await applyPageFilter(DOC_ID, 0, null, render, markRender)

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

describe('savePageMarks', () => {
  const INK = [{ kind: 'ink', tool: 'pen', color: '#1b2740', width: 0.004, points: [0, 0, 1, 1] }]

  it('renders the ink and points the page at the result', async () => {
    seed([{ original: 'scans/doc-1/page-1.jpg' }])

    const doc = await savePageMarks(DOC_ID, 0, INK, markRender)

    expect(doc.pages[0].annotated).toBe('scans/doc-1/page-1-annotated.jpg')
    expect(doc.pages[0].marks).toEqual(INK)
  })

  /**
   * The core of design decision 2.1. Ink is composited onto the filter render,
   * so a black-and-white page keeps its blue signature blue — and the filter
   * can still be swapped afterwards without the ink going with it.
   */
  it('draws the ink onto the filter render, not onto the raw scan', async () => {
    seed([{ original: 'a.jpg', edited: 'a-edited.jpg', filtered: 'a-filtered.jpg' }], 'bw')

    await savePageMarks(DOC_ID, 0, INK, markRender)

    expect(markRenders.map((entry) => entry.source)).toEqual(['a-filtered.jpg'])
  })

  /**
   * The trap this locks out: reading the previous annotated file back would
   * lay every stroke over itself a second time, and removing one would never
   * remove anything.
   */
  it('never draws onto its own previous render', async () => {
    seed([{ original: 'a.jpg', annotated: 'a-annotated.jpg', marks: INK }])

    await savePageMarks(DOC_ID, 0, INK, markRender)

    expect(markRenders.map((entry) => entry.source)).toEqual(['a.jpg'])
  })

  it('clears the ink and deletes the file it rendered', async () => {
    seed([{ original: 'a.jpg', annotated: 'a-annotated.jpg', marks: INK }])

    const doc = await savePageMarks(DOC_ID, 0, [], markRender)

    expect(doc.pages[0].annotated).toBeUndefined()
    expect(doc.pages[0].marks).toBeUndefined()
    expect(fs.deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'a-annotated.jpg' }),
    )
    expect(markRenders).toEqual([])
  })

  it('derives the ink path from `original`, so a reorder cannot make two pages collide', async () => {
    // Same reasoning as the edit/filter paths: page files are never renamed
    // when pages move, so a path keyed on the array index would collide.
    seed([{ original: 'scans/doc-1/page-2.jpg' }, { original: 'scans/doc-1/page-1.jpg' }])

    const doc = await savePageMarks(DOC_ID, 0, INK, markRender)

    expect(doc.pages[0].annotated).toBe('scans/doc-1/page-2-annotated.jpg')
  })

  it('refuses a page that does not exist', async () => {
    seed([{ original: 'a.jpg' }])

    await expect(savePageMarks(DOC_ID, 7, INK, markRender)).rejects.toThrow(
      'Halaman tidak ditemukan.',
    )
  })
})

describe('marks through a geometry edit', () => {
  const INK = [{ kind: 'ink', tool: 'pen', color: '#1b2740', width: 0.004, points: [0, 0, 1, 1] }]

  /**
   * "Asli" undoes a crop. It is not a request to tear up a signature, so the
   * marks survive — the caller re-renders them onto the restored page.
   */
  it('keeps the marks when a crop is reverted', async () => {
    seed([
      {
        original: 'a.jpg',
        edited: 'a-edited.jpg',
        annotated: 'a-annotated.jpg',
        marks: INK,
      },
    ])

    const doc = await resetPageEdit(DOC_ID, 0)

    expect(doc.pages[0].marks).toEqual(INK)
    // The render itself is gone: it was made from geometry that no longer exists.
    expect(doc.pages[0].annotated).toBeUndefined()
    expect(fs.deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'a-annotated.jpg' }),
    )
  })

  it('keeps the marks but drops the stale render when a page is cropped again', async () => {
    seed([{ original: 'a.jpg', annotated: 'a-annotated.jpg', marks: INK }])

    const doc = await savePageEdit(DOC_ID, 0, new Blob(['cropped']))

    expect(doc.pages[0].marks).toEqual(INK)
    expect(doc.pages[0].annotated).toBeUndefined()
  })
})

describe('applyDocumentFilter with annotated pages', () => {
  const INK = [{ kind: 'ink', tool: 'pen', color: '#1b2740', width: 0.004, points: [0, 0, 1, 1] }]

  /**
   * Changing the filter re-derives the page underneath the ink, so the ink has
   * to be laid on again — in the same pass, or the document would be walked
   * twice and the index written twice.
   */
  it('re-renders the ink onto the new filter, still writing the index once', async () => {
    seed([{ original: 'a.jpg', annotated: 'a-annotated.jpg', marks: INK }, { original: 'b.jpg' }])

    const doc = await applyDocumentFilter(DOC_ID, 'bw', render, markRender)

    expect(markRenders.map((entry) => entry.source)).toEqual(['a-filtered.jpg'])
    expect(doc.pages[0].annotated).toBe('a-annotated.jpg')
    expect(fs.writeFile.mock.calls.filter((c) => c[0].path === 'scans/index.json')).toHaveLength(1)
  })

  it('leaves a page with no marks with no annotated file', async () => {
    seed([{ original: 'a.jpg' }])

    const doc = await applyDocumentFilter(DOC_ID, 'bw', render, markRender)

    expect(doc.pages[0].annotated).toBeUndefined()
    expect(markRenders).toEqual([])
  })
})

describe('saveSignatureImage', () => {
  it('writes a PNG under a timestamped name, so redrawing cannot rewrite history', async () => {
    const path = await saveSignatureImage(new Blob(['png-bytes']))

    expect(path).toMatch(/^scans\/signature-\d+\.png$/)
    expect(fs.writeFile).toHaveBeenCalledWith(expect.objectContaining({ path }))
  })
})

describe('applyPageDerived', () => {
  const INK = [{ kind: 'ink', tool: 'pen', color: '#1b2740', width: 0.004, points: [0, 0, 1, 1] }]

  /**
   * The pass that runs after a crop, when the filter render and the ink render
   * are both gone and the marks have moved with the geometry. Doing it as two
   * steps would draw the ink twice — once at the coordinates the crop just
   * invalidated.
   */
  it('rebuilds the filter and then the ink, in that order, from one index read', async () => {
    seed([{ original: 'a.jpg', edited: 'a-edited.jpg' }], 'bw')

    const doc = await applyPageDerived(DOC_ID, 0, INK, render, markRender)

    expect(renders).toEqual([{ source: 'a-edited.jpg', filter: 'bw' }])
    // The ink lands on the filter render, not on the geometry underneath it.
    expect(markRenders.map((entry) => entry.source)).toEqual(['a-filtered.jpg'])
    expect(doc.pages[0].annotated).toBe('a-annotated.jpg')
    expect(fs.writeFile.mock.calls.filter((c) => c[0].path === 'scans/index.json')).toHaveLength(1)
  })

  it("honours the page's own filter exception over the document's", async () => {
    seed([{ original: 'a.jpg', filter: 'magic' }], 'bw')

    await applyPageDerived(DOC_ID, 0, [], render, markRender)

    expect(renders).toEqual([{ source: 'a.jpg', filter: 'magic' }])
  })

  it('clears the ink when the crop left no marks behind', async () => {
    seed([{ original: 'a.jpg', annotated: 'a-annotated.jpg', marks: INK }])

    const doc = await applyPageDerived(DOC_ID, 0, [], render, markRender)

    expect(doc.pages[0].marks).toBeUndefined()
    expect(doc.pages[0].annotated).toBeUndefined()
    expect(fs.deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'a-annotated.jpg' }),
    )
  })

  it('refuses a page that does not exist', async () => {
    seed([{ original: 'a.jpg' }])

    await expect(applyPageDerived(DOC_ID, 4, [], render, markRender)).rejects.toThrow(
      'Halaman tidak ditemukan.',
    )
  })
})

describe('pruneUnusedSignatures', () => {
  const stamp = (source: string) => ({
    kind: 'signature',
    source,
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.1,
  })

  function seedFiles(names: string[]) {
    fs.readdir.mockResolvedValue({ files: names.map((name) => ({ name })) })
  }

  it('deletes a signature nothing refers to any more', async () => {
    seed([{ original: 'a.jpg' }])
    seedFiles(['signature-111.png', 'index.json'])

    await pruneUnusedSignatures()

    expect(fs.deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'scans/signature-111.png' }),
    )
  })

  it('keeps a signature a document is still stamped with', async () => {
    seed([{ original: 'a.jpg', marks: [stamp('scans/signature-111.png')] }])
    seedFiles(['signature-111.png', 'signature-222.png'])

    await pruneUnusedSignatures()

    const deleted = fs.deleteFile.mock.calls.map((call) => call[0].path)
    expect(deleted).not.toContain('scans/signature-111.png')
    expect(deleted).toContain('scans/signature-222.png')
  })

  it('never touches anything that is not a signature file', async () => {
    seed([{ original: 'a.jpg' }])
    seedFiles(['index.json', 'doc-1', 'page-1.jpg', 'signature.png', 'signature-x.png'])

    await pruneUnusedSignatures()

    expect(fs.deleteFile).not.toHaveBeenCalled()
  })

  it('does nothing when the scans folder cannot be read', async () => {
    fs.readdir.mockRejectedValue(new Error('nope'))

    await expect(pruneUnusedSignatures()).resolves.toBeUndefined()
    expect(fs.deleteFile).not.toHaveBeenCalled()
  })
})
