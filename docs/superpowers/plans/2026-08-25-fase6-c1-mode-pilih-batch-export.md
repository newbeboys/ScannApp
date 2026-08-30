# Fase 6 C1 — Mode Pilih & Batch Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab Dokumen dapat mode pilih; beberapa dokumen bisa diekspor jadi PDF sekaligus (Pro) atau dihapus sekaligus (semua tier).

**Architecture:** Logika murni dulu di `src/lib/` (penamaan berkas, gerbang tier, himpunan seleksi, perakit kalimat), lalu jalur ekspor batch yang menulis satu PDF ke disk pada satu waktu, baru komponen UI-nya, dan terakhir penyambungan di `App.tsx`. `deliverExport` yang lama dipertahankan utuh supaya ekspor satuan tidak berubah perilakunya.

**Tech Stack:** React 19 + TypeScript + Vite + Capacitor (Android). Vitest dua suite — `node` untuk logika murni, `browser` (Chromium via Playwright, `vitest-browser-react`) untuk komponen.

**Spec:** `docs/superpowers/specs/2026-08-25-fase6-batch-scan-export-design.md`

## Global Constraints

- **Bahasa komentar konsisten per berkas.** Berkas `src/lib/*` dan `src/components/*` yang ada memakai **Inggris**; ikuti berkas yang sedang disunting, jangan campur dalam satu berkas. Teks yang dilihat user selalu **Bahasa Indonesia**.
- **Penamaan:** `kebab-case`/`camelCase` untuk berkas lib, `PascalCase` untuk komponen React.
- **Tidak ada warna atau font baru** (CLAUDE.md 9.2). Pakai token yang sudah ada: `--primary` `#2563EB`, `--pro-gold` `#F5C443`, `--danger` `#e5484d`, `--surface-solid`.
- **Gerbang tier ditegakkan di library, bukan hanya di UI** — pola `resolveCompressionLevel` & `setPageMarks`.
- **Batch export = PDF saja, 1 dokumen = 1 berkas.** Tidak ada JPG/PNG, tidak ada ZIP, tidak ada dependency baru.
- **Cadangan cloud tidak boleh tersentuh:** `buildPdfFile()` tetap memakai `BASIC_COMPRESSION`.
- **Tidak ada pemicu iklan baru.** Ekspor bukan pemicu sejak 23 Agustus 2026; hapus tidak pernah jadi pemicu.
- **Jangan me-mock canvas untuk menguji kode canvas** (CLAUDE.md Bagian 4). Tugas di rencana ini tidak menyentuh canvas sama sekali.
- Perintah verifikasi: `npm run test:node`, `npm run test:browser`, `npm test`, `npm run lint`, `npm run build`.

---

### Task 1: Modul nama berkas (`exportNames.ts`)

Memindahkan `toSafeFilename` keluar dari `exportShare.ts` dan menambah `uniqueExportNames`. Alasan pindah: keduanya matematika string murni, tapi `exportShare.ts` mengimpor Capacitor — selama mereka di sana, test penamaan ikut menyeret tiruan plugin.

**Files:**
- Create: `src/lib/exportNames.ts`
- Create: `src/lib/exportNames.test.ts`
- Modify: `src/lib/exportShare.ts` (buang `toSafeFilename`, impor dari modul baru bila masih dipakai — lihat langkah 5)
- Modify: `src/lib/documentExport.ts` (impor `toSafeFilename` dari `./exportNames`)
- Modify: `src/lib/documentExport.test.ts` (tiruan `./exportShare` tidak lagi perlu menyediakan `toSafeFilename`)

**Interfaces:**
- Consumes: tidak ada (task pertama)
- Produces:
  - `toSafeFilename(title: string): string` — perilaku persis sama dengan yang lama
  - `uniqueExportNames(names: string[]): string[]`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/lib/exportNames.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { toSafeFilename, uniqueExportNames } from './exportNames'

describe('toSafeFilename', () => {
  it('strips characters Android and Windows reject', () => {
    expect(toSafeFilename('Nota/Agustus: 2026?')).toBe('Nota Agustus 2026')
  })

  it('falls back to a usable name when nothing survives', () => {
    expect(toSafeFilename('///')).toBe('Dokumen')
  })

  it('truncates at 60 characters', () => {
    expect(toSafeFilename('a'.repeat(80))).toHaveLength(60)
  })
})

describe('uniqueExportNames', () => {
  it('leaves already-distinct names alone', () => {
    expect(uniqueExportNames(['Nota.pdf', 'Kontrak.pdf'])).toEqual(['Nota.pdf', 'Kontrak.pdf'])
  })

  /**
   * The bug this locks out: two documents whose titles reduce to the same
   * filename used to write the same path, so the second silently overwrote the
   * first and the user got one file fewer than they selected.
   */
  it('numbers a repeat instead of letting it overwrite', () => {
    expect(uniqueExportNames(['Nota.pdf', 'Nota.pdf'])).toEqual(['Nota.pdf', 'Nota (2).pdf'])
  })

  it('keeps counting past a three-way collision', () => {
    expect(uniqueExportNames(['Nota.pdf', 'Nota.pdf', 'Nota.pdf'])).toEqual([
      'Nota.pdf',
      'Nota (2).pdf',
      'Nota (3).pdf',
    ])
  })

  it('puts the number before the extension so the file still opens as a PDF', () => {
    expect(uniqueExportNames(['Nota.pdf', 'Nota.pdf'])[1].endsWith('.pdf')).toBe(true)
  })

  /** Android and Windows both match filenames case-insensitively. */
  it('treats names differing only in case as a collision', () => {
    expect(uniqueExportNames(['Nota.pdf', 'NOTA.pdf'])).toEqual(['Nota.pdf', 'NOTA (2).pdf'])
  })

  /** A batch can already contain the very name the counter is about to mint. */
  it('skips a suffix that is already taken', () => {
    expect(uniqueExportNames(['Nota.pdf', 'Nota (2).pdf', 'Nota.pdf'])).toEqual([
      'Nota.pdf',
      'Nota (2).pdf',
      'Nota (3).pdf',
    ])
  })

  it('handles a name with no extension at all', () => {
    expect(uniqueExportNames(['Nota', 'Nota'])).toEqual(['Nota', 'Nota (2)'])
  })

  it('returns an empty list untouched', () => {
    expect(uniqueExportNames([])).toEqual([])
  })
})
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm run test:node -- exportNames`
Expected: FAIL — `Failed to resolve import "./exportNames"`.

- [ ] **Step 3: Tulis implementasinya**

Buat `src/lib/exportNames.ts`:

```ts
/**
 * Filename maths, kept apart from `exportShare` on purpose.
 *
 * Both functions here are pure string work, but `exportShare` imports
 * Capacitor — leaving them there would make every naming test drag mocks for
 * the Filesystem and Share plugins along with it.
 */

/** Strips characters Android/Windows reject in filenames. */
export function toSafeFilename(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 0 ? cleaned.slice(0, 60) : 'Dokumen'
}

/**
 * Makes every name in a batch distinct, keeping the first occurrence as-is.
 *
 * `toSafeFilename` removes characters and truncates at 60, so two different
 * titles can arrive here identical. Writing both would overwrite the first and
 * hand the user fewer files than they selected, with nothing on screen saying
 * so.
 *
 * Comparison is case-insensitive because the filesystems this lands on are:
 * "Nota.pdf" and "NOTA.pdf" are one file on Android and on Windows.
 */
export function uniqueExportNames(names: string[]): string[] {
  const taken = new Set<string>()

  return names.map((name) => {
    if (!taken.has(name.toLowerCase())) {
      taken.add(name.toLowerCase())
      return name
    }

    // Counts past suffixes the batch already contains, so a list holding both
    // "Nota.pdf" and "Nota (2).pdf" mints "Nota (3).pdf" rather than a second
    // copy of a name that is already spoken for.
    let counter = 2
    let candidate = withSuffix(name, counter)
    while (taken.has(candidate.toLowerCase())) {
      counter++
      candidate = withSuffix(name, counter)
    }

    taken.add(candidate.toLowerCase())
    return candidate
  })
}

/** Inserts " (n)" before the extension, so the file still opens as its type. */
function withSuffix(name: string, counter: number): string {
  const dot = name.lastIndexOf('.')
  // `dot <= 0` covers both "no extension" and a leading-dot name, where
  // everything after the dot is the name rather than a suffix.
  return dot <= 0
    ? `${name} (${counter})`
    : `${name.slice(0, dot)} (${counter})${name.slice(dot)}`
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npm run test:node -- exportNames`
Expected: PASS, 11 test.

- [ ] **Step 5: Pindahkan pemakaian lama**

Di `src/lib/exportShare.ts`, hapus definisi `toSafeFilename` (termasuk komentar `/** Strips characters Android/Windows reject in filenames. */` di atasnya). `exportShare.ts` sendiri tidak memakainya, jadi tidak perlu impor pengganti.

Di `src/lib/documentExport.ts`, ubah barisnya:

```ts
// sebelum
import { deliverExport, toSafeFilename, type DeliveryResult, type ExportFile } from './exportShare'

// sesudah
import { toSafeFilename } from './exportNames'
import { deliverExport, type DeliveryResult, type ExportFile } from './exportShare'
```

Di `src/lib/documentExport.test.ts`, tiruannya tidak lagi perlu menyediakan `toSafeFilename` — hapus barisnya sehingga tinggal:

```ts
vi.mock('./exportShare', () => ({
  deliverExport: async (files: { name: string; blob: Blob }[]) => {
    delivered.push(files.map((file) => ({ name: file.name })))
    return { message: `${files.length} file` }
  },
}))
```

- [ ] **Step 6: Jalankan SELURUH suite node**

Run: `npm run test:node`
Expected: PASS semuanya. Kalau ada test `documentExport` yang merah karena judul dokumennya sekarang melewati `toSafeFilename` sungguhan (yang tadinya identitas), perbaiki **ekspektasi test**-nya agar cocok dengan nama yang aman — jangan melonggarkan `toSafeFilename`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/exportNames.ts src/lib/exportNames.test.ts src/lib/exportShare.ts src/lib/documentExport.ts src/lib/documentExport.test.ts
git commit -m "refactor(ekspor): pisahkan logika nama berkas + cegah tabrakan nama di satu batch"
```

---

### Task 2: Pecah `exportShare` jadi tulis & bagikan

**Files:**
- Modify: `src/lib/exportShare.ts`
- Create: `src/lib/exportShare.test.ts`

**Interfaces:**
- Consumes: `ExportFile` (sudah ada di berkas ini)
- Produces:
  - `writeExportFiles(files: ExportFile[]): Promise<string[]>` — menulis tiap berkas, mengembalikan URI-nya (array kosong di web, karena unduhan browser tidak punya URI yang bisa dibagikan)
  - `shareFiles(uris: string[], title: string): Promise<void>` — tidak melempar; `uris` kosong = tidak melakukan apa-apa
  - `deliverExport(files: ExportFile[]): Promise<DeliveryResult>` — **perilaku tidak berubah**

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/lib/exportShare.test.ts`:

```ts
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
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm run test:node -- exportShare`
Expected: FAIL — `writeExportFiles is not a function` / `shareFiles is not a function`.

- [ ] **Step 3: Tulis implementasinya**

Ganti isi `src/lib/exportShare.ts` mulai dari `async function deliverNative` sampai akhir berkas dengan:

```ts
/**
 * Writes every file to the public Documents folder and returns the URI of
 * each, so a caller exporting many documents can save them one at a time and
 * open a single share sheet at the end rather than holding every blob in
 * memory at once.
 *
 * Returns an empty list on the web: a browser download has no URI anything
 * else could share.
 */
export async function writeExportFiles(files: ExportFile[]): Promise<string[]> {
  if (!Capacitor.isNativePlatform()) {
    downloadInBrowser(files)
    return []
  }

  await ensureStoragePermission()

  const uris: string[] = []
  for (const file of files) {
    await Filesystem.writeFile({
      path: file.name,
      directory: Directory.Documents,
      data: await blobToBase64(file.blob),
      recursive: true,
    })
    const { uri } = await Filesystem.getUri({
      path: file.name,
      directory: Directory.Documents,
    })
    uris.push(uri)
  }

  return uris
}

/**
 * Hands the saved files to another app. Never throws: by the time this runs
 * the files are already on disk, so a dismissed sheet is not a failed export.
 */
export async function shareFiles(uris: string[], title: string): Promise<void> {
  if (uris.length === 0) return

  try {
    // Sharing hands the user to another app; coming back from it is our doing,
    // not a return from elsewhere, so it must not earn an App Open ad.
    resumeTracker.leaveForOwnFlow()
    await Share.share({ title, files: uris })
  } catch {
    // Share sheet dismissed or unavailable — the saved files still stand.
  }
}

/** Browser fallback so the whole export flow can be reviewed via `npm run dev`. */
function downloadInBrowser(files: ExportFile[]): void {
  for (const file of files) {
    const url = URL.createObjectURL(file.blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

/** Where the files ended up, for the confirmation toast. */
function describeDelivery(files: ExportFile[], downloaded: boolean): string {
  if (downloaded) {
    return files.length === 1 ? `${files[0].name} diunduh.` : `${files.length} file diunduh.`
  }
  return files.length === 1
    ? `Tersimpan di folder Documents: ${files[0].name}`
    : `${files.length} file tersimpan di folder Documents.`
}

/**
 * Saves and shares in one go — the single-document export path, unchanged.
 *
 * Saved first, shared second: if the user dismisses the share sheet the file
 * is still on the device where they can find it.
 */
export async function deliverExport(files: ExportFile[]): Promise<DeliveryResult> {
  if (files.length === 0) throw new Error('Tidak ada file untuk diekspor.')

  const uris = await writeExportFiles(files)
  await shareFiles(uris, files.length === 1 ? files[0].name : 'Dokumen ScannApp')

  return { message: describeDelivery(files, uris.length === 0) }
}
```

Pastikan impor di atas berkas tetap: `Capacitor`, `Directory`, `Filesystem`, `Share`, `resumeTracker`, `blobToBase64`. Fungsi `ensureStoragePermission` yang sudah ada **tidak berubah**.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npm run test:node -- exportShare`
Expected: PASS, 9 test.

- [ ] **Step 5: Pastikan ekspor satuan tidak berubah**

Run: `npm run test:node`
Expected: PASS semuanya — khususnya `documentExport.test.ts`, yang menjaga jalur ekspor satuan.

- [ ] **Step 6: Commit**

```bash
git add src/lib/exportShare.ts src/lib/exportShare.test.ts
git commit -m "refactor(ekspor): pisahkan penulisan berkas dari share sheet"
```

---

### Task 3: Gerbang tier `canBatchExport`

**Files:**
- Modify: `src/lib/exportLimits.ts`
- Modify: `src/lib/exportLimits.test.ts`

**Interfaces:**
- Consumes: `Tier` dari `./tier`
- Produces: `canBatchExport(tier: Tier): boolean`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `src/lib/exportLimits.test.ts` (impor `canBatchExport` di baris impor yang sudah ada):

```ts
describe('canBatchExport', () => {
  it('lets Pro export several documents at once', () => {
    expect(canBatchExport('pro')).toBe(true)
  })

  /** PRD Bagian 3 — batch stayed Pro when reorder, filter and PNG moved out. */
  it('keeps it out of Basic', () => {
    expect(canBatchExport('basic')).toBe(false)
  })
})
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm run test:node -- exportLimits`
Expected: FAIL — `canBatchExport is not exported`.

- [ ] **Step 3: Tulis implementasinya**

Tambahkan di `src/lib/exportLimits.ts`, tepat di bawah `canChooseCompression`:

```ts
/**
 * Exporting several documents in one go is Pro (PRD Bagian 3).
 *
 * Unlike `resolveCompressionLevel`, which quietly hands Basic a lower level,
 * there is no lesser version of "export five documents" to fall back to — so
 * the batch path refuses outright rather than degrading.
 */
export function canBatchExport(tier: Tier): boolean {
  return tier === 'pro'
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npm run test:node -- exportLimits`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/exportLimits.ts src/lib/exportLimits.test.ts
git commit -m "feat(ekspor): gerbang tier untuk ekspor banyak dokumen"
```

---

### Task 4: Kalimat hasil batch (`summarizeBatchExport`)

**Files:**
- Modify: `src/lib/documentExport.ts`
- Create: `src/lib/batchExport.test.ts`

**Interfaces:**
- Consumes: tidak ada
- Produces:
  - `interface BatchProgress { index: number; total: number; title: string }`
  - `interface BatchExportResult { total: number; saved: string[]; failed: { title: string; message: string }[]; cancelled: boolean; message: string }`
  - `summarizeBatchExport(result: Omit<BatchExportResult, 'message'>): string`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/lib/batchExport.test.ts`. Tiruan di bawah ini juga dipakai Task 5, jadi tulis lengkap sekarang:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompressOptions } from './exportLimits'
import type { LocalScanDocument, ScanPage } from './scanIndexMigration'

vi.mock('./imageEditor', () => ({
  compressImage: async (blob: Blob, _options: CompressOptions) =>
    new Blob([`encoded:${await blob.text()}`]),
}))

vi.mock('./documentEditing', () => ({
  loadPageBlob: async (page: ScanPage) => new Blob([page.original]),
}))

vi.mock('./pdfExport', () => ({
  buildPdf: async () => new Uint8Array([1, 2, 3]),
}))

vi.mock('./blobBase64', () => ({
  blobToBytes: async () => new Uint8Array([1]),
}))

/** Titles whose write should blow up, so failure paths can be exercised. */
const failWrites = new Set<string>()
const written: string[] = []
const shared: { uris: string[]; title: string }[] = []

vi.mock('./exportShare', () => ({
  writeExportFiles: async (files: { name: string; blob: Blob }[]) => {
    for (const file of files) {
      if (failWrites.has(file.name)) throw new Error('Penyimpanan penuh.')
      written.push(file.name)
    }
    return files.map((file) => `file:///Documents/${file.name}`)
  },
  shareFiles: async (uris: string[], title: string) => {
    shared.push({ uris, title })
  },
  deliverExport: async () => ({ message: 'tidak dipakai di test ini' }),
}))

const { exportDocumentsBatch, summarizeBatchExport } = await import('./documentExport')

function doc(id: string, title: string, pageCount = 1): LocalScanDocument {
  return {
    schemaVersion: 4,
    id,
    title,
    createdAt: '2026-08-25T00:00:00.000Z',
    pageCount,
    pages: Array.from({ length: pageCount }, (_, i) => ({ original: `${id}/page-${i + 1}.jpg` })),
  }
}

beforeEach(() => {
  failWrites.clear()
  written.length = 0
  shared.length = 0
})

describe('summarizeBatchExport', () => {
  it('names the folder when everything worked', () => {
    const message = summarizeBatchExport({
      total: 3,
      saved: ['A.pdf', 'B.pdf', 'C.pdf'],
      failed: [],
      cancelled: false,
    })

    expect(message).toBe('3 dokumen diekspor ke folder Documents.')
  })

  it('counts both sides when some failed', () => {
    const message = summarizeBatchExport({
      total: 5,
      saved: ['A.pdf', 'B.pdf', 'C.pdf', 'D.pdf'],
      failed: [{ title: 'E', message: 'Penyimpanan penuh.' }],
      cancelled: false,
    })

    expect(message).toBe('4 dokumen diekspor, 1 gagal. Coba lagi untuk sisanya.')
  })

  it('says plainly when nothing landed', () => {
    const message = summarizeBatchExport({
      total: 2,
      saved: [],
      failed: [
        { title: 'A', message: 'x' },
        { title: 'B', message: 'y' },
      ],
      cancelled: false,
    })

    expect(message).toBe(
      'Tidak ada dokumen yang berhasil diekspor. Periksa ruang penyimpanan lalu coba lagi.',
    )
  })

  /** The stop button promises exactly this: finish the current one, then halt. */
  it('reports how far a stopped run got', () => {
    const message = summarizeBatchExport({
      total: 5,
      saved: ['A.pdf', 'B.pdf'],
      failed: [],
      cancelled: true,
    })

    expect(message).toBe('Dihentikan — 2 dari 5 dokumen tersimpan.')
  })

  it('handles a stop before anything was written', () => {
    const message = summarizeBatchExport({ total: 5, saved: [], failed: [], cancelled: true })

    expect(message).toBe('Dihentikan sebelum ada dokumen yang tersimpan.')
  })
})
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm run test:node -- batchExport`
Expected: FAIL — `summarizeBatchExport is not a function` (dan `exportDocumentsBatch is not a function`; itu wajar, diisi di Task 5).

- [ ] **Step 3: Tulis implementasinya**

Tambahkan di `src/lib/documentExport.ts`, di bawah `export type ExportFormat`:

```ts
/** Which document a running batch is on, for the sheet's progress line. */
export interface BatchProgress {
  /** 0-based. */
  index: number
  total: number
  title: string
}

export interface BatchExportResult {
  /** How many were asked for — not the same as saved + failed once stopped. */
  total: number
  /** Filenames actually written, in order. */
  saved: string[]
  failed: { title: string; message: string }[]
  cancelled: boolean
  /** Ready-to-toast Indonesian summary. */
  message: string
}

/**
 * Turns a finished batch into the one sentence the user sees.
 *
 * Split out from the run itself so every wording can be tested without
 * encoding a single page.
 */
export function summarizeBatchExport(result: Omit<BatchExportResult, 'message'>): string {
  const saved = result.saved.length
  const failed = result.failed.length

  if (result.cancelled) {
    return saved === 0
      ? 'Dihentikan sebelum ada dokumen yang tersimpan.'
      : `Dihentikan — ${saved} dari ${result.total} dokumen tersimpan.`
  }

  if (saved === 0) {
    return failed === 0
      ? 'Tidak ada dokumen yang diekspor.'
      : 'Tidak ada dokumen yang berhasil diekspor. Periksa ruang penyimpanan lalu coba lagi.'
  }

  if (failed > 0) {
    return `${saved} dokumen diekspor, ${failed} gagal. Coba lagi untuk sisanya.`
  }

  return `${saved} dokumen diekspor ke folder Documents.`
}
```

- [ ] **Step 4: Jalankan test, pastikan blok `summarizeBatchExport` LULUS**

Run: `npm run test:node -- batchExport`
Expected: lima test `summarizeBatchExport` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentExport.ts src/lib/batchExport.test.ts
git commit -m "feat(ekspor): rakit kalimat hasil ekspor batch"
```

---

### Task 5: `exportDocumentsBatch`

**Files:**
- Modify: `src/lib/documentExport.ts`
- Modify: `src/lib/batchExport.test.ts`

**Interfaces:**
- Consumes: `uniqueExportNames`, `toSafeFilename` (Task 1); `writeExportFiles`, `shareFiles` (Task 2); `canBatchExport` (Task 3); `summarizeBatchExport`, `BatchProgress`, `BatchExportResult` (Task 4)
- Produces:
  ```ts
  exportDocumentsBatch(
    docs: LocalScanDocument[],
    tier: Tier,
    level?: CompressionLevel,
    onProgress?: (progress: BatchProgress) => void,
    signal?: AbortSignal,
  ): Promise<BatchExportResult>
  ```

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `src/lib/batchExport.test.ts`:

```ts
describe('exportDocumentsBatch', () => {
  it('writes one PDF per document, named after its title', async () => {
    const result = await exportDocumentsBatch(
      [doc('a', 'Kwitansi Agustus'), doc('b', 'Kontrak Sewa')],
      'pro',
    )

    expect(written).toEqual(['Kwitansi Agustus.pdf', 'Kontrak Sewa.pdf'])
    expect(result.saved).toEqual(['Kwitansi Agustus.pdf', 'Kontrak Sewa.pdf'])
    expect(result.failed).toEqual([])
  })

  /**
   * The gate lives here rather than only on the button: a hidden control is
   * not a refused one (same lesson as `resolveCompressionLevel`).
   */
  it('refuses Basic outright', async () => {
    await expect(exportDocumentsBatch([doc('a', 'Nota')], 'basic')).rejects.toThrow(
      'Ekspor banyak dokumen sekaligus hanya untuk akun Pro.',
    )

    expect(written).toEqual([])
  })

  it('refuses an empty selection', async () => {
    await expect(exportDocumentsBatch([], 'pro')).rejects.toThrow(
      'Tidak ada dokumen untuk diekspor.',
    )
  })

  /** Two documents can share a title; the second must not overwrite the first. */
  it('numbers a repeated title instead of overwriting it', async () => {
    const result = await exportDocumentsBatch([doc('a', 'Nota'), doc('b', 'Nota')], 'pro')

    expect(result.saved).toEqual(['Nota.pdf', 'Nota (2).pdf'])
  })

  it('opens one share sheet at the end, not one per document', async () => {
    await exportDocumentsBatch([doc('a', 'A'), doc('b', 'B')], 'pro')

    expect(shared).toHaveLength(1)
    expect(shared[0].uris).toEqual(['file:///Documents/A.pdf', 'file:///Documents/B.pdf'])
  })

  /** One unreadable document must not keep the rest off the phone. */
  it('carries on past a failure and reports it', async () => {
    failWrites.add('B.pdf')

    const result = await exportDocumentsBatch(
      [doc('a', 'A'), doc('b', 'B'), doc('c', 'C')],
      'pro',
    )

    expect(result.saved).toEqual(['A.pdf', 'C.pdf'])
    expect(result.failed).toEqual([{ title: 'B', message: 'Penyimpanan penuh.' }])
    expect(result.message).toBe('2 dokumen diekspor, 1 gagal. Coba lagi untuk sisanya.')
  })

  it('shares only the documents that made it', async () => {
    failWrites.add('B.pdf')

    await exportDocumentsBatch([doc('a', 'A'), doc('b', 'B')], 'pro')

    expect(shared[0].uris).toEqual(['file:///Documents/A.pdf'])
  })

  it('skips the share sheet entirely when nothing was written', async () => {
    failWrites.add('A.pdf')

    await exportDocumentsBatch([doc('a', 'A')], 'pro')

    expect(shared).toHaveLength(0)
  })

  it('reports progress before each document, not after', async () => {
    const seen: BatchProgress[] = []

    await exportDocumentsBatch([doc('a', 'A'), doc('b', 'B')], 'pro', 'standard', (progress) =>
      seen.push(progress),
    )

    expect(seen).toEqual([
      { index: 0, total: 2, title: 'A' },
      { index: 1, total: 2, title: 'B' },
    ])
  })

  /**
   * Stopping is checked between documents, never inside one: aborting midway
   * through a PDF would leave half a file in the Documents folder.
   */
  it('stops between documents once aborted, finishing the one in flight', async () => {
    const controller = new AbortController()

    const result = await exportDocumentsBatch(
      [doc('a', 'A'), doc('b', 'B'), doc('c', 'C')],
      'pro',
      'standard',
      (progress) => {
        if (progress.index === 0) controller.abort()
      },
      controller.signal,
    )

    expect(result.saved).toEqual(['A.pdf'])
    expect(result.cancelled).toBe(true)
    expect(result.message).toBe('Dihentikan — 1 dari 3 dokumen tersimpan.')
  })

  it('still shares what it managed to write before stopping', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await exportDocumentsBatch(
      [doc('a', 'A')],
      'pro',
      'standard',
      undefined,
      controller.signal,
    )

    expect(result.saved).toEqual([])
    expect(result.cancelled).toBe(true)
    expect(shared).toHaveLength(0)
  })
})
```

Tambahkan `BatchProgress` ke impor tipe di atas berkas:

```ts
import type { BatchProgress } from './documentExport'
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm run test:node -- batchExport`
Expected: FAIL — `exportDocumentsBatch is not a function`.

- [ ] **Step 3: Tulis implementasinya**

Di `src/lib/documentExport.ts`, tambahkan impor:

```ts
import { toSafeFilename, uniqueExportNames } from './exportNames'
import { canBatchExport, /* …yang sudah ada… */ } from './exportLimits'
import { deliverExport, shareFiles, writeExportFiles, type DeliveryResult, type ExportFile } from './exportShare'
```

Lalu tambahkan di akhir berkas:

```ts
/**
 * Exports several documents as one PDF each.
 *
 * Sequential, and each PDF is written to disk before the next is built. The
 * same reasoning as `handleRestoreAll`: this is not work that gets faster by
 * being piled up, and piling it up means holding every PDF in memory at once
 * — a 20-page document peaks around 16 MB, so five of them together is the
 * kind of allocation that made the editor stutter on a real phone.
 *
 * The share sheet opens once, at the end, with whatever actually landed.
 */
export async function exportDocumentsBatch(
  docs: LocalScanDocument[],
  tier: Tier,
  level: CompressionLevel = DEFAULT_COMPRESSION_LEVEL,
  onProgress?: (progress: BatchProgress) => void,
  signal?: AbortSignal,
): Promise<BatchExportResult> {
  if (!canBatchExport(tier)) {
    throw new Error('Ekspor banyak dokumen sekaligus hanya untuk akun Pro.')
  }
  if (docs.length === 0) {
    throw new Error('Tidak ada dokumen untuk diekspor.')
  }

  const options = COMPRESSION_PRESETS[resolveCompressionLevel(tier, level)]
  // Decided up front, because only this function can see the whole batch:
  // `exportPdf` names one document at a time and cannot know another document
  // in the same run reduces to the same filename.
  const names = uniqueExportNames(docs.map((doc) => `${toSafeFilename(doc.title)}.pdf`))

  const saved: string[] = []
  const failed: { title: string; message: string }[] = []
  const uris: string[] = []
  let cancelled = false

  for (let index = 0; index < docs.length; index++) {
    // Checked between documents, never inside one: stopping midway through a
    // PDF would leave a half-written file in the Documents folder.
    if (signal?.aborted) {
      cancelled = true
      break
    }

    const doc = docs[index]
    onProgress?.({ index, total: docs.length, title: doc.title })

    try {
      const [built] = await exportPdf(doc, tier, options)
      uris.push(...(await writeExportFiles([{ ...built, name: names[index] }])))
      saved.push(names[index])
    } catch (error) {
      // Counted, not thrown: one unreadable document must not keep the rest
      // off the phone.
      failed.push({
        title: doc.title,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  await shareFiles(uris, 'Dokumen ScannApp')

  const outcome = { total: docs.length, saved, failed, cancelled }
  return { ...outcome, message: summarizeBatchExport(outcome) }
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npm run test:node -- batchExport`
Expected: PASS, 16 test.

- [ ] **Step 5: Buktikan test-nya menggigit**

Sabotase satu per satu, jalankan `npm run test:node -- batchExport`, pastikan **merah**, lalu kembalikan:

1. Ganti `if (!canBatchExport(tier))` jadi `if (false)` → test "refuses Basic outright" harus merah.
2. Ganti `uniqueExportNames(...)` jadi `docs.map((doc) => \`${toSafeFilename(doc.title)}.pdf\`)` → test "numbers a repeated title" harus merah.
3. Pindahkan `await shareFiles(...)` ke dalam loop → test "opens one share sheet at the end" harus merah.

Kalau ada yang **tidak** merah, test-nya tidak menjaga apa yang dikiranya — perbaiki test-nya dulu sebelum lanjut.

- [ ] **Step 6: Commit**

```bash
git add src/lib/documentExport.ts src/lib/batchExport.test.ts
git commit -m "feat(ekspor): ekspor banyak dokumen jadi PDF sekaligus (Pro)"
```

---

### Task 6: Logika seleksi (`documentSelection.ts`)

**Files:**
- Create: `src/lib/documentSelection.ts`
- Create: `src/lib/documentSelection.test.ts`

**Interfaces:**
- Consumes: `DocumentEntry` dari `./documentEntries`, `LocalScanDocument` dari `./scanStorage`
- Produces:
  - `LONG_PRESS_MS: number` (450), `LONG_PRESS_MOVE_PX: number` (10)
  - `isSelectable(entry: DocumentEntry): boolean`
  - `toggleSelection(selected: string[], id: string): string[]`
  - `interface SelectionSummary { count: number; pageCount: number; documents: LocalScanDocument[] }`
  - `summarizeSelection(entries: DocumentEntry[], selected: string[]): SelectionSummary`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/lib/documentSelection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DocumentEntry } from './documentEntries'
import { isSelectable, summarizeSelection, toggleSelection } from './documentSelection'
import type { LocalScanDocument } from './scanIndexMigration'

function local(id: string, pageCount: number): DocumentEntry {
  const document: LocalScanDocument = {
    schemaVersion: 4,
    id,
    title: id,
    createdAt: '2026-08-25T00:00:00.000Z',
    pageCount,
    pages: Array.from({ length: pageCount }, (_, i) => ({ original: `${id}/page-${i + 1}.jpg` })),
  }
  return { kind: 'local', id, document }
}

function cloud(id: string): DocumentEntry {
  return {
    kind: 'cloud',
    id,
    backup: {
      id,
      title: id,
      createdAt: '2026-08-25T00:00:00.000Z',
      pageCount: 4,
      sizeBytes: 1024,
    },
  }
}

describe('isSelectable', () => {
  it('accepts a document that is on the phone', () => {
    expect(isSelectable(local('a', 2))).toBe(true)
  })

  /** A cloud row has no page files here — nothing to export and nothing to delete. */
  it('rejects a cloud-only row', () => {
    expect(isSelectable(cloud('b'))).toBe(false)
  })
})

describe('toggleSelection', () => {
  it('adds an id that was not selected', () => {
    expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('removes an id that was', () => {
    expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b'])
  })

  it('leaves the original array untouched', () => {
    const before = ['a']
    toggleSelection(before, 'b')
    expect(before).toEqual(['a'])
  })
})

describe('summarizeSelection', () => {
  it('counts documents and their pages', () => {
    const summary = summarizeSelection([local('a', 2), local('b', 5)], ['a', 'b'])

    expect(summary.count).toBe(2)
    expect(summary.pageCount).toBe(7)
  })

  /**
   * The list refreshes underneath the selection — a backup landing, a delete
   * finishing. A stale id must not reach the exporter as a hole in the array.
   */
  it('drops ids that no longer resolve', () => {
    const summary = summarizeSelection([local('a', 2)], ['a', 'gone'])

    expect(summary.count).toBe(1)
    expect(summary.documents.map((doc) => doc.id)).toEqual(['a'])
  })

  it('drops a cloud row even if its id was somehow selected', () => {
    const summary = summarizeSelection([local('a', 2), cloud('b')], ['a', 'b'])

    expect(summary.count).toBe(1)
    expect(summary.pageCount).toBe(2)
  })

  it('keeps the order the user selected in', () => {
    const summary = summarizeSelection([local('a', 1), local('b', 1)], ['b', 'a'])

    expect(summary.documents.map((doc) => doc.id)).toEqual(['b', 'a'])
  })

  it('reports zero for an empty selection', () => {
    const summary = summarizeSelection([local('a', 3)], [])

    expect(summary).toEqual({ count: 0, pageCount: 0, documents: [] })
  })
})
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm run test:node -- documentSelection`
Expected: FAIL — `Failed to resolve import "./documentSelection"`.

- [ ] **Step 3: Tulis implementasinya**

Buat `src/lib/documentSelection.ts`:

```ts
import type { DocumentEntry } from './documentEntries'
import type { LocalScanDocument } from './scanStorage'

/**
 * How long a finger has to rest on a row before it becomes a selection.
 *
 * Exported so the component test can wait exactly this long rather than
 * guessing, and so the value has one definition rather than two.
 */
export const LONG_PRESS_MS = 450

/** Movement past this many pixels is a scroll, not a press. */
export const LONG_PRESS_MOVE_PX = 10

/**
 * Only documents that are on this phone can take part in a bulk action — a
 * cloud row has no page files here, so there is nothing to export and nothing
 * to delete.
 */
export function isSelectable(entry: DocumentEntry): boolean {
  return entry.kind === 'local'
}

/** Adds or removes one id, never mutating the array it was handed. */
export function toggleSelection(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id]
}

export interface SelectionSummary {
  count: number
  pageCount: number
  /** In the order the user selected them. */
  documents: LocalScanDocument[]
}

/**
 * Resolves selected ids against the list as it stands right now.
 *
 * Ids that no longer resolve are dropped rather than trusted: the list
 * refreshes underneath the selection whenever a backup lands or a delete
 * finishes, and handing a stale id to the exporter would put a hole in the
 * array it iterates.
 */
export function summarizeSelection(
  entries: DocumentEntry[],
  selected: string[],
): SelectionSummary {
  const onPhone = new Map(
    entries.flatMap((entry) =>
      entry.kind === 'local' ? [[entry.id, entry.document] as const] : [],
    ),
  )

  const documents = selected.flatMap((id) => {
    const document = onPhone.get(id)
    return document ? [document] : []
  })

  return {
    count: documents.length,
    pageCount: documents.reduce((sum, document) => sum + document.pageCount, 0),
    documents,
  }
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npm run test:node -- documentSelection`
Expected: PASS, 11 test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/documentSelection.ts src/lib/documentSelection.test.ts
git commit -m "feat(dokumen): logika seleksi banyak dokumen"
```

---

### Task 7: Keluarkan `CompressionField` dari `ExportSheet`

Pemindahan murni — tidak ada perilaku yang berubah. Tujuannya supaya lembar batch (Task 8) memakai slider yang sama persis, bukan salinannya.

**Files:**
- Create: `src/components/CompressionField.tsx`
- Modify: `src/components/ExportSheet.tsx`

**Interfaces:**
- Consumes: `CompressionLevel`, `COMPRESSION_LEVELS`, `COMPRESSION_LABELS`, `COMPRESSION_HINTS`, `canChooseCompression`, `resolveCompressionLevel` — semua sudah ada di `exportLimits`
- Produces:
  ```ts
  interface CompressionFieldProps {
    tier: Tier
    level: CompressionLevel
    isBusy: boolean
    onLevelChange: (level: CompressionLevel) => void
    onUpgrade: () => void
  }
  function CompressionField(props: CompressionFieldProps): JSX.Element
  ```

- [ ] **Step 1: Buat komponennya**

Buat `src/components/CompressionField.tsx` dengan **isi persis** blok `<div className="export-quality">` yang sekarang ada di `ExportSheet.tsx` (termasuk seluruh komentarnya — komentar itu menjelaskan kenapa `resolveCompressionLevel` dipanggil di UI dan kenapa Basic melihat kontrolnya, jangan dibuang):

```tsx
import type { CSSProperties } from 'react'
import {
  canChooseCompression,
  COMPRESSION_HINTS,
  COMPRESSION_LABELS,
  COMPRESSION_LEVELS,
  resolveCompressionLevel,
  type CompressionLevel,
} from '../lib/exportLimits'
import type { Tier } from '../lib/tier'

interface CompressionFieldProps {
  tier: Tier
  level: CompressionLevel
  isBusy: boolean
  onLevelChange: (level: CompressionLevel) => void
  onUpgrade: () => void
}

/**
 * The four-stop quality slider, shared by the single-document export sheet and
 * the batch one so the two can never drift apart.
 */
export function CompressionField({
  tier,
  level,
  isBusy,
  onLevelChange,
  onUpgrade,
}: CompressionFieldProps) {
  const canChoose = canChooseCompression(tier)
  /*
    Shown through the same gate the export runs through. A remembered 'max'
    outlives the Pro subscription that chose it — and another account on the
    same phone inherits it — so displaying the stored value raw would label the
    slider "Maksimal" while the file, and the estimate beside it, came out at
    Standar.
  */
  const effective = resolveCompressionLevel(tier, level)
  const position = COMPRESSION_LEVELS.indexOf(effective)

  return (
    <div className="export-quality">
      <div className="export-quality__head">
        <strong>Kualitas</strong>
        <span className="export-quality__value">{COMPRESSION_LABELS[effective]}</span>
      </div>

      {/*
        `--fill` colours the track up to the thumb: a uniformly grey bar
        reads as a setting that is off rather than one sitting at a level.
      */}
      <input
        type="range"
        className="export-quality__slider"
        min={0}
        max={COMPRESSION_LEVELS.length - 1}
        step={1}
        value={position}
        disabled={!canChoose || isBusy}
        onChange={(event) => onLevelChange(COMPRESSION_LEVELS[Number(event.target.value)])}
        aria-label="Kualitas ekspor"
        aria-valuetext={COMPRESSION_LABELS[effective]}
        style={
          {
            '--fill': `${(position / (COMPRESSION_LEVELS.length - 1)) * 100}%`,
          } as CSSProperties
        }
      />

      <div className="export-quality__ticks" aria-hidden="true">
        {COMPRESSION_LEVELS.map((step) => (
          <span
            key={step}
            className={`export-quality__tick${step === effective ? ' export-quality__tick--on' : ''}`}
          >
            {COMPRESSION_LABELS[step]}
          </span>
        ))}
      </div>

      <p className="export-quality__hint">{COMPRESSION_HINTS[effective]}</p>

      {/*
        Basic sees the real control rather than a hidden one, so the thing
        Pro buys is visible instead of merely described.
      */}
      {!canChoose && (
        <button type="button" className="export-quality__lock" onClick={onUpgrade} disabled={isBusy}>
          <span className="pro-badge">Pro</span>
          Atur sendiri kualitas & ukuran berkas
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Pakai di `ExportSheet`**

Di `src/components/ExportSheet.tsx`:
- Hapus seluruh blok `<div className="export-quality">…</div>` beserta komentar `{/* Quality sits above the formats… */}` di atasnya, ganti dengan:

```tsx
{/*
  Quality sits above the formats because tapping a format exports
  immediately — by then the choice has to already be made.
*/}
<CompressionField
  tier={tier}
  level={level}
  isBusy={isBusy}
  onLevelChange={onLevelChange}
  onUpgrade={onUpgrade}
/>
```

- Hapus `const canChoose = …` dan `const effective = …` dan `const position = …` beserta komentar besar di atas `effective` (sudah pindah ke komponen baru). **Pertahankan** `const watermarked = shouldWatermark(tier)` — masih dipakai baris PDF.
- Rapikan impor: buang `canChooseCompression`, `COMPRESSION_HINTS`, `COMPRESSION_LABELS`, `COMPRESSION_LEVELS`, `resolveCompressionLevel`, dan `CSSProperties` kalau tidak lagi terpakai; tambahkan `import { CompressionField } from './CompressionField'`.

- [ ] **Step 3: Pastikan tidak ada yang berubah**

Run: `npm run lint`
Expected: bersih — tidak ada impor menganggur.

Run: `npm run build`
Expected: sukses, tanpa error TypeScript.

Run: `npm test`
Expected: 453 test PASS — jumlahnya **sama persis** seperti sebelum task ini. Pemindahan yang benar tidak menambah maupun mengurangi test.

- [ ] **Step 4: Commit**

```bash
git add src/components/CompressionField.tsx src/components/ExportSheet.tsx
git commit -m "refactor(ekspor): keluarkan slider kualitas jadi komponen sendiri"
```

---

### Task 8: `BatchExportSheet`

**Files:**
- Create: `src/components/BatchExportSheet.tsx`
- Create: `src/components/BatchExportSheet.browser.test.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `CompressionField` (Task 7), `BatchProgress` (Task 4), `CompressionLevel`
- Produces:
  ```ts
  interface BatchExportSheetProps {
    count: number
    pageCount: number
    tier: Tier
    level: CompressionLevel
    progress: BatchProgress | null
    isBusy: boolean
    onLevelChange: (level: CompressionLevel) => void
    onExport: () => void
    onStop: () => void
    onClose: () => void
  }
  function BatchExportSheet(props: BatchExportSheetProps): JSX.Element
  ```

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/components/BatchExportSheet.browser.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { BatchExportSheet } from './BatchExportSheet'

async function renderSheet(overrides: Partial<Parameters<typeof BatchExportSheet>[0]> = {}) {
  return await render(
    <BatchExportSheet
      count={3}
      pageCount={17}
      tier="pro"
      level="standard"
      progress={null}
      isBusy={false}
      onLevelChange={() => {}}
      onExport={() => {}}
      onStop={() => {}}
      onClose={() => {}}
      {...overrides}
    />,
  )
}

describe('BatchExportSheet before it runs', () => {
  it('says how much is about to be exported', async () => {
    const screen = await renderSheet()

    await expect.element(screen.getByText('3 dokumen · 17 halaman')).toBeVisible()
  })

  it('exports when asked', async () => {
    const onExport = vi.fn()
    const screen = await renderSheet({ onExport })

    await screen.getByRole('button', { name: 'Ekspor 3 PDF' }).click()

    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('offers no stop button while nothing is running', async () => {
    const screen = await renderSheet()

    expect(screen.container.querySelector('[data-testid="batch-stop"]')).toBeNull()
  })
})

describe('BatchExportSheet while it runs', () => {
  it('names the document it is on and how far along it is', async () => {
    const screen = await renderSheet({
      isBusy: true,
      progress: { index: 1, total: 3, title: 'Kontrak Sewa' },
    })

    await expect.element(screen.getByText('Kontrak Sewa')).toBeVisible()
    await expect.element(screen.getByText('2 dari 3')).toBeVisible()
  })

  it('swaps the export button for a stop button', async () => {
    const onStop = vi.fn()
    const screen = await renderSheet({
      isBusy: true,
      progress: { index: 0, total: 3, title: 'A' },
    })

    await screen.getByRole('button', { name: 'Hentikan' }).click()
    expect(screen.container.querySelector('[data-testid="batch-export"]')).toBeNull()
  })

  /**
   * Closing mid-run would leave the run going with nothing on screen to stop
   * it, and the toast would arrive over an unrelated screen.
   */
  it('locks the close button so a run cannot be abandoned', async () => {
    const screen = await renderSheet({
      isBusy: true,
      progress: { index: 0, total: 3, title: 'A' },
    })

    await expect.element(screen.getByRole('button', { name: 'Tutup' })).toBeDisabled()
  })
})

describe('BatchExportSheet for a Basic account', () => {
  /**
   * The button that opened this sheet is gated, but the slider inside it is a
   * second gate on a different thing — quality control, which Basic never gets.
   */
  it('shows the Pro lock on the quality control', async () => {
    const screen = await renderSheet({ tier: 'basic' })

    await expect
      .element(screen.getByRole('button', { name: /Atur sendiri kualitas/ }))
      .toBeVisible()
  })
})
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm run test:browser -- BatchExportSheet`
Expected: FAIL — `Failed to resolve import "./BatchExportSheet"`.

- [ ] **Step 3: Tulis komponennya**

Buat `src/components/BatchExportSheet.tsx`:

```tsx
import { CloseIcon, ExportIcon } from './Icons'
import { CompressionField } from './CompressionField'
import type { BatchProgress } from '../lib/documentExport'
import type { CompressionLevel } from '../lib/exportLimits'
import type { Tier } from '../lib/tier'

interface BatchExportSheetProps {
  count: number
  pageCount: number
  tier: Tier
  level: CompressionLevel
  /** Null until the run starts, and again once it ends. */
  progress: BatchProgress | null
  isBusy: boolean
  onLevelChange: (level: CompressionLevel) => void
  onExport: () => void
  onStop: () => void
  onClose: () => void
}

/**
 * The batch counterpart of `ExportSheet`.
 *
 * Deliberately narrower than that one: PDF only, and no size estimate. The
 * single-document sheet takes about 1.2 s to measure one document on a real
 * phone, so measuring a selection of five would leave this sheet blank for six
 * seconds before it could show anything at all.
 */
export function BatchExportSheet({
  count,
  pageCount,
  tier,
  level,
  progress,
  isBusy,
  onLevelChange,
  onExport,
  onStop,
  onClose,
}: BatchExportSheetProps) {
  return (
    <div className="sheet-backdrop" onClick={isBusy ? undefined : onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="Ekspor banyak dokumen"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet__head">
          <div>
            <h2>Ekspor Banyak Dokumen</h2>
            <p>
              {count} dokumen · {pageCount} halaman
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={isBusy}
            aria-label="Tutup"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <CompressionField
          tier={tier}
          level={level}
          isBusy={isBusy}
          onLevelChange={onLevelChange}
          /*
            Nothing to upgrade to from here: the button that opened this sheet
            is already Pro-only, so a Basic account cannot reach it. The lock
            row still renders for the tier check's own sake, and closing is the
            honest thing for it to do.
          */
          onUpgrade={onClose}
        />

        <p className="batch-note">
          Setiap dokumen jadi satu berkas PDF di folder Documents.
        </p>

        {progress ? (
          <div className="batch-progress">
            <div className="batch-progress__head">
              <strong>{progress.title}</strong>
              <span>
                {progress.index + 1} dari {progress.total}
              </span>
            </div>
            <div className="batch-progress__track">
              <span
                className="batch-progress__fill"
                style={{ width: `${((progress.index + 1) / progress.total) * 100}%` }}
              />
            </div>
          </div>
        ) : null}

        {isBusy ? (
          <button
            type="button"
            className="button"
            data-testid="batch-stop"
            onClick={onStop}
          >
            <span>Hentikan</span>
          </button>
        ) : (
          <button
            type="button"
            className="button button--primary"
            data-testid="batch-export"
            onClick={onExport}
          >
            <ExportIcon size={17} />
            <span>Ekspor {count} PDF</span>
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Tambahkan gayanya**

Tambahkan di akhir `src/App.css` — **tanpa warna baru**, semuanya token yang sudah ada:

```css
/* Batch export sheet
   ------------------------------------------------------------------ */

.batch-note {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--muted);
}

.batch-progress {
  margin-bottom: 14px;
}

.batch-progress__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 14px;
}

/* Long titles must not push the counter off the row. */
.batch-progress__head strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-progress__head span {
  flex-shrink: 0;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.batch-progress__track {
  height: 6px;
  border-radius: 3px;
  background: var(--track);
  overflow: hidden;
}

.batch-progress__fill {
  display: block;
  height: 100%;
  background: var(--primary);
  transition: width 180ms ease-out;
}
```

Kalau `--track` atau `--muted` ternyata tidak ada di `src/theme/themes.ts`, **jangan mengarang nilai baru** — pakai token yang memang ada untuk peran itu (lihat `.export-quality__slider` di `App.css` untuk contoh trek yang sudah dipakai).

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Run: `npm run test:browser -- BatchExportSheet`
Expected: PASS, 7 test.

- [ ] **Step 6: Commit**

```bash
git add src/components/BatchExportSheet.tsx src/components/BatchExportSheet.browser.test.tsx src/App.css
git commit -m "feat(ekspor): lembar ekspor banyak dokumen"
```

---

### Task 9: Mode pilih di `DocumentsScreen`

**Files:**
- Modify: `src/screens/DocumentsScreen.tsx`
- Create: `src/screens/DocumentsScreen.browser.test.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `LONG_PRESS_MS`, `LONG_PRESS_MOVE_PX`, `isSelectable`, `summarizeSelection` (Task 6); `canBatchExport` (Task 3)
- Produces: prop baru pada `DocumentsScreen` —
  ```ts
  tier: Tier
  selectMode: boolean
  selectedIds: string[]
  isBatchBusy: boolean
  onEnterSelect: (id: string) => void
  onToggleSelect: (id: string) => void
  onExitSelect: () => void
  onBatchExport: () => void
  onBatchDelete: () => void
  onUpgrade: () => void
  onNotice: (message: string) => void
  ```

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/screens/DocumentsScreen.browser.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { DocumentsScreen } from './DocumentsScreen'
import type { DocumentEntry } from '../lib/documentEntries'
import { LONG_PRESS_MS } from '../lib/documentSelection'
import type { LocalScanDocument } from '../lib/scanIndexMigration'

function local(id: string, title: string): DocumentEntry {
  const document: LocalScanDocument = {
    schemaVersion: 4,
    id,
    title,
    createdAt: '2026-08-25T00:00:00.000Z',
    pageCount: 2,
    pages: [{ original: `${id}/page-1.jpg` }, { original: `${id}/page-2.jpg` }],
  }
  return { kind: 'local', id, document }
}

function cloud(id: string, title: string): DocumentEntry {
  return {
    kind: 'cloud',
    id,
    backup: { id, title, createdAt: '2026-08-25T00:00:00.000Z', pageCount: 3, sizeBytes: 2048 },
  }
}

const entries = [local('a', 'Kwitansi Agustus'), cloud('b', 'Kontrak Lama')]

async function renderScreen(overrides: Partial<Parameters<typeof DocumentsScreen>[0]> = {}) {
  return await render(
    <DocumentsScreen
      entries={entries}
      tier="pro"
      restoringId={null}
      isRestoringAll={false}
      selectMode={false}
      selectedIds={[]}
      isBatchBusy={false}
      onDelete={() => {}}
      onOpen={() => {}}
      onRestore={() => {}}
      onRestoreAll={() => {}}
      onMerge={() => {}}
      onEnterSelect={() => {}}
      onToggleSelect={() => {}}
      onExitSelect={() => {}}
      onBatchExport={() => {}}
      onBatchDelete={() => {}}
      onUpgrade={() => {}}
      onNotice={() => {}}
      {...overrides}
    />,
  )
}

/** Holds a finger on the row long enough for the long press to fire. */
async function longPress(element: Element) {
  element.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }),
  )
  await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 120))
  element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }))
}

describe('entering select mode', () => {
  it('enters on a long press of a local document', async () => {
    const onEnterSelect = vi.fn()
    const screen = await renderScreen({ onEnterSelect })

    await longPress(screen.getByText('Kwitansi Agustus').element())

    expect(onEnterSelect).toHaveBeenCalledWith('a')
  })

  /**
   * The bug this locks out. A long press is followed by a real `click` from
   * the same finger — without swallowing it, selecting a document also opened
   * it, and the user landed on the detail screen instead of a selection.
   */
  it('swallows the click that follows the press, so the document does not open', async () => {
    const onOpen = vi.fn()
    const screen = await renderScreen({ onOpen })
    const row = screen.getByText('Kwitansi Agustus').element()

    await longPress(row)
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('opens the document on a plain tap, with no long press involved', async () => {
    const onOpen = vi.fn()
    const screen = await renderScreen({ onOpen })

    await screen.getByText('Kwitansi Agustus').click()

    expect(onOpen).toHaveBeenCalledWith('a')
  })

  /** A cloud row has no pages on this phone, so there is nothing to act on. */
  it('says why a cloud row cannot be selected instead of doing nothing', async () => {
    const onEnterSelect = vi.fn()
    const onNotice = vi.fn()
    const screen = await renderScreen({ onEnterSelect, onNotice })

    await longPress(screen.getByText('Kontrak Lama').element())

    expect(onEnterSelect).not.toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledWith('Pulihkan dulu ke HP sebelum bisa dipilih.')
  })
})

describe('the action bar', () => {
  it('stays hidden while nothing is selected', async () => {
    const screen = await renderScreen({ selectMode: true, selectedIds: [] })

    expect(screen.container.querySelector('.select-bar')).toBeNull()
  })

  it('counts what is selected', async () => {
    const screen = await renderScreen({ selectMode: true, selectedIds: ['a'] })

    await expect.element(screen.getByText('1 dipilih · 2 halaman')).toBeVisible()
  })

  it('exports when Pro asks it to', async () => {
    const onBatchExport = vi.fn()
    const screen = await renderScreen({
      selectMode: true,
      selectedIds: ['a'],
      onBatchExport,
    })

    await screen.getByRole('button', { name: /Ekspor PDF/ }).click()

    expect(onBatchExport).toHaveBeenCalledTimes(1)
  })

  /**
   * A dead button explains nothing. The paywall explains what is missing and
   * sells it in the same tap.
   */
  it('sends Basic to the paywall rather than exporting', async () => {
    const onBatchExport = vi.fn()
    const onUpgrade = vi.fn()
    const screen = await renderScreen({
      tier: 'basic',
      selectMode: true,
      selectedIds: ['a'],
      onBatchExport,
      onUpgrade,
    })

    await screen.getByRole('button', { name: /Ekspor PDF/ }).click()

    expect(onBatchExport).not.toHaveBeenCalled()
    expect(onUpgrade).toHaveBeenCalledTimes(1)
  })

  /** Tidying up your own documents is not something Pro has to buy. */
  it('lets Basic delete in bulk', async () => {
    const onBatchDelete = vi.fn()
    const screen = await renderScreen({
      tier: 'basic',
      selectMode: true,
      selectedIds: ['a'],
      onBatchDelete,
    })

    await screen.getByRole('button', { name: /Hapus/ }).click()

    expect(onBatchDelete).toHaveBeenCalledTimes(1)
  })

  it('leaves select mode on Batal', async () => {
    const onExitSelect = vi.fn()
    const screen = await renderScreen({ selectMode: true, selectedIds: ['a'], onExitSelect })

    await screen.getByRole('button', { name: 'Batal' }).click()

    expect(onExitSelect).toHaveBeenCalledTimes(1)
  })

  it('toggles a row instead of opening it while selecting', async () => {
    const onToggleSelect = vi.fn()
    const onOpen = vi.fn()
    const screen = await renderScreen({
      selectMode: true,
      selectedIds: [],
      onToggleSelect,
      onOpen,
    })

    await screen.getByText('Kwitansi Agustus').click()

    expect(onToggleSelect).toHaveBeenCalledWith('a')
    expect(onOpen).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm run test:browser -- DocumentsScreen`
Expected: FAIL — prop yang belum ada, dan `onEnterSelect` tidak pernah terpanggil.

- [ ] **Step 3: Tulis implementasinya**

Ubah `src/screens/DocumentsScreen.tsx`:

Impor tambahan:

```tsx
import { useRef } from 'react'
import { CheckIcon, CloseIcon, CloudIcon, DownloadIcon, ExportIcon, MergeIcon, ScanIcon, TrashIcon } from '../components/Icons'
import { canBatchExport } from '../lib/exportLimits'
import {
  isSelectable,
  LONG_PRESS_MOVE_PX,
  LONG_PRESS_MS,
  summarizeSelection,
} from '../lib/documentSelection'
import type { Tier } from '../lib/tier'
```

Prop baru ditambahkan ke `DocumentsScreenProps` persis seperti daftar di **Interfaces** di atas.

Di dalam komponen, sebelum `return`:

```tsx
const pressTimer = useRef<number | null>(null)
const pressOrigin = useRef<{ x: number; y: number } | null>(null)
/**
 * A long press is followed by a real `click` from the same finger. Without
 * this, selecting a document would also open it.
 */
const swallowClick = useRef(false)

const cancelPress = () => {
  if (pressTimer.current !== null) {
    clearTimeout(pressTimer.current)
    pressTimer.current = null
  }
  pressOrigin.current = null
}

const startPress = (entry: DocumentEntry) => (event: React.PointerEvent) => {
  // Already selecting: a tap is a toggle, and there is nothing to enter.
  if (selectMode) return

  swallowClick.current = false
  pressOrigin.current = { x: event.clientX, y: event.clientY }
  pressTimer.current = window.setTimeout(() => {
    pressTimer.current = null
    swallowClick.current = true

    if (!isSelectable(entry)) {
      // Silence here reads as a broken app: the row simply would not respond.
      onNotice('Pulihkan dulu ke HP sebelum bisa dipilih.')
      return
    }

    onEnterSelect(entry.id)
  }, LONG_PRESS_MS)
}

/** A finger that travels is scrolling the list, not holding a row. */
const trackPress = (event: React.PointerEvent) => {
  const origin = pressOrigin.current
  if (!origin) return
  if (
    Math.abs(event.clientX - origin.x) > LONG_PRESS_MOVE_PX ||
    Math.abs(event.clientY - origin.y) > LONG_PRESS_MOVE_PX
  ) {
    cancelPress()
  }
}

const handleRowClick = (entry: DocumentEntry) => () => {
  if (swallowClick.current) {
    swallowClick.current = false
    return
  }
  if (selectMode) {
    if (isSelectable(entry)) onToggleSelect(entry.id)
    return
  }
  if (entry.kind === 'local') onOpen(entry.id)
  else onRestore(entry.id)
}

const selection = summarizeSelection(entries, selectedIds)
const pressHandlers = (entry: DocumentEntry) => ({
  onPointerDown: startPress(entry),
  onPointerMove: trackPress,
  onPointerUp: cancelPress,
  onPointerCancel: cancelPress,
  onPointerLeave: cancelPress,
})
```

Perubahan pada JSX:

1. **Header.** Saat `selectMode`, ganti `<header className="app-header">` dengan header seleksi:

```tsx
{selectMode ? (
  <header className="app-header app-header--select">
    <div className="app-header__titles">
      <h1>
        {selection.count} dipilih · {selection.pageCount} halaman
      </h1>
    </div>
    <button type="button" className="button button--ghost" onClick={onExitSelect}>
      Batal
    </button>
  </header>
) : (
  <header className="app-header">
    {/* …isi header yang sudah ada… */}
    <span className="app-header__tier">{tier === 'pro' ? 'Pro' : 'Basic'}</span>
  </header>
)}
```

> Catatan: baris tier di header hari ini **dipatok** ke teks `Basic` apa pun tier akunnya. Karena `tier` baru masuk sebagai prop di task ini dan barisnya ada di header yang memang sedang disunting, perbaiki sekalian — jangan tinggalkan label yang berbohong kepada akun Pro.

2. **Tombol "Pilih"** di header biasa, di sebelah lencana tier (hanya kalau ada dokumen lokal):

```tsx
{entries.some(isSelectable) && (
  <button type="button" className="button button--ghost" onClick={() => onEnterSelect('')}>
    Pilih
  </button>
)}
```

Supaya `onEnterSelect('')` tidak jadi mantra aneh, ubah kontraknya: `onEnterSelect(id: string)` masuk mode pilih dan **mencentang `id` kalau tidak kosong**. Tulis itu di komentar prop-nya.

3. **Baris dokumen.** Bungkus tombol `doc-row__open` dengan `{...pressHandlers(entry)}` dan ganti `onClick`-nya jadi `handleRowClick(entry)`. Tambahkan centang di depan pratinjau saat `selectMode`:

```tsx
{selectMode && isSelectable(entry) && (
  <span className={`select-check${selectedIds.includes(entry.id) ? ' select-check--on' : ''}`}>
    {selectedIds.includes(entry.id) ? <CheckIcon size={14} /> : null}
  </span>
)}
```

Baris cloud saat `selectMode` diberi kelas `doc-row--muted` dan tombol ikonnya (`Pulihkan`) disembunyikan supaya tidak ada aksi ganda di mode pilih.

4. **Tombol Gabungkan** disembunyikan saat `selectMode` — merge punya layarnya sendiri karena urutan centangnya bermakna.

5. **Bilah aksi**, tepat sebelum penutup `</div>` layar:

```tsx
{selectMode && selection.count > 0 && (
  <div className="select-bar">
    <button
      type="button"
      className="button button--primary"
      disabled={isBatchBusy}
      onClick={() => (canBatchExport(tier) ? onBatchExport() : onUpgrade())}
    >
      <ExportIcon size={17} />
      <span>Ekspor PDF</span>
      {!canBatchExport(tier) && <span className="pro-badge">Pro</span>}
    </button>
    <button
      type="button"
      className="button button--danger"
      disabled={isBatchBusy}
      onClick={onBatchDelete}
    >
      <TrashIcon size={17} />
      <span>Hapus</span>
    </button>
  </div>
)}
```

- [ ] **Step 4: Tambahkan gayanya**

Tambahkan di akhir `src/App.css`:

```css
/* Select mode in the documents tab
   ------------------------------------------------------------------ */

.select-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  margin-right: 10px;
  border: 2px solid var(--border);
  border-radius: 50%;
  color: #fff;
}

.select-check--on {
  border-color: var(--primary);
  background: var(--primary);
}

/* A cloud row cannot join a bulk action, and should not look as if it could. */
.doc-row--muted {
  opacity: 0.45;
}

/*
  Sits above the bottom nav, and above the ad banner the tab reserves room for
  — the bar is the only way out of a selection, so nothing may cover it.
*/
.select-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(var(--bottom-nav-height, 64px) + var(--ad-banner-height, 0px));
  z-index: 12;
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  background: var(--surface-solid);
  border-top: 1px solid var(--border);
}

.select-bar .button {
  flex: 1;
  justify-content: center;
}
```

Kalau `--bottom-nav-height` atau `--border` tidak ada, pakai nilai yang sudah dipakai `.bottom-nav` di `App.css` — **jangan mengarang token baru**.

- [ ] **Step 5: Jalankan test, pastikan LULUS**

Run: `npm run test:browser -- DocumentsScreen`
Expected: PASS, 10 test.

- [ ] **Step 6: Buktikan test-nya menggigit**

Sabotase, jalankan, pastikan **merah**, lalu kembalikan:

1. Hapus blok `if (swallowClick.current) { … }` di `handleRowClick` → test "swallows the click that follows the press" harus merah.
2. Ganti `canBatchExport(tier) ? onBatchExport() : onUpgrade()` jadi `onBatchExport()` saja → test "sends Basic to the paywall" harus merah.
3. Hapus cabang `if (!isSelectable(entry))` di dalam pewaktu → test "says why a cloud row cannot be selected" harus merah.

- [ ] **Step 7: Commit**

```bash
git add src/screens/DocumentsScreen.tsx src/screens/DocumentsScreen.browser.test.tsx src/App.css
git commit -m "feat(dokumen): mode pilih di tab Dokumen dengan tekan lama"
```

---

### Task 10: Sambungkan di `App.tsx` & tutup potongan C1

**Files:**
- Modify: `src/App.tsx`
- Modify: `TASKS.md`

**Interfaces:**
- Consumes: semua yang dihasilkan Task 1–9
- Produces: fitur yang jalan utuh dari ujung ke ujung

- [ ] **Step 1: Tambahkan state seleksi & batch**

Di `src/App.tsx`, di dekat state lain:

```tsx
/** Tab Dokumen sedang dalam mode pilih, dan apa saja yang tercentang. */
const [selectMode, setSelectMode] = useState(false)
const [selectedIds, setSelectedIds] = useState<string[]>([])
/** Terbuka kalau lembar batch sedang tampil. */
const [batchOpen, setBatchOpen] = useState(false)
const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null)
const [isBatchBusy, setIsBatchBusy] = useState(false)
const batchAbort = useRef<AbortController | null>(null)
```

Impor tambahan: `useRef` dari React; `exportDocumentsBatch`, `type BatchProgress` dari `./lib/documentExport`; `summarizeSelection`, `toggleSelection` dari `./lib/documentSelection`.

- [ ] **Step 2: Tambahkan handler-nya**

```tsx
const exitSelect = () => {
  setSelectMode(false)
  setSelectedIds([])
}

const handleEnterSelect = (id: string) => {
  setSelectMode(true)
  // Tombol "Pilih" di header masuk tanpa mencentang apa pun; tekan lama
  // mencentang baris yang ditahan.
  if (id) setSelectedIds([id])
}

const handleBatchExport = async () => {
  const chosen = summarizeSelection(entries, selectedIds).documents
  if (chosen.length === 0) return

  const controller = new AbortController()
  batchAbort.current = controller
  setIsBatchBusy(true)
  try {
    const result = await exportDocumentsBatch(
      chosen,
      tier,
      exportLevel,
      setBatchProgress,
      controller.signal,
    )
    setToast(result.message)
    // Pilihannya dipertahankan kalau ada yang gagal, supaya sisanya bisa
    // dicoba lagi tanpa mencentang ulang dari nol.
    if (result.failed.length === 0 && !result.cancelled) exitSelect()
    setBatchOpen(false)
  } catch (error) {
    setToast(error instanceof Error ? error.message : 'Gagal mengekspor dokumen.')
  } finally {
    batchAbort.current = null
    setBatchProgress(null)
    setIsBatchBusy(false)
  }
}

const handleBatchDelete = async () => {
  const chosen = summarizeSelection(entries, selectedIds).documents
  if (chosen.length === 0) return
  if (
    !confirm(
      `Hapus ${chosen.length} dokumen dari HP? Cadangan di cloud tidak ikut terhapus.`,
    )
  ) {
    return
  }

  setIsBatchBusy(true)
  let removed = 0
  try {
    for (const doc of chosen) {
      try {
        await deleteScanDocument(doc.id)
        removed++
      } catch {
        // Dihitung lewat selisih; satu dokumen yang menolak dihapus tidak
        // boleh menahan sisanya.
      }
    }
  } finally {
    // Sekali di akhir, bukan per dokumen: tanda tangan dipakai lintas dokumen,
    // jadi menyapunya di tengah loop bisa menghapus berkas yang masih dirujuk
    // dokumen yang belum sempat dihapus.
    await pruneUnusedSignatures()
    await refreshDocuments()
    setIsBatchBusy(false)
    exitSelect()
  }

  const failed = chosen.length - removed
  setToast(
    failed > 0
      ? `${removed} dokumen dihapus, ${failed} gagal.`
      : `${removed} dokumen dihapus dari HP.`,
  )
}
```

- [ ] **Step 3: Pasang lembarnya & prop layarnya**

Lembar batch, di dekat `exportSheet` yang sudah ada:

```tsx
const batchSelection = summarizeSelection(entries, selectedIds)
const batchSheet = batchOpen && (
  <BatchExportSheet
    count={batchSelection.count}
    pageCount={batchSelection.pageCount}
    tier={tier}
    level={exportLevel}
    progress={batchProgress}
    isBusy={isBatchBusy}
    onLevelChange={(next) => {
      setExportLevel(next)
      writeExportLevel(next)
    }}
    onExport={handleBatchExport}
    onStop={() => batchAbort.current?.abort()}
    onClose={() => setBatchOpen(false)}
  />
)
```

Render `{batchSheet}` di blok tab, tepat setelah `{exportSheet}`.

Lengkapi prop `<DocumentsScreen …>`:

```tsx
tier={tier}
selectMode={selectMode}
selectedIds={selectedIds}
isBatchBusy={isBatchBusy}
onEnterSelect={handleEnterSelect}
onToggleSelect={(id) => setSelectedIds((current) => toggleSelection(current, id))}
onExitSelect={exitSelect}
onBatchExport={() => setBatchOpen(true)}
onBatchDelete={handleBatchDelete}
onUpgrade={() => setView({ kind: 'upgrade' })}
onNotice={setToast}
```

- [ ] **Step 4: Tinggalkan mode pilih saat berpindah tab**

Mode pilih milik tab Dokumen. Berpindah ke Home lalu kembali dan menemukan bilah aksi masih menggantung adalah keadaan yang tidak bisa dijelaskan:

```tsx
useEffect(() => {
  if (tab !== 'documents') exitSelect()
}, [tab])
```

- [ ] **Step 5: Verifikasi menyeluruh**

Run: `npm run lint` — Expected: bersih
Run: `npm run build` — Expected: sukses
Run: `npm test` — Expected: seluruhnya PASS

Catat jumlah test akhir dari keluaran `npm test`; angka itu dipakai di langkah berikutnya. **Jangan menuliskan angka yang tidak Anda lihat di layar.**

- [ ] **Step 6: Coba di browser**

Run: `npm run dev`, buka aplikasinya, tekan "Buat contoh" di dev-bar untuk membuat dokumen contoh, lalu:

- tekan lama sebuah dokumen → mode pilih menyala, dokumennya **tidak** terbuka
- centang dua dokumen → bilah aksi muncul, hitungannya benar
- Ekspor PDF → lembar terbuka, tekan Ekspor → dua berkas terunduh (di web berkasnya diunduh, bukan disimpan ke Documents)
- Hapus → konfirmasi muncul, dua dokumen hilang, mode pilih tertutup

- [ ] **Step 7: Code review & security**

Jalankan `/code-review` untuk seluruh diff C1, dan skill `security-guidance`. Tutup temuan correctness **sebelum** commit terakhir; temuan kerapian boleh diikutkan. Jangan menumpuk temuan ke potongan C2.

- [ ] **Step 8: Perbarui `TASKS.md`**

Tambahkan bagian baru setelah "Fase 6 bagian 3", judulnya `### Fase 6 bagian 4 — Mode Pilih & Batch Export (C1) — 25 Agustus 2026`, dengan:

- daftar centang untuk apa yang selesai (mode pilih, tekan lama + penelan klik, batch export PDF Pro, hapus banyak, tabrakan nama berkas, gerbang Pro di library, tombol Hentikan, kegagalan sebagian)
- jumlah test sebelum → sesudah, memakai angka **nyata** dari Step 5
- daftar "Belum diverifikasi di device fisik" dari spec Bagian 7 bagian **Setelah C1**
- satu baris yang mencatat bahwa lencana tier di header tab Dokumen tadinya dipatok "Basic" dan sekarang mengikuti tier sungguhan

Di daftar Fase 6 paling atas, ubah `- [ ] Batch scan/export` jadi `- [~] Batch scan/export — C1 selesai, C2 (pisah sesi pindai) menyusul`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(dokumen): ekspor & hapus banyak dokumen sekaligus (Fase 6 potongan C1)"
```

---

## Self-Review

**Spec coverage** — tiap bagian spec C1 punya task:

| Spec | Task |
|---|---|
| 3.1 dua jalan masuk, tekan lama, penelan klik | 9 |
| 3.2 baris cloud tidak bisa dipilih | 6 (`isSelectable`), 9 (toast) |
| 3.3 state seleksi di `App` | 10 |
| 3.4 bilah aksi, lencana Pro, paywall, hapus semua tier | 9 |
| 3.5 pecah `exportShare` | 2 |
| 3.6 batch berurutan, tulis lalu lepas | 5 |
| 3.7 tabrakan nama berkas | 1, 5 |
| 3.8 gerbang Pro di library | 3, 5 |
| 3.9 kegagalan sebagian & tombol Hentikan | 4, 5, 8 |
| 3.10 lembar batch & level kompresi | 7, 8 |
| 3.11 tanpa perkiraan ukuran, PDF saja, cadangan tak tersentuh | 8 (komentar), 5 (tidak menyentuh `buildPdfFile`) |

**Ambiguitas yang sudah ditutup inline:**

- `onEnterSelect('')` dari tombol "Pilih" versus `onEnterSelect(id)` dari tekan lama — kontraknya ditulis eksplisit di Task 9 Step 3 poin 2.
- Kapan seleksi dikosongkan setelah ekspor: **hanya** kalau tidak ada yang gagal dan tidak dihentikan (Task 10 Step 2).
- `pruneUnusedSignatures()` sekali di akhir hapus massal, bukan per dokumen, berikut alasannya (Task 10 Step 2).

**Yang sengaja diserahkan ke pelaksana:** nilai token CSS kalau ternyata namanya berbeda dari tebakan — dengan larangan tegas mengarang warna baru (Task 8 Step 4, Task 9 Step 4).
