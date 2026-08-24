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
  applyPageDerived: vi.fn(),
  applyPageFilter: vi.fn(),
  savePageMarks: vi.fn(),
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

const INK = {
  kind: 'ink',
  tool: 'pen',
  color: '#1b2740',
  width: 0.004,
  points: [0.5, 0.5, 1, 1],
}

beforeEach(() => {
  for (const fn of Object.values(imageEditor)) fn.mockClear()
  for (const fn of Object.values(scanStorage)) {
    if (typeof fn === 'function' && 'mockClear' in fn) fn.mockClear()
  }
})

describe('cropPage / rotatePage — rebuilding the derived files after a geometry edit', () => {
  /**
   * The bug this guards against: `savePageEdit` deletes both derived files —
   * they were made from geometry that has just been thrown away — but has no
   * canvas to rebuild them with. Without this step `effectiveFilter()` would
   * keep saying the page is filtered while `resolvePage()` quietly started
   * showing the plain scan again.
   */
  it('rebuilds the derived files after cropping', async () => {
    const doc = { id: 'd', filter: 'bw', pages: [{ original: 'a.jpg' }] }
    scanStorage.savePageEdit.mockResolvedValue({
      ...doc,
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg' }],
    })
    scanStorage.applyPageDerived.mockResolvedValue(doc)

    await cropPage(doc, 0, RECT)

    expect(scanStorage.applyPageDerived).toHaveBeenCalledWith(
      'd',
      0,
      [],
      imageEditor.filterImage,
      expect.any(Function),
    )
  })

  /**
   * One call, not "re-render the filter, then re-render the ink". The filter
   * pass renders the ink as well, so splitting it draws every stroke twice —
   * the first time at the coordinates the crop has just invalidated.
   */
  it('rebuilds both derived files in a single pass', async () => {
    const doc = { id: 'd', filter: 'bw', pages: [{ original: 'a.jpg', marks: [INK] }] }
    scanStorage.savePageEdit.mockResolvedValue({
      ...doc,
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg', marks: [INK] }],
    })
    scanStorage.applyPageDerived.mockResolvedValue(doc)

    await cropPage(doc, 0, RECT)

    expect(scanStorage.applyPageDerived).toHaveBeenCalledTimes(1)
    expect(scanStorage.applyPageFilter).not.toHaveBeenCalled()
    expect(scanStorage.savePageMarks).not.toHaveBeenCalled()
  })

  /** Ink is stored relative to the page's content, so a crop has to carry it along. */
  it('moves the ink onto the cropped geometry', async () => {
    const doc = { id: 'd', pages: [{ original: 'a.jpg', marks: [INK] }] }
    scanStorage.savePageEdit.mockResolvedValue({
      ...doc,
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg', marks: [INK] }],
    })
    scanStorage.applyPageDerived.mockResolvedValue(doc)

    // Crop to the bottom-right quarter: the page's centre becomes its corner.
    await cropPage(doc, 0, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 })

    const marks = scanStorage.applyPageDerived.mock.calls[0][2]
    expect(marks[0].points).toEqual([0, 0, 1, 1])
  })

  it('turns the ink with the page when it is rotated', async () => {
    const doc = { id: 'd', pages: [{ original: 'a.jpg', marks: [INK] }] }
    scanStorage.savePageEdit.mockResolvedValue({
      ...doc,
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg', marks: [INK] }],
    })
    scanStorage.applyPageDerived.mockResolvedValue(doc)

    await rotatePage(doc, 0)

    const marks = scanStorage.applyPageDerived.mock.calls[0][2]
    // A quarter turn clockwise sends the page's centre back to its centre.
    expect(marks[0].points[0]).toBeCloseTo(0.5, 10)
    expect(marks[0].points[1]).toBeCloseTo(0.5, 10)
  })

  it('reads from the geometry chain, not from a filtered render, so a filter never gets baked in', async () => {
    const doc = {
      id: 'd',
      filter: 'bw',
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg', filtered: 'a-filtered.jpg' }],
    }
    scanStorage.savePageEdit.mockResolvedValue(doc)
    scanStorage.applyPageDerived.mockResolvedValue(doc)

    await cropPage(doc, 0, RECT)

    expect(scanStorage.readPageBlob).toHaveBeenCalledWith('a-edited.jpg')
  })
})

describe('revertPage', () => {
  it('rebuilds the derived files after undoing a crop', async () => {
    const doc = { id: 'd', filter: 'bw', pages: [{ original: 'a.jpg', edited: 'a-edited.jpg' }] }
    scanStorage.resetPageEdit.mockResolvedValue({ ...doc, pages: [{ original: 'a.jpg' }] })
    scanStorage.applyPageDerived.mockResolvedValue(doc)

    await revertPage(doc, 0)

    expect(scanStorage.resetPageEdit).toHaveBeenCalledWith('d', 0)
    expect(scanStorage.applyPageDerived).toHaveBeenCalledTimes(1)
  })

  /**
   * "Asli" undoes a crop. It is not a request to tear up a signature, and the
   * marks cannot be mapped back through geometry that no longer exists — so
   * they are carried across exactly as they are.
   */
  it('carries the ink across unchanged', async () => {
    const doc = { id: 'd', pages: [{ original: 'a.jpg', edited: 'a-edited.jpg', marks: [INK] }] }
    scanStorage.resetPageEdit.mockResolvedValue({
      ...doc,
      pages: [{ original: 'a.jpg', marks: [INK] }],
    })
    scanStorage.applyPageDerived.mockResolvedValue(doc)

    await revertPage(doc, 0)

    expect(scanStorage.applyPageDerived.mock.calls[0][2]).toEqual([INK])
  })

  it('does nothing when the page was never edited', async () => {
    const doc = { id: 'd', filter: 'bw', pages: [{ original: 'a.jpg' }] }

    const result = await revertPage(doc, 0)

    expect(scanStorage.resetPageEdit).not.toHaveBeenCalled()
    expect(scanStorage.applyPageDerived).not.toHaveBeenCalled()
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
