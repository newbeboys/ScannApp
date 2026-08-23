import { beforeEach, describe, expect, it, vi } from 'vitest'

const imageEditor = {
  cropImage: vi.fn(async () => new Blob(['cropped'])),
  rotateImage: vi.fn(async () => new Blob(['rotated'])),
  filterImage: vi.fn(async () => new Blob(['filtered'])),
}
vi.mock('./imageEditor', () => imageEditor)

/**
 * `effectiveFilter`, `filterSource`, and `resolvePage` are real, tiny, pure
 * functions — already covered by scanIndexMigration.test.ts — reimplemented
 * here rather than imported so this file stays free of Capacitor, which the
 * real scanStorage.ts pulls in at the top of the module.
 */
const scanStorage = {
  applyDocumentFilter: vi.fn(),
  applyPageFilter: vi.fn(),
  resetPageEdit: vi.fn(),
  savePageEdit: vi.fn(),
  invalidateDisplayUri: vi.fn(),
  readPageBlob: vi.fn(async () => new Blob(['source'])),
  reorderPages: vi.fn(),
  effectiveFilter: (doc: { filter?: string }, page: { filter?: string }) => {
    if (page.filter === 'none') return null
    if (page.filter) return page.filter
    return doc.filter ?? null
  },
  filterSource: (page: { edited?: string; original: string }) => page.edited ?? page.original,
  resolvePage: (page: { filtered?: string; edited?: string; original: string }) =>
    page.filtered ?? page.edited ?? page.original,
}
vi.mock('./scanStorage', () => scanStorage)

const { cropPage, movePage, revertPage, rotatePage, setDocumentFilter, setPageFilter } =
  await import('./documentEditing')

const RECT = { x: 0, y: 0, width: 1, height: 1 }

beforeEach(() => {
  for (const fn of Object.values(imageEditor)) fn.mockClear()
  for (const fn of Object.values(scanStorage)) {
    if (typeof fn === 'function' && 'mockClear' in fn) fn.mockClear()
  }
})

describe('cropPage / rotatePage — re-rendering the filter after a geometry edit', () => {
  it('re-renders the document filter after cropping', async () => {
    const doc = { id: 'd', filter: 'bw', pages: [{ original: 'a.jpg' }] }
    scanStorage.savePageEdit.mockResolvedValue({
      ...doc,
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg' }],
    })
    scanStorage.applyPageFilter.mockResolvedValue({
      ...doc,
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg', filtered: 'a-filtered.jpg' }],
    })

    await cropPage(doc, 0, RECT)

    expect(scanStorage.applyPageFilter).toHaveBeenCalledWith('d', 0, null, imageEditor.filterImage)
  })

  /** A page's own exception must survive a crop, and win over the document filter. */
  it("re-renders a page's own filter exception, not the document filter", async () => {
    const doc = { id: 'd', filter: 'bw', pages: [{ original: 'a.jpg', filter: 'magic' }] }
    scanStorage.savePageEdit.mockResolvedValue({
      ...doc,
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg', filter: 'magic' }],
    })
    scanStorage.applyPageFilter.mockResolvedValue(doc)

    await rotatePage(doc, 0)

    expect(scanStorage.applyPageFilter).toHaveBeenCalledWith(
      'd',
      0,
      'magic',
      imageEditor.filterImage,
    )
  })

  it('skips the re-render entirely when no filter is active', async () => {
    const doc = { id: 'd', pages: [{ original: 'a.jpg' }] }
    scanStorage.savePageEdit.mockResolvedValue({
      ...doc,
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg' }],
    })

    const result = await cropPage(doc, 0, RECT)

    expect(scanStorage.applyPageFilter).not.toHaveBeenCalled()
    expect(result.pages[0].edited).toBe('a-edited.jpg')
  })

  it('reads from the geometry chain, not from a filtered render, so a filter never gets baked in', async () => {
    const doc = {
      id: 'd',
      filter: 'bw',
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg', filtered: 'a-filtered.jpg' }],
    }
    scanStorage.savePageEdit.mockResolvedValue(doc)
    scanStorage.applyPageFilter.mockResolvedValue(doc)

    await cropPage(doc, 0, RECT)

    expect(scanStorage.readPageBlob).toHaveBeenCalledWith('a-edited.jpg')
  })
})

describe('revertPage', () => {
  /**
   * The bug this guards against: resetPageEdit deletes the filter render
   * (it was made from the geometry that just got thrown away) but has no
   * canvas to re-render one with. Without documentEditing re-rendering it,
   * effectiveFilter() would keep saying the page is filtered while
   * resolvePage() quietly started showing the plain scan again.
   */
  it('re-renders the document filter after undoing a crop', async () => {
    const doc = { id: 'd', filter: 'bw', pages: [{ original: 'a.jpg', edited: 'a-edited.jpg' }] }
    scanStorage.resetPageEdit.mockResolvedValue({ ...doc, pages: [{ original: 'a.jpg' }] })
    scanStorage.applyPageFilter.mockResolvedValue(doc)

    await revertPage(doc, 0)

    expect(scanStorage.resetPageEdit).toHaveBeenCalledWith('d', 0)
    expect(scanStorage.applyPageFilter).toHaveBeenCalledWith('d', 0, null, imageEditor.filterImage)
  })

  /** "Asli" undoes geometry, not the user's mind about colour — the exception must survive. */
  it("keeps a page's own filter exception across a revert", async () => {
    const doc = {
      id: 'd',
      filter: 'bw',
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg', filter: 'magic' }],
    }
    scanStorage.resetPageEdit.mockResolvedValue({
      ...doc,
      pages: [{ original: 'a.jpg', filter: 'magic' }],
    })
    scanStorage.applyPageFilter.mockResolvedValue(doc)

    await revertPage(doc, 0)

    expect(scanStorage.applyPageFilter).toHaveBeenCalledWith(
      'd',
      0,
      'magic',
      imageEditor.filterImage,
    )
  })

  it('does not re-render when no filter is active at all', async () => {
    const doc = { id: 'd', pages: [{ original: 'a.jpg', edited: 'a-edited.jpg' }] }
    scanStorage.resetPageEdit.mockResolvedValue({ ...doc, pages: [{ original: 'a.jpg' }] })

    const result = await revertPage(doc, 0)

    expect(scanStorage.applyPageFilter).not.toHaveBeenCalled()
    expect(result.pages[0]).toEqual({ original: 'a.jpg' })
  })

  it('does nothing when the page was never edited', async () => {
    const doc = { id: 'd', filter: 'bw', pages: [{ original: 'a.jpg' }] }

    const result = await revertPage(doc, 0)

    expect(scanStorage.resetPageEdit).not.toHaveBeenCalled()
    expect(scanStorage.applyPageFilter).not.toHaveBeenCalled()
    expect(result).toBe(doc)
  })
})

/**
 * Reorder and filters are available to every tier (keputusan Boss Ali 23
 * Agustus 2026, menggantikan PRD Bagian 3's original "Pro-exclusive" —
 * see PRD's changelog note). No tier is passed in or checked here at all.
 */
describe('available to every tier', () => {
  const doc = { id: 'd', pages: [{ original: 'a.jpg' }, { original: 'b.jpg' }] }

  it('sets a document filter without asking about tier', async () => {
    scanStorage.applyDocumentFilter.mockResolvedValue(doc)

    await expect(setDocumentFilter(doc, 'bw')).resolves.toBe(doc)
  })

  it('sets a page filter exception without asking about tier', async () => {
    scanStorage.applyPageFilter.mockResolvedValue(doc)

    await expect(setPageFilter(doc, 0, 'bw')).resolves.toBe(doc)
  })

  it('reorders pages without asking about tier', async () => {
    scanStorage.reorderPages.mockResolvedValue(doc)

    await expect(movePage(doc, 0, 1)).resolves.toBe(doc)
  })
})
