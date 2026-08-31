import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Paths that already exist on the fake disk, so `stat` can find them. */
const disk = new Set<string>()
/** Paths whose write must fail, however the caller got to them. */
const unwritable = new Set<string>()
const writes: { path: string; directory: string; data: string }[] = []
/** Every append, in order, so the chunked write can be read back whole. */
const appends: { path: string; directory: string; data: string }[] = []
/** Paths whose *append* must fail, to exercise the half-written-file cleanup. */
const unappendable = new Set<string>()
/**
 * What each path holds, so `stat` can report a real size.
 *
 * The encoder is mocked as `b64:<text>` over ASCII blobs, so a slice's decoded
 * length is its text length — which is what the chunked writer checks the file
 * against.
 */
const contents = new Map<string, string>()
/** Paths that must lose a slice without saying so, to exercise the size check. */
const truncating = new Set<string>()
/** Paths whose `stat` must fail, as an unsupported platform's would. */
const statBlind = new Set<string>()
const decoded = (data: string) => data.replace(/^b64:/, '')
const deleted: string[] = []
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
      const key = `${directory}:${path}`
      if (statBlind.has(path)) throw new Error('stat is not supported here')
      if (!disk.has(key)) throw new Error('File does not exist')
      return { type: 'file', size: contents.get(key)?.length ?? 1 }
    },
    writeFile: async (options: { path: string; directory: string; data: string }) => {
      if (unwritable.has(options.path)) {
        throw new Error(
          `'writeFile' failed with: /storage/emulated/0/Documents/${options.path}: open failed: EACCES (Permission denied)`,
        )
      }
      writes.push(options)
      disk.add(`${options.directory}:${options.path}`)
      contents.set(`${options.directory}:${options.path}`, decoded(options.data))
    },
    appendFile: async (options: { path: string; directory: string; data: string }) => {
      if (unappendable.has(options.path)) {
        throw new Error(`'appendFile' failed with: ${options.path}: ENOSPC (No space left)`)
      }
      appends.push(options)
      // A truncating filesystem accepts the slice and reports success without
      // keeping it — the one failure the size check exists to catch.
      if (truncating.has(options.path)) return
      const key = `${options.directory}:${options.path}`
      contents.set(key, (contents.get(key) ?? '') + decoded(options.data))
    },
    deleteFile: async ({ path, directory }: { path: string; directory: string }) => {
      deleted.push(path)
      disk.delete(`${directory}:${path}`)
      contents.delete(`${directory}:${path}`)
    },
    getUri: async ({ path, directory }: { path: string; directory: string }) => ({
      uri: `file:///${directory}/${path}`,
    }),
    rmdir: async ({ path, directory }: { path: string; directory: string }) => {
      removed.push(path)
      for (const entry of [...disk]) {
        if (entry.startsWith(`${directory}:${path}/`)) {
          disk.delete(entry)
          contents.delete(entry)
        }
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

const { deliverExport, prepareStaging, shareFiles, writeExportFiles, WRITE_CHUNK_BYTES } =
  await import('./exportShare')

function file(name: string) {
  return { name, blob: new Blob([name]) }
}

/** The names that landed in the public Documents folder, in order. */
const savedNames = () =>
  writes.filter((write) => write.directory === 'DOCUMENTS').map((write) => write.path)

beforeEach(() => {
  disk.clear()
  contents.clear()
  unwritable.clear()
  unappendable.clear()
  truncating.clear()
  statBlind.clear()
  writes.length = 0
  appends.length = 0
  deleted.length = 0
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

/**
 * The device report from 31 Agustus 2026: a twenty-page export took over a
 * minute while the pages themselves compressed in seconds. The plugin only
 * takes base64 on native and one call carries the whole file, so a 25 MB PDF
 * became a 33 MB string that JS built, `JSON.stringify` copied, Java parsed and
 * then decoded — four copies of it on a phone, in one go.
 *
 * These hold the slicing that replaced it: same bytes, same order, never more
 * than one slice of them in flight.
 */
describe('writing a file larger than one bridge call', () => {
  /** The mocked encoder is `b64:<text>`, so a slice reads back by dropping it. */
  const rejoin = (parts: { data: string }[]) =>
    parts.map((part) => part.data.replace(/^b64:/, '')).join('')

  function bigFile(name: string, bytes: number) {
    // Distinguishable per position, so an out-of-order slice cannot pass.
    let text = ''
    while (text.length < bytes) text += `${text.length}-`
    return { name, blob: new Blob([text.slice(0, bytes)]) }
  }

  it('sends it in slices rather than as one string', async () => {
    const big = bigFile('Besar.pdf', WRITE_CHUNK_BYTES * 2 + 100)

    await writeExportFiles([big], 'share')

    expect(writes).toHaveLength(1)
    expect(appends).toHaveLength(2)
    for (const call of [...writes, ...appends]) {
      expect(call.data.length - 'b64:'.length).toBeLessThanOrEqual(WRITE_CHUNK_BYTES)
    }
  })

  it('puts the file back together byte for byte, in order', async () => {
    const big = bigFile('Besar.pdf', WRITE_CHUNK_BYTES * 2 + 100)

    await writeExportFiles([big], 'share')

    expect(rejoin([...writes, ...appends])).toBe(await big.blob.text())
  })

  it('leaves a small file on the single-call path it always used', async () => {
    await writeExportFiles([file('Kecil.pdf')], 'share')

    expect(writes).toHaveLength(1)
    expect(appends).toHaveLength(0)
  })

  /**
   * A slice that fails leaves a truncated file behind, which is worse than no
   * file: it looks like a finished export and opens as a broken PDF.
   */
  it('removes the half-written file when a slice fails', async () => {
    unappendable.add('exports/Besar.pdf')

    await expect(
      writeExportFiles([bigFile('Besar.pdf', WRITE_CHUNK_BYTES * 2)], 'share'),
    ).rejects.toThrow(/ENOSPC/)

    expect(deleted).toEqual(['exports/Besar.pdf'])
  })

  /**
   * And having removed it, the Documents retry still has a free name to reach
   * for — the half-written file must not be what makes the next attempt look
   * taken.
   */
  it('still renames past a name whose slices failed', async () => {
    unappendable.add('Besar.pdf')

    const [written] = await writeExportFiles(
      [bigFile('Besar.pdf', WRITE_CHUNK_BYTES * 2)],
      'device',
    )

    expect(written.name).toBe('Besar (2).pdf')
    expect(deleted).toEqual(['Besar.pdf'])
  })
})

/**
 * The one failure the slices have that a single call did not: losing part of
 * the file without anyone saying so. `appendFile` is the plugin's own API and
 * the append mode is first class in the layer beneath it, so this is a guard
 * rather than a known fault — but a PDF that opens on page eleven is exactly
 * the kind of damage nobody notices until the original is long gone.
 */
describe('a write that silently loses a slice', () => {
  function bigFile(name: string, bytes: number) {
    let text = ''
    while (text.length < bytes) text += `${text.length}-`
    return { name, blob: new Blob([text.slice(0, bytes)]) }
  }

  it('fails instead of leaving a short file behind', async () => {
    truncating.add('exports/Besar.pdf')

    await expect(
      writeExportFiles([bigFile('Besar.pdf', WRITE_CHUNK_BYTES * 2)], 'share'),
    ).rejects.toThrow(/tidak utuh/)

    expect(deleted).toEqual(['exports/Besar.pdf'])
  })

  it('says how much of it actually landed', async () => {
    truncating.add('exports/Besar.pdf')

    await expect(
      writeExportFiles([bigFile('Besar.pdf', WRITE_CHUNK_BYTES * 2)], 'share'),
    ).rejects.toThrow(`${WRITE_CHUNK_BYTES} dari ${WRITE_CHUNK_BYTES * 2} byte`)
  })

  it('accepts a file whose slices all landed', async () => {
    const big = bigFile('Besar.pdf', WRITE_CHUNK_BYTES * 2 + 100)

    await expect(writeExportFiles([big], 'share')).resolves.toHaveLength(1)
    expect(deleted).toEqual([])
  })
})

/**
 * And the guard must not become a new way to lose a good export: it only ever
 * second-guesses a write that already succeeded, so a platform whose `stat`
 * answers differently has to be treated as "cannot tell", not as "broken".
 */
describe('a size check that cannot be answered', () => {
  it('keeps the export when stat itself fails', async () => {
    let text = ''
    while (text.length < WRITE_CHUNK_BYTES * 2) text += `${text.length}-`
    const big = { name: 'Besar.pdf', blob: new Blob([text.slice(0, WRITE_CHUNK_BYTES * 2)]) }

    statBlind.add('exports/Besar.pdf')

    await expect(writeExportFiles([big], 'share')).resolves.toHaveLength(1)
    expect(deleted).toEqual([])
  })
})
