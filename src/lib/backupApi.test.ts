import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const from = vi.fn()

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke }, from },
}))

const { downloadBackupBytes, listCloudBackups } = await import('./backupApi')

const SIGNED_URL = 'https://r2.example.com/scans/u1/doc-1.pdf?X-Amz-Signature=abc'

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ data: { download_url: SIGNED_URL }, error: null })
})

describe('downloadBackupBytes', () => {
  it('fetches the backup from the signed link the server hands out', async () => {
    const pdf = new Uint8Array([37, 80, 68, 70]) // %PDF
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => pdf.buffer })),
    )

    expect(await downloadBackupBytes('doc-1')).toEqual(pdf)
    expect(invoke).toHaveBeenCalledWith('generate-download-url', {
      body: { document_id: 'doc-1' },
    })
  })

  /**
   * A dropped connection rejects with the bare message "Failed to fetch",
   * which tells the user nothing about what to do. Every other network path in
   * this file translates that, and restoring must not be the exception.
   */
  it('turns a dropped connection into something the user can act on', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    await expect(downloadBackupBytes('doc-1')).rejects.toThrow(
      'Tidak bisa menghubungi penyimpanan cloud. Periksa koneksi lalu coba lagi.',
    )
  })

  /** An expired signature is the likely cause, and retrying really does fix it. */
  it('reports a refused download instead of returning empty bytes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) })),
    )

    await expect(downloadBackupBytes('doc-1')).rejects.toThrow(
      'Gagal mengunduh cadangan. Coba lagi sebentar lagi.',
    )
  })

  it('surfaces the server message when the link cannot be issued', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { context: new Response(JSON.stringify({ message: 'Cadangan tidak ditemukan.' })) },
    })

    await expect(downloadBackupBytes('doc-1')).rejects.toThrow('Cadangan tidak ditemukan.')
  })
})

describe('listCloudBackups', () => {
  /** Mimics the PostgREST builder: every step chains, `order` resolves. */
  function respondWith(rows: Record<string, unknown>[]) {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      order: vi.fn(async () => ({ data: rows, error: null })),
    }
    from.mockReturnValue(builder)
    return builder
  }

  /**
   * Restoring writes this date straight into the local index, so a backup that
   * arrives without it would date every recovered document to whenever the
   * user happened to press Restore — quietly reshuffling the document list.
   */
  it('carries the date the document was originally scanned', async () => {
    respondWith([
      {
        id: 'doc-1',
        title: 'Dok agent',
        page_count: 1,
        file_size_bytes: 340191,
        created_at: '2026-08-22T18:46:10.365Z',
        updated_at: '2026-08-22T18:46:10.219Z',
      },
    ])

    const [backup] = await listCloudBackups()

    expect(backup.createdAt).toBe('2026-08-22T18:46:10.365Z')
    expect(backup.updatedAt).toBe('2026-08-22T18:46:10.219Z')
  })

  it('asks only for rows that really have a copy in R2', async () => {
    const builder = respondWith([])

    await listCloudBackups()

    expect(builder.eq).toHaveBeenCalledWith('local_only', false)
  })
})
