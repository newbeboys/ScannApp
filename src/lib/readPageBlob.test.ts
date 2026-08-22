import { beforeEach, describe, expect, it, vi } from 'vitest'

const fs = {
  getUri: vi.fn(async ({ path }: { path: string }) => ({ uri: `file:///data/data/app/${path}` })),
  readFile: vi.fn(async () => ({ data: 'BASE64' })),
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  rmdir: vi.fn(async () => {}),
}

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: fs,
  Directory: { Data: 'DATA', Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
}))

let isNative = true

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNative,
    convertFileSrc: (path: string) =>
      path.startsWith('file://')
        ? `https://localhost${path.replace('file://', '/_capacitor_file_')}`
        : path,
  },
}))

vi.mock('./blobBase64', () => ({
  blobToBase64: async () => 'BASE64',
  base64ToBlob: () => new Blob(['dari-base64']),
}))

const { readPageBlob } = await import('./scanStorage')

beforeEach(() => {
  for (const fn of Object.values(fs)) fn.mockClear()
  isNative = true
})

/**
 * Regresi 23 Agustus 2026: setiap operasi editor dan setiap halaman yang
 * diekspor membaca gambarnya lewat Filesystem.readFile, yang meng-encode
 * berkas jadi base64 lalu menyeberangkannya sebagai string JSON melalui bridge
 * JS/Java — sebelum JavaScript membongkarnya lagi byte demi byte. Itu penyebab
 * crop/putar/asli dan pencadangan terasa lambat.
 */
describe('readPageBlob', () => {
  it('streams the bytes over the webview asset loader', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(['biner']),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const blob = await readPageBlob('scans/abc/page-1.jpg')

    expect(await blob.text()).toBe('biner')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://localhost/_capacitor_file_/data/data/app/scans/abc/page-1.jpg',
      expect.anything(),
    )
  })

  /**
   * savePageEdit menulis ulang ke path yang sama, jadi URL-nya stabil dan
   * webview akan dengan senang hati menyajikan byte yang sudah ia cache untuk
   * <img> yang sedang menampilkan halaman itu. Tanpa no-store, memutar dua kali
   * akan memutar ulang hasil putaran pertama dan tampak mentok di 90 derajat.
   */
  it('bypasses the webview cache so an edited page is never read stale', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(['biner']),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await readPageBlob('scans/abc/page-1-edited.jpg')

    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), { cache: 'no-store' })
  })

  it('never touches the base64 bridge path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(['biner']) })),
    )

    await readPageBlob('scans/abc/page-1.jpg')

    // Inilah inti perbaikannya: readFile base64 tidak boleh dipanggil lagi.
    expect(fs.readFile).not.toHaveBeenCalled()
  })

  /**
   * Di web tidak ada URL untuk di-stream, jadi jalur base64 tetap dipakai —
   * tapi sengaja TIDAK lewat getScanPageDisplayUri, yang akan menitipkan object
   * URL ukuran penuh di cache tampilan dan tidak pernah dibebaskan siapa pun.
   */
  it('falls back to base64 on web without leaking an object URL', async () => {
    isNative = false
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const createObjectURL = vi.fn(() => 'blob:bocor')
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() })

    const blob = await readPageBlob('scans/abc/page-1.jpg')

    expect(await blob.text()).toBe('dari-base64')
    expect(fs.readFile).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('reports a failed read instead of returning an empty image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, blob: async () => new Blob() })),
    )

    await expect(readPageBlob('scans/abc/page-1.jpg')).rejects.toThrow(/HTTP 404/)
  })
})
