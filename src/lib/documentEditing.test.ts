import { beforeEach, describe, expect, it, vi } from 'vitest'

const imageEditor = {
  cropImage: vi.fn(async () => new Blob(['cropped'])),
  rotateImage: vi.fn(async () => new Blob(['rotated'])),
  filterImage: vi.fn(async () => new Blob(['filtered'])),
  enhancePage: vi.fn(async () => new Blob(['enhanced'])),
  warpImage: vi.fn(async () => new Blob(['warped'])),
}
vi.mock('./imageEditor', () => imageEditor)

/**
 * `effectiveFilter`, `filterSource`, and `resolvePage` are real, tiny, pure
 * functions — already covered by scanIndexMigration.test.ts — reimplemented
 * here rather than imported so this file stays free of Capacitor, which the
 * real scanStorage.ts pulls in at the top of the module.
 */
const scanStorage = {
  applyDocumentEnhance: vi.fn(),
  applyDocumentFilter: vi.fn(),
  applyPageEnhance: vi.fn(),
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
  filterSource: (page: { enhanced?: string; edited?: string; original: string }) =>
    page.enhanced ?? page.edited ?? page.original,
  resolvePage: (page: {
    filtered?: string
    enhanced?: string
    edited?: string
    original: string
  }) => page.filtered ?? page.enhanced ?? page.edited ?? page.original,
}
vi.mock('./scanStorage', () => scanStorage)

const {
  cropPage,
  describeEnhanceOutcome,
  movePage,
  revertPage,
  rotatePage,
  setDocumentEnhance,
  setDocumentFilter,
  setPageFilter,
  straightenPage,
} = await import('./documentEditing')

const RECT = { x: 0, y: 0, width: 1, height: 1 }
const QUAD = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomLeft: { x: 0, y: 1 },
  bottomRight: { x: 1, y: 1 },
}

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

describe('straightenPage', () => {
  it('rebuilds the derived files after straightening', async () => {
    const doc = { id: 'd', filter: 'bw', pages: [{ original: 'a.jpg' }] }
    scanStorage.savePageEdit.mockResolvedValue({
      ...doc,
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg' }],
    })
    scanStorage.applyPageDerived.mockResolvedValue(doc)

    await straightenPage(doc, 0, QUAD)

    expect(imageEditor.warpImage).toHaveBeenCalledWith(expect.any(Blob), QUAD)
    expect(scanStorage.savePageEdit).toHaveBeenCalledWith('d', 0, expect.any(Blob))
    expect(scanStorage.applyPageDerived).toHaveBeenCalledWith(
      'd',
      0,
      [],
      imageEditor.filterImage,
      expect.any(Function),
    )
  })

  it('moves the ink onto the warped geometry', async () => {
    // Selecting the top-left quadrant is the crop-like case: the *kept
    // region's own* centre (0.25, 0.25 in source space — the middle of the
    // quadrant, not the middle of the whole source image, which would be
    // 0.5, 0.5) becomes the new page's own centre — same fixture reasoning
    // as remapMarksForWarp's own tests.
    const quadrant = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0.5, y: 0 },
      bottomLeft: { x: 0, y: 0.5 },
      bottomRight: { x: 0.5, y: 0.5 },
    }
    const doc = {
      id: 'd',
      pages: [{ original: 'a.jpg', marks: [{ ...INK, points: [0.25, 0.25, 0.25, 0.25] }] }],
    }
    scanStorage.savePageEdit.mockResolvedValue({
      ...doc,
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg', marks: doc.pages[0].marks }],
    })
    scanStorage.applyPageDerived.mockResolvedValue(doc)

    await straightenPage(doc, 0, quadrant)

    const marks = scanStorage.applyPageDerived.mock.calls[0][2]
    expect(marks[0].points[0]).toBeCloseTo(0.5, 8)
    expect(marks[0].points[1]).toBeCloseTo(0.5, 8)
  })

  it('reads from the geometry chain, not from a filtered render, so a filter never gets baked in', async () => {
    const doc = {
      id: 'd',
      filter: 'bw',
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg', filtered: 'a-filtered.jpg' }],
    }
    scanStorage.savePageEdit.mockResolvedValue(doc)
    scanStorage.applyPageDerived.mockResolvedValue(doc)

    await straightenPage(doc, 0, QUAD)

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

describe('rebuilding the lighting render after a geometry edit', () => {
  /**
   * The lighting render is deleted along with everything else derived from the
   * old geometry, and the filter is rendered *from* it — so it has to come back
   * first, or the filter is rebuilt from a page whose shadows are still there.
   *
   * The document handed to cropPage deliberately has no switch on it: the one
   * that counts is the copy storage just read back, not the caller's, which may
   * predate a switch flipped somewhere else.
   */
  it('renders the lighting fix first, then the filter and the ink', async () => {
    const doc = { id: 'd', filter: 'bw', pages: [{ original: 'a.jpg' }] }
    scanStorage.savePageEdit.mockResolvedValue({
      ...doc,
      enhance: true,
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg' }],
    })
    scanStorage.applyPageDerived.mockResolvedValue(doc)

    await cropPage(doc, 0, RECT)

    expect(scanStorage.applyPageEnhance).toHaveBeenCalledWith('d', 0, imageEditor.enhancePage)
    expect(scanStorage.applyPageEnhance.mock.invocationCallOrder[0]).toBeLessThan(
      scanStorage.applyPageDerived.mock.invocationCallOrder[0],
    )
  })

  it('does not touch it at all when the document switch is off', async () => {
    const doc = { id: 'd', filter: 'bw', pages: [{ original: 'a.jpg' }] }
    scanStorage.savePageEdit.mockResolvedValue({
      ...doc,
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg' }],
    })
    scanStorage.applyPageDerived.mockResolvedValue(doc)

    await cropPage(doc, 0, RECT)

    expect(scanStorage.applyPageEnhance).not.toHaveBeenCalled()
  })

  /** Undoing a crop invalidates the lighting render exactly as making one does. */
  it('rebuilds it after "Asli" too', async () => {
    const doc = { id: 'd', pages: [{ original: 'a.jpg', edited: 'a-edited.jpg' }] }
    scanStorage.resetPageEdit.mockResolvedValue({
      ...doc,
      enhance: true,
      pages: [{ original: 'a.jpg' }],
    })
    scanStorage.applyPageDerived.mockResolvedValue(doc)

    await revertPage(doc, 0)

    expect(scanStorage.applyPageEnhance).toHaveBeenCalledWith('d', 0, imageEditor.enhancePage)
  })
})

describe('setDocumentEnhance', () => {
  it("hands the storage layer the canvas renderers and the caller's signal", async () => {
    const controller = new AbortController()
    scanStorage.applyDocumentEnhance.mockResolvedValue({
      document: { id: 'doc-1' },
      outcome: { changed: 2, skipped: 0, unchanged: 0, failed: 0, cancelled: false },
    })

    await setDocumentEnhance({ id: 'doc-1', pages: [] } as never, true, {
      signal: controller.signal,
    })

    expect(scanStorage.applyDocumentEnhance).toHaveBeenCalledWith(
      'doc-1',
      true,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ signal: controller.signal }),
    )
  })
})

describe('describeEnhanceOutcome', () => {
  it('reports a clean run', () => {
    expect(
      describeEnhanceOutcome(
        { changed: 20, skipped: 0, unchanged: 0, failed: 0, cancelled: false },
        true,
      ),
    ).toBe('Pencahayaan 20 halaman diperbaiki.')
  })

  /**
   * Pages the estimator declined have to reach the user. They will never get a
   * lighting render, so the panel's count stops short of the total for good —
   * and without this line the user is left tapping "Lanjutkan" forever with no
   * explanation, exactly the trap `describeOcrOutcome` was written to avoid.
   */
  it('says how many pages were passed over, and does not call it a failure', () => {
    expect(
      describeEnhanceOutcome(
        { changed: 18, skipped: 0, unchanged: 2, failed: 0, cancelled: false },
        true,
      ),
    ).toBe('Pencahayaan 18 halaman diperbaiki, 2 halaman dilewati.')
  })

  it('reports a cancelled run as stopped, not as finished', () => {
    expect(
      describeEnhanceOutcome(
        { changed: 5, skipped: 0, unchanged: 0, failed: 0, cancelled: true },
        true,
      ),
    ).toBe('Dihentikan setelah 5 halaman.')
  })

  it('reports failures separately from pages that were passed over', () => {
    expect(
      describeEnhanceOutcome(
        { changed: 17, skipped: 0, unchanged: 1, failed: 2, cancelled: false },
        true,
      ),
    ).toBe('Pencahayaan 17 halaman diperbaiki, 1 halaman dilewati, 2 gagal.')
  })

  it('has its own sentence for switching the whole thing off', () => {
    expect(
      describeEnhanceOutcome(
        { changed: 20, skipped: 0, unchanged: 0, failed: 0, cancelled: false },
        false,
      ),
    ).toBe('Perbaikan pencahayaan dimatikan.')
  })

  /** Nothing to do is not the same as something done. */
  it('says so when every page was already in the state asked for', () => {
    expect(
      describeEnhanceOutcome(
        { changed: 0, skipped: 20, unchanged: 0, failed: 0, cancelled: false },
        true,
      ),
    ).toBe('Semua halaman sudah diperbaiki.')
  })
})
