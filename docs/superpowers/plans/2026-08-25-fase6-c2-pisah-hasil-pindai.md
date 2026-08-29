# Pisah Hasil Pindai (Fase 6 potongan C2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu sesi pindai (mis. 30 kwitansi sekali jalan) bisa dipecah jadi beberapa dokumen sekaligus, tanpa memindai ulang.

**Architecture:** Seluruh keadaan layar Pisah adalah **satu himpunan posisi gunting** (`cuts`). `planSplit(pageCount, cuts)` di `src/lib/scanSplit.ts` mengubahnya jadi kelompok indeks halaman; layar hanya menggambar hasilnya. Penyimpanannya memanggil `saveScanDocument` yang sudah ada, satu per kelompok, berurutan — kelompok yang berhasil pergi, kelompok yang gagal **tetap tinggal di layar** supaya hasil pindai tidak pernah hilang. Gerbang Pro ditegakkan di library (`saveSplitScan`), dengan pengecualian: memisah jadi **1** dokumen identik dengan menyimpan biasa, jadi tidak boleh ditolak.

**Tech Stack:** React + TypeScript + Vite + Capacitor; Vitest dua suite (`node` untuk logika murni, `browser`/Chromium + `vitest-browser-react` untuk komponen).

**Spec:** `docs/superpowers/specs/2026-08-25-fase6-batch-scan-export-design.md` Bagian 4 (C2), Bagian 6 (rencana test), Bagian 8 (berkas tersentuh).

## Global Constraints

- **Bahasa komentar konsisten per file.** Berkas baru di plan ini (`scanSplit.ts`, `SplitScanScreen.tsx`, dua berkas test) memakai **komentar Inggris**, mengikuti tetangganya (`documentSelection.ts`, `exportNames.ts`, `documentExport.ts`). Teks yang dilihat user tetap **Bahasa Indonesia**.
- **Penamaan:** `camelCase` untuk berkas lib, `PascalCase` untuk komponen React (CLAUDE.md Bagian 4).
- **Tidak ada warna atau token CSS baru** (CLAUDE.md 9.2). Yang boleh dipakai hanya token yang sudah ada di `src/App.css`: `--acc`, `--acc-soft`, `--chip`, `--chip-border`, `--surface`, `--fg`, `--fg-dim`, `--pro-gold`, `--shadow`.
- **Gerbang tier ditegakkan di library, bukan cuma di UI** — pelajaran `resolveCompressionLevel` dan `exportDocumentsBatch`.
- **Aturan gerbang C2:** syaratnya bukan "fitur ini Pro" melainkan **"lebih dari satu dokumen butuh Pro"** (spec 4.5).
- **Tidak boleh me-mock canvas/Filesystem untuk membuktikan kode canvas/berkas** (CLAUDE.md Bagian 4). Penulisan berkas & pemindai ML Kit masuk daftar uji device, bukan test otomatis.
- **Iklan:** `maybeShowInterstitial('scan-saved', tier)` dipanggil **sekali** untuk seluruh sesi pisah, bukan per dokumen (spec 4.7).
- Perintah test: `npm run test:node` (suite node), `npm run test:browser` (Chromium), `npm test` (keduanya). Typecheck: `npm run build`. Lint: `npm run lint`.
- Basis test sekarang: **520** (466 node + 54 browser).

---

### Task 1: Matematika pisah (`scanSplit.ts` bagian murni)

**Files:**
- Create: `src/lib/scanSplit.ts`
- Test: `src/lib/scanSplit.test.ts`

**Interfaces:**
- Consumes: `Tier` dari `src/lib/tier.ts`.
- Produces:
  - `planSplit(pageCount: number, cuts: readonly number[]): number[][]`
  - `toggleCut(cuts: readonly number[], at: number): number[]`
  - `everyNCuts(pageCount: number, size: number): number[]`
  - `boundaryCuts(groups: readonly { length: number }[]): number[]`
  - `splitTitles(base: string, count: number, startAt?: number): (string | undefined)[]`
  - `canSplitScan(tier: Tier, groupCount: number): boolean`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/lib/scanSplit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  boundaryCuts,
  canSplitScan,
  everyNCuts,
  planSplit,
  splitTitles,
  toggleCut,
} from './scanSplit'

describe('planSplit', () => {
  it('groups pages around the cuts', () => {
    expect(planSplit(7, [2, 3, 6])).toEqual([[0, 1], [2], [3, 4, 5], [6]])
  })

  it('is one document when there are no cuts', () => {
    expect(planSplit(3, [])).toEqual([[0, 1, 2]])
  })

  it('is one document per page when every position is cut', () => {
    expect(planSplit(3, [1, 2])).toEqual([[0], [1], [2]])
  })

  it('ignores duplicate cuts', () => {
    expect(planSplit(4, [2, 2, 2])).toEqual([[0, 1], [2, 3]])
  })

  it('ignores cuts at 0 and past the last page', () => {
    // A cut at 0 would mint an empty first document; a cut past the end would
    // mint an empty last one. Both arrive for real after a half-successful
    // save shrinks the page list under the cuts.
    expect(planSplit(3, [0, 1, 3, 9, -2])).toEqual([[0], [1, 2]])
  })

  it('sorts cuts that arrive out of order', () => {
    expect(planSplit(4, [3, 1])).toEqual([[0], [1, 2], [3]])
  })

  it('has nothing to group when there are no pages', () => {
    expect(planSplit(0, [1])).toEqual([])
  })
})

describe('toggleCut', () => {
  it('adds a cut, keeping the list sorted', () => {
    expect(toggleCut([1, 5], 3)).toEqual([1, 3, 5])
  })

  it('removes a cut that is already there', () => {
    expect(toggleCut([1, 3, 5], 3)).toEqual([1, 5])
  })

  it('never mutates the array it was handed', () => {
    const cuts = [1, 5]
    toggleCut(cuts, 3)
    expect(cuts).toEqual([1, 5])
  })
})

describe('everyNCuts', () => {
  it('cuts after every page', () => {
    expect(everyNCuts(4, 1)).toEqual([1, 2, 3])
  })

  it('cuts after every second page', () => {
    expect(everyNCuts(5, 2)).toEqual([2, 4])
  })

  it('never cuts past the last page', () => {
    expect(everyNCuts(4, 2)).toEqual([2])
  })

  it('returns nothing for a nonsensical size', () => {
    expect(everyNCuts(4, 0)).toEqual([])
  })
})

describe('boundaryCuts', () => {
  it('rebuilds the cuts that separate a list of groups', () => {
    // What a half-successful save needs: the groups that failed become the new
    // page list, so their boundaries have to be renumbered from zero.
    expect(boundaryCuts([[1, 2], [3], [4, 5, 6]])).toEqual([2, 3])
  })

  it('has no boundary for a single group', () => {
    expect(boundaryCuts([[1, 2]])).toEqual([])
  })

  it('has no boundary for no groups at all', () => {
    expect(boundaryCuts([])).toEqual([])
  })
})

describe('splitTitles', () => {
  it('numbers every document from the one name typed', () => {
    expect(splitTitles('Kwitansi', 3)).toEqual(['Kwitansi (1)', 'Kwitansi (2)', 'Kwitansi (3)'])
  })

  it('trims the name before numbering it', () => {
    expect(splitTitles('  Kwitansi  ', 2)).toEqual(['Kwitansi (1)', 'Kwitansi (2)'])
  })

  it('leaves an empty name undefined so storage falls back to "Scan <tanggal>"', () => {
    expect(splitTitles('   ', 2)).toEqual([undefined, undefined])
  })

  it('does not number a lone document', () => {
    expect(splitTitles('Kwitansi', 1)).toEqual(['Kwitansi'])
  })

  it('continues the numbering after a partial save', () => {
    expect(splitTitles('Kwitansi', 2, 5)).toEqual(['Kwitansi (6)', 'Kwitansi (7)'])
  })
})

describe('canSplitScan', () => {
  it('lets Pro split into several documents', () => {
    expect(canSplitScan('pro', 6)).toBe(true)
  })

  it('refuses Basic more than one document', () => {
    expect(canSplitScan('basic', 2)).toBe(false)
  })

  it('lets Basic through when it is really just an ordinary save', () => {
    // Splitting into one document is what the Simpan button next door already
    // does for free. Refusing it would be a bug wearing the clothes of a rule.
    expect(canSplitScan('basic', 1)).toBe(true)
  })
})
```

- [ ] **Step 2: Jalankan test, pastikan merah**

Run: `npm run test:node -- scanSplit`
Expected: FAIL — `Failed to resolve import "./scanSplit"`.

- [ ] **Step 3: Tulis implementasi minimal**

Buat `src/lib/scanSplit.ts`:

```ts
import type { Tier } from './tier'

/**
 * Splitting one scanning session into several documents.
 *
 * The whole state of the split screen is one set of cut positions: a cut at
 * index `i` means "a new document starts at page i". Everything else — the
 * ready-made patterns, the group headers, the footer count — is derived from
 * that set, so there is only ever one thing to keep correct.
 */

/** Groups page indices around the cuts. Pure; the screen only draws the result. */
export function planSplit(pageCount: number, cuts: readonly number[]): number[][] {
  if (pageCount <= 0) return []

  // Out-of-range and duplicate cuts are dropped rather than trusted. A cut at
  // 0 or past the last page would mint an empty document, and both arrive for
  // real: a half-successful save shrinks the page list underneath the cuts.
  const valid = [...new Set(cuts)]
    .filter((cut) => cut > 0 && cut < pageCount)
    .sort((a, b) => a - b)

  const groups: number[][] = []
  let start = 0
  for (const end of [...valid, pageCount]) {
    groups.push(Array.from({ length: end - start }, (_, offset) => start + offset))
    start = end
  }
  return groups
}

/** Adds or removes one cut, never mutating the array it was handed. */
export function toggleCut(cuts: readonly number[], at: number): number[] {
  return cuts.includes(at)
    ? cuts.filter((cut) => cut !== at)
    : [...cuts, at].sort((a, b) => a - b)
}

/** The ready-made patterns: a cut every `size` pages. */
export function everyNCuts(pageCount: number, size: number): number[] {
  if (size < 1) return []
  const cuts: number[] = []
  for (let at = size; at < pageCount; at += size) cuts.push(at)
  return cuts
}

/**
 * The cuts that separate a list of groups, renumbered from zero.
 *
 * Used after a partial save: the groups that failed become the new page list,
 * so the cuts around them cannot keep their old positions.
 */
export function boundaryCuts(groups: readonly { length: number }[]): number[] {
  const cuts: number[] = []
  let at = 0
  // The last group's end is the end of the list, which is not a cut.
  for (const group of groups.slice(0, -1)) {
    at += group.length
    cuts.push(at)
  }
  return cuts
}

/**
 * One name typed once becomes "Nama (1)", "Nama (2)", …
 *
 * Without it, scanning thirty receipts hands back thirty documents that are
 * identical except for a timestamp, and renaming them is thirty more taps.
 *
 * `startAt` continues the numbering after a partial save, so the retry does
 * not mint a second "Kwitansi (1)" next to the one that already landed.
 */
export function splitTitles(base: string, count: number, startAt = 0): (string | undefined)[] {
  const trimmed = base.trim()

  // Left undefined on purpose: saveScanDocument then falls back to its own
  // "Scan <tanggal>", exactly like saving without splitting.
  if (trimmed.length === 0) return Array.from({ length: count }, () => undefined)

  // A lone document is an ordinary save wearing a different button; numbering
  // it "(1)" would label something that has no "(2)".
  if (count === 1 && startAt === 0) return [trimmed]

  return Array.from({ length: count }, (_, index) => `${trimmed} (${startAt + index + 1})`)
}

/**
 * Splitting into two or more documents is Pro (PRD Bagian 3).
 *
 * Splitting into one is not: that is identical to the Simpan button next to
 * it, which every tier already has. Refusing it would be refusing something
 * already free through the neighbouring door — a bug, not an enforcement.
 */
export function canSplitScan(tier: Tier, groupCount: number): boolean {
  return tier === 'pro' || groupCount <= 1
}
```

- [ ] **Step 4: Jalankan test, pastikan hijau**

Run: `npm run test:node -- scanSplit`
Expected: PASS, 25 test.

- [ ] **Step 5: Buktikan test-nya menggigit**

Sabotase sebentar lalu kembalikan:
1. Di `canSplitScan`, ubah jadi `return tier === 'pro'` → test "lets Basic through when it is really just an ordinary save" harus **merah**. Kembalikan.
2. Di `planSplit`, hapus `.filter((cut) => cut > 0 && cut < pageCount)` → test "ignores cuts at 0 and past the last page" harus **merah**. Kembalikan.

Run: `npm run test:node -- scanSplit` setelah tiap sabotase dan setelah dikembalikan.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scanSplit.ts src/lib/scanSplit.test.ts
git commit -m "feat(pisah): matematika pisah hasil pindai (planSplit, pola, penamaan, gerbang Pro)"
```

---

### Task 2: `saveSplitScan()` — menyimpan banyak dokumen, kelompok gagal tetap tinggal

**Files:**
- Modify: `src/lib/scanSplit.ts` (tambah di bawah fungsi Task 1)
- Test: `src/lib/scanSplit.test.ts` (ubah bagian atas, tambah blok baru di akhir)

**Interfaces:**
- Consumes: `planSplit`/`splitTitles`/`canSplitScan` dari Task 1; `saveScanDocument`, `LocalScanDocument` dari `./scanStorage`.
- Produces:
  - `interface SplitSaveResult { saved: LocalScanDocument[]; remaining: string[][]; message: string }`
  - `saveSplitScan(groups: string[][], base: string, tier: Tier, startAt?: number, onProgress?: (done: number, total: number) => void): Promise<SplitSaveResult>`
  - `summarizeSplitSave(saved: number, failed: number): string`

- [ ] **Step 1: Tulis test yang gagal**

`scanSplit.test.ts` sekarang butuh mock `./scanStorage`, jadi impor statis di baris atas berkas diganti impor dinamis setelah mock terpasang (pola yang sama dengan `batchExport.test.ts`). Ganti **bagian atas** berkas jadi:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalScanDocument } from './scanIndexMigration'

/** Titles whose save should blow up, so the failure path can be exercised. */
const failTitles = new Set<string | undefined>()
const savedCalls: { uris: string[]; title: string | undefined }[] = []

vi.mock('./scanStorage', () => ({
  saveScanDocument: async (uris: string[], title?: string): Promise<LocalScanDocument> => {
    if (failTitles.has(title)) throw new Error('Penyimpanan penuh.')
    savedCalls.push({ uris, title })
    return {
      schemaVersion: 4,
      id: `doc-${savedCalls.length}`,
      title: title ?? 'Scan bawaan',
      createdAt: '2026-08-25T00:00:00.000Z',
      pageCount: uris.length,
      pages: uris.map((uri) => ({ original: uri })),
    }
  },
}))

const {
  boundaryCuts,
  canSplitScan,
  everyNCuts,
  planSplit,
  saveSplitScan,
  splitTitles,
  summarizeSplitSave,
  toggleCut,
} = await import('./scanSplit')

beforeEach(() => {
  failTitles.clear()
  savedCalls.length = 0
})
```

(Baris `import { ... } from './scanSplit'` yang lama dihapus — semuanya sekarang datang dari `await import` di atas.)

Lalu tambahkan blok test baru di **akhir** berkas:

```ts
describe('saveSplitScan', () => {
  const pages = ['uri-1', 'uri-2', 'uri-3']

  it('saves one document per group, in order, with the numbered names', async () => {
    const result = await saveSplitScan([[pages[0], pages[1]], [pages[2]]], 'Kwitansi', 'pro')

    expect(savedCalls).toEqual([
      { uris: ['uri-1', 'uri-2'], title: 'Kwitansi (1)' },
      { uris: ['uri-3'], title: 'Kwitansi (2)' },
    ])
    expect(result.saved).toHaveLength(2)
    expect(result.remaining).toEqual([])
    expect(result.message).toBe('2 dokumen tersimpan.')
  })

  it('leaves the groups that failed on screen and reports them', async () => {
    failTitles.add('Kwitansi (2)')

    const result = await saveSplitScan([[pages[0]], [pages[1]], [pages[2]]], 'Kwitansi', 'pro')

    expect(result.saved).toHaveLength(2)
    // The pages of a scan that failed cannot be recovered from anywhere, so
    // they stay put rather than being thrown away with the screen.
    expect(result.remaining).toEqual([['uri-2']])
    expect(result.message).toBe(
      '2 dokumen tersimpan, 1 gagal. Halamannya masih di sini — coba simpan lagi.',
    )
  })

  it('reports a total failure without claiming anything was saved', async () => {
    failTitles.add('Kwitansi (1)')
    failTitles.add('Kwitansi (2)')

    const result = await saveSplitScan([[pages[0]], [pages[1]]], 'Kwitansi', 'pro')

    expect(result.saved).toEqual([])
    expect(result.remaining).toEqual([['uri-1'], ['uri-2']])
    expect(result.message).toBe(
      'Tidak ada dokumen yang tersimpan. Halamannya masih di sini — coba lagi.',
    )
  })

  it('continues the numbering when a retry follows a partial save', async () => {
    await saveSplitScan([[pages[0]]], 'Kwitansi', 'pro', 5)

    expect(savedCalls[0].title).toBe('Kwitansi (6)')
  })

  it('leaves the title undefined when no name was typed', async () => {
    await saveSplitScan([[pages[0]], [pages[1]]], '  ', 'pro')

    expect(savedCalls.map((call) => call.title)).toEqual([undefined, undefined])
  })

  it('refuses Basic more than one document, before writing anything', async () => {
    await expect(saveSplitScan([[pages[0]], [pages[1]]], 'Kwitansi', 'basic')).rejects.toThrow(
      'akun Pro',
    )
    expect(savedCalls).toEqual([])
  })

  it('lets Basic save a single group — that is an ordinary save', async () => {
    const result = await saveSplitScan([[pages[0], pages[1]]], 'Kwitansi', 'basic')

    expect(result.saved).toHaveLength(1)
    expect(savedCalls).toEqual([{ uris: ['uri-1', 'uri-2'], title: 'Kwitansi' }])
  })

  it('drops empty groups rather than saving a document with no pages', async () => {
    const result = await saveSplitScan([[pages[0]], []], 'Kwitansi', 'basic')

    expect(savedCalls).toHaveLength(1)
    expect(result.saved).toHaveLength(1)
  })

  it('refuses when there is nothing to save at all', async () => {
    await expect(saveSplitScan([], 'Kwitansi', 'pro')).rejects.toThrow('Tidak ada halaman')
  })

  it('reports progress from zero through to done', async () => {
    const seen: string[] = []

    await saveSplitScan([[pages[0]], [pages[1]]], 'Kwitansi', 'pro', 0, (done, total) =>
      seen.push(`${done}/${total}`),
    )

    expect(seen).toEqual(['0/2', '1/2', '2/2'])
  })
})

describe('summarizeSplitSave', () => {
  it('says nothing about failures when there were none', () => {
    expect(summarizeSplitSave(3, 0)).toBe('3 dokumen tersimpan.')
  })

  it('names both halves of a partial run', () => {
    expect(summarizeSplitSave(1, 2)).toBe(
      '1 dokumen tersimpan, 2 gagal. Halamannya masih di sini — coba simpan lagi.',
    )
  })
})
```

- [ ] **Step 2: Jalankan test, pastikan merah**

Run: `npm run test:node -- scanSplit`
Expected: FAIL — `saveSplitScan is not a function`.

- [ ] **Step 3: Tulis implementasi minimal**

Di `src/lib/scanSplit.ts`, ubah blok impor paling atas jadi:

```ts
import { saveScanDocument, type LocalScanDocument } from './scanStorage'
import type { Tier } from './tier'
```

Lalu tambahkan di akhir berkas:

```ts
export interface SplitSaveResult {
  saved: LocalScanDocument[]
  /** Groups that did not make it, in their original order. */
  remaining: string[][]
  /** Indonesian, ready for the toast. */
  message: string
}

/**
 * Saves one document per group, sequentially.
 *
 * Sequential rather than parallel for the same reason as the batch export:
 * these are 12 MP JPEGs being read and written, and starting eight at once
 * only makes them compete for the same memory on a phone.
 *
 * The failure rule is the important part. Saving eight documents is eight
 * writes, and the sixth can fail on a full disk. Rolling the whole thing back
 * would throw away five documents that are already safe; closing the screen
 * would take the three unsaved groups down with the scanning session, and a
 * scan that is gone cannot be recovered from anywhere. So: **the groups that
 * succeeded leave, the groups that failed stay**, and the caller puts them
 * back on screen. `saveScanDocument` already removes its own folder when it
 * fails part way through, so nothing is stranded on disk.
 */
export async function saveSplitScan(
  groups: string[][],
  base: string,
  tier: Tier,
  startAt = 0,
  onProgress?: (done: number, total: number) => void,
): Promise<SplitSaveResult> {
  const usable = groups.filter((group) => group.length > 0)
  if (usable.length === 0) {
    throw new Error('Tidak ada halaman untuk disimpan.')
  }
  // In the library rather than only in the screen: hiding a button is not the
  // same as refusing the action behind it.
  if (!canSplitScan(tier, usable.length)) {
    throw new Error('Memisah hasil pindai jadi beberapa dokumen hanya untuk akun Pro.')
  }

  const titles = splitTitles(base, usable.length, startAt)
  const saved: LocalScanDocument[] = []
  const remaining: string[][] = []

  for (let index = 0; index < usable.length; index++) {
    onProgress?.(index, usable.length)
    try {
      saved.push(await saveScanDocument(usable[index], titles[index]))
    } catch {
      // Counted by staying behind, not thrown: one group that will not save
      // must not take the other seven with it.
      remaining.push(usable[index])
    }
  }
  onProgress?.(usable.length, usable.length)

  return { saved, remaining, message: summarizeSplitSave(saved.length, remaining.length) }
}

/** One sentence for the toast, covering all-saved, partial and nothing-saved. */
export function summarizeSplitSave(saved: number, failed: number): string {
  if (saved === 0) {
    return 'Tidak ada dokumen yang tersimpan. Halamannya masih di sini — coba lagi.'
  }
  if (failed === 0) return `${saved} dokumen tersimpan.`
  return `${saved} dokumen tersimpan, ${failed} gagal. Halamannya masih di sini — coba simpan lagi.`
}
```

- [ ] **Step 4: Jalankan test, pastikan hijau**

Run: `npm run test:node -- scanSplit`
Expected: PASS, 37 test.

- [ ] **Step 5: Buktikan test-nya menggigit**

1. Ubah gerbang jadi `if (!canSplitScan(tier, 2))` (menolak juga saat 1 kelompok) → test "lets Basic save a single group" harus **merah**. Kembalikan.
2. Ganti `remaining.push(usable[index])` jadi `throw error` (dengan `catch (error)`) → test "leaves the groups that failed on screen" harus **merah**. Kembalikan.

- [ ] **Step 6: Jalankan seluruh suite node & typecheck**

Run: `npm run test:node` lalu `npm run build`
Expected: semua hijau; `build` selesai tanpa error TypeScript.

- [ ] **Step 7: Commit**

```bash
git add src/lib/scanSplit.ts src/lib/scanSplit.test.ts
git commit -m "feat(pisah): simpan hasil pisah per kelompok, kelompok yang gagal tetap tinggal"
```

---

### Task 3: Layar `SplitScanScreen`

**Files:**
- Create: `src/screens/SplitScanScreen.tsx`
- Create: `src/screens/SplitScanScreen.browser.test.tsx`
- Modify: `src/App.css` (blok baru di akhir berkas)

**Interfaces:**
- Consumes: `planSplit`, `toggleCut`, `everyNCuts`, `splitTitles` dari `../lib/scanSplit`; `PageImage` dari `../components/PageImage`; `ChevronLeftIcon` dari `../components/Icons`.
- Produces: komponen `SplitScanScreen` dengan props:

```ts
interface SplitScanScreenProps {
  /** Scanner URIs, exactly as ReviewScreen has them (still `raw`). */
  pages: string[]
  cuts: number[]
  name: string
  isBusy: boolean
  /** `{ done, total }` while a save is running, else null. */
  progress: { done: number; total: number } | null
  onCutsChange: (cuts: number[]) => void
  onNameChange: (name: string) => void
  onBack: () => void
  /** Groups of scanner URIs, in screen order. */
  onSave: (groups: string[][]) => void
}
```

Komponennya **controlled**: `cuts` dan `name` tinggal di `App.tsx`, bukan di dalam layar. Alasannya bukan gaya — setelah simpan gagal sebagian, App harus mengganti daftar halaman **dan** menyusun ulang guntingnya; kalau gunting tinggal di dalam layar, satu-satunya cara mengaturnya dari luar adalah me-remount layar, yang ikut menghapus nama yang sudah diketik.

Tidak ada prop `tier`/`onUpgrade` di sini: gerbangnya sudah di tombol pintu masuk (Task 4) dan di `saveSplitScan` (Task 2).

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/screens/SplitScanScreen.browser.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { SplitScanScreen } from './SplitScanScreen'

const pages = ['uri-1', 'uri-2', 'uri-3', 'uri-4']

async function renderScreen(overrides: Partial<Parameters<typeof SplitScanScreen>[0]> = {}) {
  return await render(
    <SplitScanScreen
      pages={pages}
      cuts={[]}
      name=""
      isBusy={false}
      progress={null}
      onCutsChange={() => {}}
      onNameChange={() => {}}
      onBack={() => {}}
      onSave={() => {}}
      {...overrides}
    />,
  )
}

describe('ready-made patterns', () => {
  it('fills a cut after every page', async () => {
    const onCutsChange = vi.fn()
    const screen = await renderScreen({ onCutsChange })

    await screen.getByRole('button', { name: 'Tiap 1 halaman' }).click()

    expect(onCutsChange).toHaveBeenCalledWith([1, 2, 3])
  })

  it('fills a cut after every second page', async () => {
    const onCutsChange = vi.fn()
    const screen = await renderScreen({ onCutsChange })

    await screen.getByRole('button', { name: 'Tiap 2 halaman' }).click()

    expect(onCutsChange).toHaveBeenCalledWith([2])
  })

  it('clears every cut', async () => {
    const onCutsChange = vi.fn()
    const screen = await renderScreen({ cuts: [1, 2, 3], onCutsChange })

    await screen.getByRole('button', { name: 'Bersihkan pemisah' }).click()

    expect(onCutsChange).toHaveBeenCalledWith([])
  })
})

describe('adjusting cuts by hand', () => {
  it('adds a cut where there is none', async () => {
    const onCutsChange = vi.fn()
    const screen = await renderScreen({ cuts: [1], onCutsChange })

    await screen.getByRole('button', { name: 'Pisah antara halaman 3 dan 4' }).click()

    expect(onCutsChange).toHaveBeenCalledWith([1, 3])
  })

  it('removes a cut that is already there', async () => {
    const onCutsChange = vi.fn()
    const screen = await renderScreen({ cuts: [1, 3], onCutsChange })

    await screen.getByRole('button', { name: 'Gabungkan halaman 3 dan 4' }).click()

    expect(onCutsChange).toHaveBeenCalledWith([1])
  })
})

describe('what the screen says', () => {
  it('counts the documents the cuts produce', async () => {
    const screen = await renderScreen({ cuts: [1, 2, 3] })

    await expect.element(screen.getByText('4 halaman → 4 dokumen')).toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Simpan 4 Dokumen' }))
      .toBeInTheDocument()
  })

  it('counts one document when nothing is cut', async () => {
    const screen = await renderScreen({ cuts: [] })

    await expect.element(screen.getByText('4 halaman → 1 dokumen')).toBeInTheDocument()
  })

  it('previews the numbered name on each group header', async () => {
    const screen = await renderScreen({ cuts: [2], name: 'Kwitansi' })

    await expect.element(screen.getByText('Dokumen 1 — Kwitansi (1)')).toBeInTheDocument()
    await expect.element(screen.getByText('Dokumen 2 — Kwitansi (2)')).toBeInTheDocument()
  })

  it('shows how far a running save has got', async () => {
    const screen = await renderScreen({ isBusy: true, progress: { done: 2, total: 5 } })

    await expect.element(screen.getByText('Menyimpan… 2 dari 5')).toBeInTheDocument()
  })
})

describe('saving', () => {
  it('hands over the groups the cuts describe, as page URIs', async () => {
    const onSave = vi.fn()
    const screen = await renderScreen({ cuts: [1, 3], onSave })

    await screen.getByRole('button', { name: 'Simpan 3 Dokumen' }).click()

    expect(onSave).toHaveBeenCalledWith([['uri-1'], ['uri-2', 'uri-3'], ['uri-4']])
  })

  it('is shut while a save is running, so nothing is saved twice', async () => {
    // Asserted as "disabled" rather than by clicking it: a forced click on a
    // disabled button proves whatever the driver happens to do with one,
    // whereas the attribute is the thing that actually stops a second save.
    const screen = await renderScreen({ isBusy: true, progress: { done: 1, total: 3 } })

    await expect.element(screen.getByRole('button', { name: 'Menyimpan…' })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Jalankan test, pastikan merah**

Run: `npm run test:browser -- SplitScanScreen`
Expected: FAIL — `Failed to resolve import "./SplitScanScreen"`.

- [ ] **Step 3: Tulis komponennya**

Buat `src/screens/SplitScanScreen.tsx`:

```tsx
import { ChevronLeftIcon } from '../components/Icons'
import { PageImage } from '../components/PageImage'
import { everyNCuts, planSplit, splitTitles, toggleCut } from '../lib/scanSplit'

interface SplitScanScreenProps {
  /** Scanner URIs, exactly as ReviewScreen has them — hence `raw` below. */
  pages: string[]
  cuts: number[]
  name: string
  isBusy: boolean
  /** `{ done, total }` while a save is running, else null. */
  progress: { done: number; total: number } | null
  onCutsChange: (cuts: number[]) => void
  onNameChange: (name: string) => void
  onBack: () => void
  /** Groups of scanner URIs, in screen order. */
  onSave: (groups: string[][]) => void
}

/**
 * A screen of its own rather than markers inside the review strip.
 *
 * That strip is horizontal and already full at five pages; thirty pages with
 * separators between them would turn it into a long corridor that has to be
 * dragged just to see how many documents there are.
 *
 * Controlled on purpose: `cuts` and `name` live in App. After a save that only
 * half succeeded, App has to swap the page list *and* rebuild the cuts around
 * what is left — impossible from outside if the cuts lived here, short of
 * remounting the screen and losing the name the user typed.
 */
export function SplitScanScreen({
  pages,
  cuts,
  name,
  isBusy,
  progress,
  onCutsChange,
  onNameChange,
  onBack,
  onSave,
}: SplitScanScreenProps) {
  const groups = planSplit(pages.length, cuts)
  const titles = splitTitles(name, groups.length)
  // Which group each page belongs to, so a header can be drawn where one starts.
  const groupOfPage = new Map<number, number>()
  groups.forEach((group, groupIndex) => {
    for (const pageIndex of group) groupOfPage.set(pageIndex, groupIndex)
  })

  return (
    <div className="screen screen--flow">
      <header className="flow-header">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Kembali">
          <ChevronLeftIcon size={20} />
        </button>
        <div className="flow-header__titles">
          <h1>Pisah Hasil Pindai</h1>
          <p>
            {pages.length} halaman → {groups.length} dokumen
          </p>
        </div>
      </header>

      <label className="split-name">
        <span>Nama</span>
        <input
          type="text"
          value={name}
          placeholder="Kosongkan untuk nama bawaan"
          onChange={(event) => onNameChange(event.target.value)}
          disabled={isBusy}
        />
      </label>

      {/*
        Patterns and hand-adjustment are not separate modes: a pattern only
        fills the cuts, and every one of them can still be moved afterwards.
      */}
      <div className="split-patterns">
        <button
          type="button"
          className="split-chip"
          onClick={() => onCutsChange(everyNCuts(pages.length, 1))}
          disabled={isBusy}
        >
          Tiap 1 halaman
        </button>
        <button
          type="button"
          className="split-chip"
          onClick={() => onCutsChange(everyNCuts(pages.length, 2))}
          disabled={isBusy}
        >
          Tiap 2 halaman
        </button>
        <button
          type="button"
          className="split-chip"
          onClick={() => onCutsChange([])}
          disabled={isBusy}
        >
          Bersihkan pemisah
        </button>
      </div>

      <ol className="split-list">
        {pages.map((page, index) => {
          const groupIndex = groupOfPage.get(index) ?? 0
          const isCut = cuts.includes(index)
          const startsGroup = groups[groupIndex]?.[0] === index

          return (
            <li key={page} className="split-item">
              {index > 0 && (
                <button
                  type="button"
                  className={`split-cut${isCut ? ' split-cut--on' : ''}`}
                  onClick={() => onCutsChange(toggleCut(cuts, index))}
                  disabled={isBusy}
                  aria-pressed={isCut}
                  aria-label={
                    isCut
                      ? `Gabungkan halaman ${index} dan ${index + 1}`
                      : `Pisah antara halaman ${index} dan ${index + 1}`
                  }
                >
                  <span>{isCut ? 'Dokumen baru mulai di sini' : 'Pisah di sini'}</span>
                </button>
              )}

              {startsGroup && (
                <p className="split-group__title">
                  {titles[groupIndex]
                    ? `Dokumen ${groupIndex + 1} — ${titles[groupIndex]}`
                    : `Dokumen ${groupIndex + 1}`}
                </p>
              )}

              <div className="split-page">
                <PageImage source={page} raw alt={`Halaman ${index + 1}`} />
                <span className="split-page__number">{index + 1}</span>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="flow-footer">
        {progress && (
          <p className="split-progress">
            Menyimpan… {progress.done} dari {progress.total}
          </p>
        )}
        <button
          type="button"
          className="button button--primary"
          disabled={isBusy}
          onClick={() => onSave(groups.map((group) => group.map((index) => pages[index])))}
        >
          {isBusy ? 'Menyimpan…' : `Simpan ${groups.length} Dokumen`}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Tambahkan CSS**

Tambahkan di **akhir** `src/App.css` — hanya token yang sudah ada, tidak ada warna baru:

```css
/* ---------- layar Pisah Hasil Pindai (Fase 6 C2) ---------- */

.split-name {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-dim);
}

.split-name input {
  border: 1px solid var(--chip-border);
  background: var(--surface);
  color: var(--fg);
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 15px;
}

.split-patterns {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 10px 2px 12px;
  scrollbar-width: none;
}

.split-patterns::-webkit-scrollbar {
  display: none;
}

.split-chip {
  flex: 0 0 auto;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid var(--chip-border);
  background: var(--surface);
  color: var(--fg);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.split-chip:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.split-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}

.split-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.split-group__title {
  font-size: 13px;
  font-weight: 700;
  color: var(--acc);
  margin: 4px 0 0;
}

.split-page {
  position: relative;
  border: 1px solid var(--chip-border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--surface);
  height: 92px;
}

.split-page .page-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.split-page__number {
  position: absolute;
  left: 8px;
  bottom: 8px;
  font-size: 11px;
  font-weight: 700;
  color: var(--fg);
  background: var(--chip);
  border-radius: 7px;
  padding: 2px 7px;
}

/* A tap target, not a hairline: this is the control the whole screen is about. */
.split-cut {
  width: 100%;
  padding: 9px;
  margin: 4px 0;
  border: 1px dashed var(--chip-border);
  border-radius: 10px;
  background: none;
  color: var(--fg-dim);
  font-size: 12px;
  font-weight: 600;
}

.split-cut--on {
  border-style: solid;
  border-color: var(--acc);
  background: var(--acc-soft);
  color: var(--acc);
}

.split-progress {
  font-size: 12.5px;
  color: var(--fg-dim);
  text-align: center;
  margin: 0 0 8px;
}
```

- [ ] **Step 5: Jalankan test, pastikan hijau**

Run: `npm run test:browser -- SplitScanScreen`
Expected: PASS, 11 test.

- [ ] **Step 6: Buktikan test-nya menggigit**

1. Di tombol Simpan, ganti `onSave(groups.map(...))` jadi `onSave([pages])` → test "hands over the groups the cuts describe" harus **merah**. Kembalikan.
2. Hapus `disabled={isBusy}` di tombol Simpan → test "is shut while a save is running" harus **merah**. Kembalikan.

- [ ] **Step 7: Commit**

```bash
git add src/screens/SplitScanScreen.tsx src/screens/SplitScanScreen.browser.test.tsx src/App.css
git commit -m "feat(pisah): layar Pisah Hasil Pindai dengan pola siap pakai & gunting manual"
```

---

### Task 4: Menyambungkan ke alur pindai (`ReviewScreen` + `App.tsx`)

**Files:**
- Modify: `src/screens/ReviewScreen.tsx`
- Create: `src/screens/ReviewScreen.browser.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css` (satu blok tambahan)

**Interfaces:**
- Consumes: `SplitScanScreen` (Task 3); `saveSplitScan`, `everyNCuts`, `boundaryCuts`, `canSplitScan` (Task 1 & 2).
- Produces: props baru di `ReviewScreen` — `tier: Tier`, `onSplit: () => void`, `onUpgrade: () => void`.

- [ ] **Step 1: Tulis test yang gagal untuk tombol di ReviewScreen**

Buat `src/screens/ReviewScreen.browser.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ReviewScreen } from './ReviewScreen'

async function renderScreen(overrides: Partial<Parameters<typeof ReviewScreen>[0]> = {}) {
  return await render(
    <ReviewScreen
      pages={['uri-1', 'uri-2', 'uri-3']}
      currentIndex={0}
      tier="pro"
      isBusy={false}
      onSelectPage={() => {}}
      onPreview={() => {}}
      onRemovePage={() => {}}
      onAddPages={() => {}}
      onCancel={() => {}}
      onSave={() => {}}
      onSplit={() => {}}
      onUpgrade={() => {}}
      {...overrides}
    />,
  )
}

describe('the split button', () => {
  it('opens the split screen for Pro', async () => {
    const onSplit = vi.fn()
    const onUpgrade = vi.fn()
    const screen = await renderScreen({ onSplit, onUpgrade })

    await screen.getByRole('button', { name: /Pisah jadi Beberapa Dokumen/ }).click()

    expect(onSplit).toHaveBeenCalled()
    expect(onUpgrade).not.toHaveBeenCalled()
  })

  it('sends Basic to the paywall instead of a dead screen', async () => {
    const onSplit = vi.fn()
    const onUpgrade = vi.fn()
    const screen = await renderScreen({ tier: 'basic', onSplit, onUpgrade })

    await screen.getByRole('button', { name: /Pisah jadi Beberapa Dokumen/ }).click()

    expect(onUpgrade).toHaveBeenCalled()
    expect(onSplit).not.toHaveBeenCalled()
  })

  it('is not offered at all for a single page', async () => {
    // Splitting one page into several documents is not a thing.
    const screen = await renderScreen({ pages: ['uri-1'] })

    await expect
      .element(screen.getByRole('button', { name: /Pisah jadi Beberapa Dokumen/ }))
      .not.toBeInTheDocument()
  })

  it('still saves the whole scan as one document', async () => {
    const onSave = vi.fn()
    const screen = await renderScreen({ onSave })

    await screen.getByRole('button', { name: 'Simpan Dokumen (3 halaman)' }).click()

    expect(onSave).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Jalankan test, pastikan merah**

Run: `npm run test:browser -- ReviewScreen`
Expected: FAIL — tombol "Pisah jadi Beberapa Dokumen" tidak ada (dan TypeScript mengeluh soal props `tier`/`onSplit`/`onUpgrade`).

- [ ] **Step 3: Tambahkan tombolnya di `ReviewScreen`**

Di `src/screens/ReviewScreen.tsx` tambahkan impor:

```tsx
import { canSplitScan } from '../lib/scanSplit'
import type { Tier } from '../lib/tier'
```

Tambahkan tiga props ke `ReviewScreenProps` **dan** ke daftar destructuring parameter komponennya:

```tsx
  tier: Tier
  /** Opens the split screen. Only reached when the tier allows it. */
  onSplit: () => void
  onUpgrade: () => void
```

Ganti isi `.flow-footer` (di akhir berkas) dengan:

```tsx
      <div className="flow-footer">
        <button type="button" className="button button--primary" onClick={onSave} disabled={isBusy}>
          {isBusy ? 'Menyimpan…' : `Simpan Dokumen (${pages.length} halaman)`}
        </button>

        {/*
          Hidden for a single page: there is nothing to split. Basic gets the
          paywall rather than a dead button — the screen behind it works, it is
          just not theirs yet. Two is the smallest split that is really a split,
          which is what `canSplitScan` is being asked about here.
        */}
        {pages.length > 1 && (
          <button
            type="button"
            className="button split-entry"
            onClick={() => (canSplitScan(tier, 2) ? onSplit() : onUpgrade())}
            disabled={isBusy}
          >
            <span>Pisah jadi Beberapa Dokumen</span>
            {!canSplitScan(tier, 2) && <span className="pro-badge">Pro</span>}
          </button>
        )}
      </div>
```

Tambahkan di akhir `src/App.css` (menyusul blok Task 3):

```css
.split-entry {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
  padding: 13px;
  font-size: 14.5px;
  background: var(--chip);
  border: 1px solid var(--chip-border);
  color: var(--fg);
}
```

- [ ] **Step 4: Jalankan test, pastikan hijau**

Run: `npm run test:browser -- ReviewScreen`
Expected: PASS, 4 test.

- [ ] **Step 5: Sambungkan `App.tsx`**

**5a. Impor.** Tambahkan:

```tsx
import { SplitScanScreen } from './screens/SplitScanScreen'
import { boundaryCuts, everyNCuts, saveSplitScan } from './lib/scanSplit'
```

**5b. State.** Di dekat `const [reviewPreview, setReviewPreview] = useState<number | null>(null)`:

```tsx
  /** Split screen is on top of the review screen, and what it is holding. */
  const [splitting, setSplitting] = useState(false)
  const [splitCuts, setSplitCuts] = useState<number[]>([])
  const [splitName, setSplitName] = useState('')
  /**
   * How many documents this split session has already saved.
   *
   * Only non-zero after a save that half succeeded: the retry continues the
   * numbering rather than minting a second "Kwitansi (1)".
   */
  const [splitSaved, setSplitSaved] = useState(0)
  const [splitProgress, setSplitProgress] = useState<{ done: number; total: number } | null>(null)
```

**5c. Handler.** Letakkan `exitSplit` **di atas** `handleStartScan` (dipakai di sana), sisanya setelah `handleSaveDocument`:

```tsx
  /** Leaves split mode and forgets everything it was holding. */
  const exitSplit = () => {
    setSplitting(false)
    setSplitCuts([])
    setSplitName('')
    setSplitSaved(0)
    setSplitProgress(null)
  }
```

```tsx
  const handleStartSplit = () => {
    // Opens on "one document per page": that is the case the feature exists
    // for — a stack of receipts or ID cards scanned in one run.
    setSplitCuts(everyNCuts(pendingPages?.length ?? 0, 1))
    setSplitName('')
    setSplitSaved(0)
    setSplitting(true)
  }

  const handleSplitSave = async (groups: string[][]) => {
    setIsSaving(true)
    try {
      const result = await saveSplitScan(groups, splitName, tier, splitSaved, (done, total) =>
        setSplitProgress({ done, total }),
      )
      await refreshDocuments()
      setToast(result.message)

      if (result.remaining.length === 0) {
        setPendingPages(null)
        exitSplit()
        setTab('documents')
      } else {
        // The groups that failed stay on screen with their cuts rebuilt around
        // them, so Simpan can be pressed again without scanning anything twice.
        setPendingPages(result.remaining.flat())
        setSplitCuts(boundaryCuts(result.remaining))
        setSplitSaved((count) => count + result.saved.length)
        setCurrentPage(0)
      }

      // Once for the whole split session, not once per document: written per
      // document, a subscription that lapses later would fire eight
      // interstitials back to back.
      if (result.saved.length > 0) void maybeShowInterstitial('scan-saved', tier)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Gagal menyimpan dokumen.')
    } finally {
      setIsSaving(false)
      setSplitProgress(null)
    }
  }
```

**5d. Reset saat sesi pindai berganti.** Di `handleStartScan`, setelah `setReviewPreview(null)`, tambahkan `exitSplit()`. Di `handleSaveDocument`, tepat setelah `setPendingPages(null)`, tambahkan `exitSplit()` juga — menyimpan biasa mengakhiri sesi yang sama.

**5e. Render.** Di dalam blok `if (pendingPages) {`, **sebelum** cek `reviewPreview`:

```tsx
    if (splitting) {
      return (
        <div className="app">
          <SplitScanScreen
            pages={pendingPages}
            cuts={splitCuts}
            name={splitName}
            isBusy={isSaving}
            progress={splitProgress}
            onCutsChange={setSplitCuts}
            onNameChange={setSplitName}
            onBack={() => setSplitting(false)}
            onSave={handleSplitSave}
          />
          {toast && <p className="toast">{toast}</p>}
        </div>
      )
    }
```

Lalu di elemen `<ReviewScreen …>` tambahkan tiga props dan bereskan `onCancel`:

```tsx
          tier={tier}
          onSplit={handleStartSplit}
          onUpgrade={() => setView({ kind: 'upgrade' })}
          onCancel={() => {
            setPendingPages(null)
            exitSplit()
          }}
```

**5f. Paywall harus bisa muncul di atas layar Tinjau.** Ini gotcha sungguhan: blok `if (pendingPages)` mengembalikan layar Tinjau **sebelum** `if (view.kind === 'upgrade')` sempat dibaca, jadi `setView({ kind: 'upgrade' })` dari tombol Pisah tidak akan menampilkan apa pun — tombolnya akan terlihat mati untuk akun Basic. **Pindahkan seluruh blok `if (view.kind === 'upgrade') { … }` ke atas blok `if (pendingPages) {`.** Menutup paywall (`setView({ kind: 'tabs' })`) mengembalikan user ke layar Tinjau, karena `pendingPages` tidak disentuh.

- [ ] **Step 6: Typecheck, lint, seluruh suite**

Run: `npm run build`
Expected: sukses tanpa error TypeScript.

Run: `npm run lint`
Expected: bersih.

Run: `npm test`
Expected: semua hijau — **total 572** (503 node + 69 browser).

- [ ] **Step 7: Periksa manual di browser dev**

Run: `npm run dev`, buka aplikasinya, telusuri alur Pisah kalau bisa. Kalau login Supabase menghalangi (seperti di sesi C1), catat itu apa adanya dan andalkan test + daftar uji device — jangan mengklaim sudah dicoba manual kalau tidak.

- [ ] **Step 8: Commit**

```bash
git add src/screens/ReviewScreen.tsx src/screens/ReviewScreen.browser.test.tsx src/App.tsx src/App.css
git commit -m "feat(pisah): tombol Pisah di layar Tinjau & alur simpan banyak dokumen di App"
```

---

### Task 5: Code review, security check, dan update `TASKS.md`

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Jalankan code-review**

Jalankan `/code-review` untuk diff cabang ini (correctness + reuse + simplification). Nilai tiap temuan sebelum menerapkannya — temuan yang keliru dijawab dengan alasan, bukan diikuti (skill `superpowers:receiving-code-review`; memori "tutup temuan review sebelum lanjut" — jangan menumpuk temuan ke potongan berikutnya).

- [ ] **Step 2: Jalankan security-review**

Jalankan `/security-review` sebelum commit terakhir (CLAUDE.md 9.1). C2 tidak menyentuh Supabase, R2, maupun signed URL, jadi yang diharapkan bersih — laporkan kalau ternyata tidak.

- [ ] **Step 3: Update `TASKS.md`**

- Ubah baris `- [~] Batch scan/export — C1 selesai, C2 (pisah sesi pindai) menyusul` jadi `- [x] Batch scan/export — C1 & C2 selesai`.
- Tambahkan bagian baru **"### Fase 6 bagian 5 — Pisah Hasil Pindai (C2) — 25 Agustus 2026"** setelah bagian C1, isinya apa yang benar-benar dikerjakan: gerbang "lebih dari satu dokumen butuh Pro" (dan alasan pengecualiannya), kelompok gagal tetap tinggal di layar, penomoran lanjut setelah gagal sebagian, pemindahan blok paywall di `App.tsx`, jumlah test baru, dan bukti sabotase test.
- Salin daftar uji device "Setelah C2" dari spec Bagian 7 sebagai checkbox kosong di bawah judul **"Belum diverifikasi di device fisik (butuh Boss Ali)"**.

- [ ] **Step 4: Commit**

```bash
git add TASKS.md
git commit -m "docs(tasks): tandai Fase 6 C2 selesai & catat daftar uji device"
```

---

## Catatan penutup untuk pelaksana

- **Yang sengaja TIDAK dikerjakan di C2** (spec Bagian 5): tidak ada perkiraan ukuran, tidak ada pilihan format, tidak ada perubahan pada `resolvePage()`/`schemaVersion`, tidak ada perubahan pada cadangan cloud, merge, atau kebijakan iklan.
- **Kalau `saveScanDocument` terasa butuh perubahan** untuk mendukung C2 — jangan. Ia sudah menerima `title` opsional dan sudah membersihkan foldernya sendiri saat gagal di tengah; itu persis yang dibutuhkan di sini.
- **Kalau muncul keputusan bisnis/angka baru** (mis. batas jumlah dokumen hasil pisah) — berhenti dan tanya Boss Ali, jangan mengarang angka (CLAUDE.md Bagian 5 poin 5).
