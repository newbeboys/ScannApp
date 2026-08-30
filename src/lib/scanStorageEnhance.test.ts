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

const { applyDocumentEnhance, applyPageEnhance } = await import('./scanStorage')

const DOC_ID = 'doc-1'

/** Records which file each stage was asked to start from. */
const enhanceRenders: string[] = []
const filterRenders: { source: string; filter: string }[] = []
const markRenders: string[] = []

/** Stands in for the canvas. Returns `null` for pages named "declined". */
const renderEnhance = async (source: Blob): Promise<Blob | null> => {
  const text = await source.text()
  enhanceRenders.push(text)
  return text.includes('declined') ? null : new Blob([`light-of-${text}`])
}

const renderFilter = async (source: Blob, filter: string): Promise<Blob> => {
  const text = await source.text()
  filterRenders.push({ source: text, filter })
  return new Blob([`${filter}-of-${text}`])
}

const renderMarks = async (source: Blob): Promise<Blob> => {
  const text = await source.text()
  markRenders.push(text)
  return new Blob([`ink-on-${text}`])
}

/**
 * Puts one document in the index.
 *
 * Reading a page returns its own path as the blob's contents, which is what
 * lets the render spies report *which* file each stage was derived from.
 */
function seed(pages: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const index = JSON.stringify([
    {
      schemaVersion: 6,
      id: DOC_ID,
      title: 'Kontrak',
      createdAt: '2026-08-30T00:00:00.000Z',
      pageCount: pages.length,
      ...extra,
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
  enhanceRenders.length = 0
  filterRenders.length = 0
  markRenders.length = 0
})

describe('applyDocumentEnhance — turning it on', () => {
  it('renders from the geometry chain, never from the filter render', async () => {
    seed([{ original: 'p1.jpg', edited: 'p1-edited.jpg', filtered: 'p1-filtered.jpg' }], {
      filter: 'bw',
    })

    await applyDocumentEnhance(DOC_ID, true, renderEnhance, renderFilter, renderMarks)

    expect(enhanceRenders).toEqual(['p1-edited.jpg'])
  })

  it('re-renders the filter on top of the lighting fix', async () => {
    seed([{ original: 'p1.jpg' }], { filter: 'bw' })

    await applyDocumentEnhance(DOC_ID, true, renderEnhance, renderFilter, renderMarks)

    expect(filterRenders).toEqual([{ source: 'p1-enhanced.jpg', filter: 'bw' }])
  })

  it("writes the switch and each page's render into the index", async () => {
    seed([{ original: 'p1.jpg' }])

    const { document, outcome } = await applyDocumentEnhance(
      DOC_ID,
      true,
      renderEnhance,
      renderFilter,
      renderMarks,
    )

    expect(document.enhance).toBe(true)
    expect(document.pages[0].enhanced).toBe('p1-enhanced.jpg')
    expect(writtenIndex()[0].enhance).toBe(true)
    expect(outcome).toMatchObject({ changed: 1, skipped: 0, unchanged: 0, failed: 0 })
  })

  it('leaves a page alone when the estimator declines it', async () => {
    seed([{ original: 'declined.jpg' }], { filter: 'bw' })

    const { document, outcome } = await applyDocumentEnhance(
      DOC_ID,
      true,
      renderEnhance,
      renderFilter,
      renderMarks,
    )

    expect(document.pages[0].enhanced).toBeUndefined()
    expect(outcome.unchanged).toBe(1)
    // Nothing under it changed, so nothing under it needs re-rendering.
    expect(filterRenders).toEqual([])
  })

  it('counts a page whose render throws and carries on with the rest', async () => {
    seed([{ original: 'p1.jpg' }, { original: 'p2.jpg' }])
    const failing = async (source: Blob) => {
      if ((await source.text()) === 'p1.jpg') throw new Error('kanvas mati')
      return new Blob(['light'])
    }

    const { outcome } = await applyDocumentEnhance(DOC_ID, true, failing, renderFilter, renderMarks)

    expect(outcome).toMatchObject({ failed: 1, changed: 1 })
  })

  it('skips pages that already have one, so a cancelled run can be resumed cheaply', async () => {
    seed([{ original: 'p1.jpg', enhanced: 'p1-enhanced.jpg' }, { original: 'p2.jpg' }], {
      enhance: true,
    })

    const { outcome } = await applyDocumentEnhance(
      DOC_ID,
      true,
      renderEnhance,
      renderFilter,
      renderMarks,
    )

    expect(enhanceRenders).toEqual(['p2.jpg'])
    expect(outcome).toMatchObject({ changed: 1, skipped: 1 })
  })

  it('reports progress for every page, finished or skipped', async () => {
    seed([{ original: 'p1.jpg' }, { original: 'p2.jpg' }])
    const progress: [number, number][] = []

    await applyDocumentEnhance(DOC_ID, true, renderEnhance, renderFilter, renderMarks, {
      onProgress: (done, total) => progress.push([done, total]),
    })

    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ])
  })
})

describe('applyDocumentEnhance — turning it off', () => {
  it('deletes the render and rebuilds the filter from the geometry again', async () => {
    seed([{ original: 'p1.jpg', enhanced: 'p1-enhanced.jpg' }], { enhance: true, filter: 'bw' })

    const { document } = await applyDocumentEnhance(
      DOC_ID,
      false,
      renderEnhance,
      renderFilter,
      renderMarks,
    )

    expect(document.enhance).toBeUndefined()
    expect(document.pages[0].enhanced).toBeUndefined()
    expect(fs.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'p1-enhanced.jpg' }))
    expect(filterRenders).toEqual([{ source: 'p1.jpg', filter: 'bw' }])
  })

  /**
   * The file is deleted before anything under it is re-rendered, so a failure
   * after that point would leave the index pointing at a file that is gone.
   */
  it('does not keep pointing at the render it already deleted when the rebuild fails', async () => {
    seed([{ original: 'p1.jpg', enhanced: 'p1-enhanced.jpg' }], { enhance: true, filter: 'bw' })
    const failing = async () => {
      throw new Error('kanvas mati')
    }

    const { document, outcome } = await applyDocumentEnhance(
      DOC_ID,
      false,
      renderEnhance,
      failing,
      renderMarks,
    )

    expect(outcome.failed).toBe(1)
    expect(document.pages[0].enhanced).toBeUndefined()
  })

  it('leaves pages that never had one alone', async () => {
    seed([{ original: 'p1.jpg' }], { enhance: true })

    const { outcome } = await applyDocumentEnhance(
      DOC_ID,
      false,
      renderEnhance,
      renderFilter,
      renderMarks,
    )

    expect(outcome).toMatchObject({ changed: 0, skipped: 1 })
    expect(filterRenders).toEqual([])
  })
})

describe('applyDocumentEnhance — cancelling', () => {
  /**
   * Basic tops out at 20 pages but Pro has no limit, and every page is decoded
   * and re-encoded at full resolution. Without this, the only way out of a
   * sixty-page run is killing the app.
   */
  it('stops at the next page and keeps what it already finished', async () => {
    seed([{ original: 'p1.jpg' }, { original: 'p2.jpg' }, { original: 'p3.jpg' }])
    const controller = new AbortController()

    const { document, outcome } = await applyDocumentEnhance(
      DOC_ID,
      true,
      renderEnhance,
      renderFilter,
      renderMarks,
      { signal: controller.signal, onProgress: (done) => done === 1 && controller.abort() },
    )

    expect(outcome.cancelled).toBe(true)
    expect(outcome.changed).toBe(1)
    expect(document.pages[0].enhanced).toBe('p1-enhanced.jpg')
    expect(document.pages[1].enhanced).toBeUndefined()
    expect(document.pages[2].enhanced).toBeUndefined()
    // Written, not thrown away: the finished page must survive the cancel.
    expect(writtenIndex()[0].pages[0].enhanced).toBe('p1-enhanced.jpg')
  })

  /** The switch records what the user asked for; the files record how far it got. */
  it('still records the switch the user asked for', async () => {
    seed([{ original: 'p1.jpg' }, { original: 'p2.jpg' }])
    const controller = new AbortController()

    const { document } = await applyDocumentEnhance(
      DOC_ID,
      true,
      renderEnhance,
      renderFilter,
      renderMarks,
      { signal: controller.signal, onProgress: () => controller.abort() },
    )

    expect(document.enhance).toBe(true)
  })
})

describe('applyPageEnhance', () => {
  it("rebuilds one page's lighting render after its geometry changed", async () => {
    seed([{ original: 'p1.jpg', edited: 'p1-edited.jpg' }], { enhance: true })

    const doc = await applyPageEnhance(DOC_ID, 0, renderEnhance)

    expect(enhanceRenders).toEqual(['p1-edited.jpg'])
    expect(doc.pages[0].enhanced).toBe('p1-enhanced.jpg')
  })

  it('does nothing at all when the document switch is off', async () => {
    seed([{ original: 'p1.jpg' }])

    const doc = await applyPageEnhance(DOC_ID, 0, renderEnhance)

    expect(enhanceRenders).toEqual([])
    expect(doc.pages[0].enhanced).toBeUndefined()
  })

  it('drops the field when the estimator declines the page', async () => {
    seed([{ original: 'declined.jpg', enhanced: 'declined-enhanced.jpg' }], { enhance: true })

    const doc = await applyPageEnhance(DOC_ID, 0, renderEnhance)

    expect(doc.pages[0].enhanced).toBeUndefined()
    expect(fs.deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'declined-enhanced.jpg' }),
    )
  })
})
