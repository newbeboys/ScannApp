import { beforeEach, describe, expect, it, vi } from 'vitest'

const writes: { path: string; data: string }[] = []
const shares: { title: string; files: string[] }[] = []
let shareThrows = false

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS' },
  Filesystem: {
    checkPermissions: async () => ({ publicStorage: 'granted' }),
    requestPermissions: async () => ({ publicStorage: 'granted' }),
    writeFile: async (options: { path: string; data: string }) => {
      writes.push({ path: options.path, data: options.data })
    },
    getUri: async ({ path }: { path: string }) => ({ uri: `file:///Documents/${path}` }),
  },
}))

vi.mock('@capacitor/share', () => ({
  Share: {
    share: async (options: { title: string; files: string[] }) => {
      if (shareThrows) throw new Error('share sheet dismissed')
      shares.push(options)
    },
  },
}))

vi.mock('./blobBase64', () => ({
  blobToBase64: async (blob: Blob) => `b64:${await blob.text()}`,
}))

const leaves: number[] = []
vi.mock('./ads/appOpenGate', () => ({
  resumeTracker: { leaveForOwnFlow: () => leaves.push(Date.now()) },
}))

const { deliverExport, shareFiles, writeExportFiles } = await import('./exportShare')

function file(name: string) {
  return { name, blob: new Blob([name]) }
}

beforeEach(() => {
  writes.length = 0
  shares.length = 0
  leaves.length = 0
  shareThrows = false
})

describe('writeExportFiles', () => {
  it('writes every file and hands back a URI for each', async () => {
    const uris = await writeExportFiles([file('A.pdf'), file('B.pdf')])

    expect(writes.map((write) => write.path)).toEqual(['A.pdf', 'B.pdf'])
    expect(uris).toEqual(['file:///Documents/A.pdf', 'file:///Documents/B.pdf'])
  })

  it('does not open the share sheet by itself', async () => {
    await writeExportFiles([file('A.pdf')])

    expect(shares).toHaveLength(0)
  })
})

describe('shareFiles', () => {
  it('stays silent when there is nothing to share', async () => {
    await shareFiles([], 'Dokumen ScannApp')

    expect(shares).toHaveLength(0)
  })

  /**
   * Dismissing the share sheet is a normal thing to do, and the files are
   * already on disk by then — it must not surface as an export failure.
   */
  it('swallows a dismissed share sheet', async () => {
    shareThrows = true

    await expect(shareFiles(['file:///Documents/A.pdf'], 'Dokumen')).resolves.toBeUndefined()
  })

  it('tells the ad gate this is our own flow, so returning earns no App Open ad', async () => {
    await shareFiles(['file:///Documents/A.pdf'], 'Dokumen')

    expect(leaves).toHaveLength(1)
  })
})

describe('deliverExport', () => {
  it('writes first and shares second, so a dismissed sheet still leaves the file', async () => {
    await deliverExport([file('A.pdf')])

    expect(writes).toHaveLength(1)
    expect(shares[0].files).toEqual(['file:///Documents/A.pdf'])
  })

  it('reports where a single file landed', async () => {
    const result = await deliverExport([file('Nota.pdf')])

    expect(result.message).toBe('Tersimpan di folder Documents: Nota.pdf')
  })

  it('reports the count when there are several', async () => {
    const result = await deliverExport([file('A.jpg'), file('B.jpg')])

    expect(result.message).toBe('2 file tersimpan di folder Documents.')
  })

  it('refuses an empty export rather than opening an empty share sheet', async () => {
    await expect(deliverExport([])).rejects.toThrow('Tidak ada file untuk diekspor.')
  })
})
