import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Paths that already exist on the fake disk, so `stat` can find them. */
const disk = new Set<string>()
/** Paths whose write must fail, however the caller got to them. */
const unwritable = new Set<string>()
const writes: { path: string; directory: string; data: string }[] = []
const removed: string[] = []
const shares: { title: string; files: string[] }[] = []
/** What `Share.share` does: resolve, reject as a dismissal, or reject for real. */
let shareResult: 'sent' | 'cancelled' | 'broken' = 'sent'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS', Cache: 'CACHE' },
  Filesystem: {
    checkPermissions: async () => ({ publicStorage: 'granted' }),
    requestPermissions: async () => ({ publicStorage: 'granted' }),
    stat: async ({ path, directory }: { path: string; directory: string }) => {
      if (!disk.has(`${directory}:${path}`)) throw new Error('File does not exist')
      return { type: 'file', size: 1 }
    },
    writeFile: async (options: { path: string; directory: string; data: string }) => {
      if (unwritable.has(options.path)) {
        throw new Error(
          `'writeFile' failed with: /storage/emulated/0/Documents/${options.path}: open failed: EACCES (Permission denied)`,
        )
      }
      writes.push(options)
      disk.add(`${options.directory}:${options.path}`)
    },
    getUri: async ({ path, directory }: { path: string; directory: string }) => ({
      uri: `file:///${directory}/${path}`,
    }),
    rmdir: async ({ path, directory }: { path: string; directory: string }) => {
      removed.push(path)
      for (const entry of [...disk]) {
        if (entry.startsWith(`${directory}:${path}/`)) disk.delete(entry)
      }
    },
  },
}))

vi.mock('@capacitor/share', () => ({
  Share: {
    share: async (options: { title: string; files: string[] }) => {
      if (shareResult === 'cancelled') throw new Error('Share canceled')
      if (shareResult === 'broken') throw new Error('Gagal membuka layar berbagi.')
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

const { deliverExport, prepareStaging, shareFiles, writeExportFiles } = await import(
  './exportShare'
)

function file(name: string) {
  return { name, blob: new Blob([name]) }
}

/** The names that landed in the public Documents folder, in order. */
const savedNames = () =>
  writes.filter((write) => write.directory === 'DOCUMENTS').map((write) => write.path)

beforeEach(() => {
  disk.clear()
  unwritable.clear()
  writes.length = 0
  removed.length = 0
  shares.length = 0
  leaves.length = 0
  shareResult = 'sent'
})

describe('writeExportFiles — saving to the phone', () => {
  it('writes every file and hands back the URI of each', async () => {
    const written = await writeExportFiles([file('A.pdf'), file('B.pdf')], 'device')

    expect(savedNames()).toEqual(['A.pdf', 'B.pdf'])
    expect(written.map((entry) => entry.uri)).toEqual([
      'file:///DOCUMENTS/A.pdf',
      'file:///DOCUMENTS/B.pdf',
    ])
  })

  it('does not open the share sheet by itself', async () => {
    await writeExportFiles([file('A.pdf')], 'device')

    expect(shares).toHaveLength(0)
  })

  /**
   * The heart of the EACCES report from the phone (26 Agustus 2026). Under
   * scoped storage an app may create files in the shared Documents folder but
   * may not reopen one it no longer owns — and ownership does not survive a
   * reinstall — so exporting the same document twice failed every time under
   * its own name and worked the moment it was renamed.
   */
  it('never writes over a file the folder already holds', async () => {
    disk.add('DOCUMENTS:Dok agent.pdf')

    const written = await writeExportFiles([file('Dok agent.pdf')], 'device')

    expect(savedNames()).toEqual(['Dok agent (2).pdf'])
    expect(written[0].name).toBe('Dok agent (2).pdf')
  })

  it('keeps counting past names that are also taken', async () => {
    disk.add('DOCUMENTS:Nota.pdf')
    disk.add('DOCUMENTS:Nota (2).pdf')
    disk.add('DOCUMENTS:Nota (3).pdf')

    const written = await writeExportFiles([file('Nota.pdf')], 'device')

    expect(written[0].name).toBe('Nota (4).pdf')
  })

  /**
   * `stat` cannot always see a file this install does not own, so a name it
   * reports as free can still be refused by the write that follows. Without
   * the retry the export fails with EACCES on a folder that has ninety-eight
   * free names in it.
   */
  it('moves to the next name when the write is refused anyway', async () => {
    unwritable.add('Dok agent.pdf')

    const written = await writeExportFiles([file('Dok agent.pdf')], 'device')

    expect(written[0].name).toBe('Dok agent (2).pdf')
    expect(savedNames()).toEqual(['Dok agent (2).pdf'])
  })

  /** A failure that is not about the name must still reach the user. */
  it('gives up with the real error rather than renaming forever', async () => {
    for (const name of ['A.pdf', 'A (2).pdf', 'A (3).pdf', 'A (4).pdf']) unwritable.add(name)

    await expect(writeExportFiles([file('A.pdf')], 'device')).rejects.toThrow(/EACCES/)
  })
})

describe('writeExportFiles — staging for a share', () => {
  it('writes into the private cache folder, not the public one', async () => {
    const written = await writeExportFiles([file('A.pdf')], 'share')

    expect(writes[0].directory).toBe('CACHE')
    expect(writes[0].path).toBe('exports/A.pdf')
    expect(written[0].uri).toBe('file:///CACHE/exports/A.pdf')
  })

  /** Nothing in the export path may touch the public folder on this route. */
  it('leaves the Documents folder untouched', async () => {
    await writeExportFiles([file('A.pdf')], 'share')

    expect(savedNames()).toEqual([])
  })
})

describe('shareFiles', () => {
  it('stays silent when there is nothing to share', async () => {
    const outcome = await shareFiles([], 'Dokumen ScannApp')

    expect(shares).toHaveLength(0)
    expect(outcome).toBe('cancelled')
  })

  it('reports a dismissed sheet as a decision, not a failure', async () => {
    shareResult = 'cancelled'

    await expect(shareFiles(['file:///CACHE/exports/A.pdf'], 'Dokumen')).resolves.toBe('cancelled')
  })

  /**
   * A share that genuinely broke must not be dressed up as something the user
   * chose — that is how a cause disappears before anyone can act on it.
   */
  it('rethrows a share that failed for any other reason', async () => {
    shareResult = 'broken'

    await expect(shareFiles(['file:///CACHE/exports/A.pdf'], 'Dokumen')).rejects.toThrow(
      'Gagal membuka layar berbagi.',
    )
  })

  it('tells the ad gate this is our own flow, so returning earns no App Open ad', async () => {
    await shareFiles(['file:///CACHE/exports/A.pdf'], 'Dokumen')

    expect(leaves).toHaveLength(1)
  })
})

describe('deliverExport — Bagikan', () => {
  it('stages, then shares from the cache', async () => {
    await deliverExport([file('A.pdf')], 'share')

    expect(shares[0].files).toEqual(['file:///CACHE/exports/A.pdf'])
  })

  it('wipes the staging folder before it writes, so old exports never tag along', async () => {
    await deliverExport([file('A.pdf')], 'share')

    expect(removed).toEqual(['exports'])
  })

  /**
   * The report that started this (Boss Ali, 26 Agustus 2026): cancelling the
   * share sheet used to leave the file sitting in the user's Documents folder,
   * which is not what cancelling means. Nothing may survive it now.
   */
  it('leaves nothing behind when the sheet is dismissed', async () => {
    shareResult = 'cancelled'

    const result = await deliverExport([file('A.pdf')], 'share')

    expect(result.cancelled).toBe(true)
    expect(result.message).toBe('Ekspor dibatalkan — tidak ada berkas yang disimpan di HP.')
    expect(savedNames()).toEqual([])
    // Wiped once on the way in and again on the way out.
    expect(removed).toEqual(['exports', 'exports'])
    expect(disk.has('CACHE:exports/A.pdf')).toBe(false)
  })

  /**
   * The single-document path has no accounting to preserve, so the real cause
   * travels as an exception and the caller shows it — but the staged copy
   * still goes, because the share did not land.
   */
  it('throws the real cause when the sheet fails outright, and still cleans up', async () => {
    shareResult = 'broken'

    await expect(deliverExport([file('A.pdf')], 'share')).rejects.toThrow(
      'Gagal membuka layar berbagi.',
    )
    expect(removed).toEqual(['exports', 'exports'])
    expect(savedNames()).toEqual([])
  })

  it('names the file it sent', async () => {
    const result = await deliverExport([file('Nota.pdf')], 'share')

    expect(result.message).toBe('Nota.pdf dikirim.')
    expect(result.cancelled).toBe(false)
  })

  it('counts them when there are several', async () => {
    const result = await deliverExport([file('A.jpg'), file('B.jpg')], 'share')

    expect(result.message).toBe('2 file dikirim.')
  })
})

describe('deliverExport — Simpan ke HP', () => {
  it('saves without opening a share sheet at all', async () => {
    const result = await deliverExport([file('Nota.pdf')], 'device')

    expect(shares).toHaveLength(0)
    expect(result.message).toBe('Tersimpan di folder Documents: Nota.pdf')
    expect(result.cancelled).toBe(false)
  })

  /**
   * The toast reads the name back off what was written. Naming the file the
   * export set out to write would send the user looking for a file that is not
   * there whenever the folder already held that name.
   */
  it('names the file that actually landed, not the one that was asked for', async () => {
    disk.add('DOCUMENTS:Nota.pdf')

    const result = await deliverExport([file('Nota.pdf')], 'device')

    expect(result.message).toBe('Tersimpan di folder Documents: Nota (2).pdf')
  })

  it('reports the count when there are several', async () => {
    const result = await deliverExport([file('A.jpg'), file('B.jpg')], 'device')

    expect(result.message).toBe('2 file tersimpan di folder Documents.')
  })

  it('does not wipe the staging folder, which it never used', async () => {
    await deliverExport([file('A.pdf')], 'device')

    expect(removed).toEqual([])
  })
})

describe('deliverExport', () => {
  it('refuses an empty export rather than opening an empty share sheet', async () => {
    await expect(deliverExport([], 'share')).rejects.toThrow('Tidak ada file untuk diekspor.')
  })
})

describe('prepareStaging', () => {
  it('survives a staging folder that does not exist yet', async () => {
    await expect(prepareStaging()).resolves.toBeUndefined()
  })
})
