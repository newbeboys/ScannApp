# Fase 7A — Perbaiki Pencahayaan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dokumen tersimpan punya sakelar **Perbaiki Pencahayaan** yang meratakan cahaya & menghapus bayangan di setiap halaman — metode klasik, deterministik, on-device, semua tier — sebagai tahap tersendiri sebelum filter, sehingga bisa dipakai **bersamaan** dengan Hitam-Putih.

**Architecture:** Matematikanya di modul murni baru `src/lib/enhance.ts` (estimasi peta cahaya 16×16 dari citra kerja 256px, lalu koreksi pembagian dengan interpolasi bilinear langsung dari kisi — latar tidak pernah dimaterialisasi). Kanvasnya di `imageEditor.enhancePage()`, mengikuti pola `filterImage`. Rantai turunan halaman naik dari empat jadi lima tahap: `original → edited → enhanced → filtered → annotated`, schema `5 → 6`. Orkestrasinya dua fungsi **baru** di `scanStorage` (`applyDocumentEnhance` dengan `signal` + `onProgress`, dan `applyPageEnhance` untuk sesudah crop/rotate) — tanda tangan fungsi filter yang sudah ada **tidak** diubah. UI-nya satu mode baru di `EditorScreen`.

**Tech Stack:** React 19 + TypeScript + Vite + Capacitor 8; Canvas 2D API (`getImageData`/`putImageData`/`toBlob`); Vitest suite `node` untuk matematika, migrasi & penyimpanan, suite `browser` (Chromium via Playwright) untuk kanvas & komponen. **Nol dependency baru**, npm maupun Gradle.

**Spec:** `docs/superpowers/specs/2026-08-30-fase7a-perbaiki-pencahayaan-design.md`

## Global Constraints

- **Tier: semua tier, tanpa gerbang sama sekali.** Basic dan Pro setara. Jangan menulis satu pun cek `tier` di jalur ini — tidak di UI, tidak di library. (Keputusan Boss Ali 29 Agustus 2026; PRD Bagian 4, CLAUDE.md Bagian 6.)
- **Nama: "Perbaiki Pencahayaan". Dilarang menulis "AI" atau "AI Enhance"** di teks yang dilihat user, di mana pun — label tombol, judul, keterangan, toast. Nama "AI Enhance" disimpan untuk versi model TFLite. Ada tes komponen yang menjaga aturan ini (Task 7).
- **Nama internal kode tetap netral:** `enhancePage()`, `ScanPage.enhanced`, `LocalScanDocument.enhance`, `enhanceSource()`. Ini seam untuk versi model — jangan menaruh kata "shadow"/"light" di nama API publiknya.
- **Nol dependency baru.** Tidak ada npm install, tidak ada perubahan Gradle.
- **Bahasa komentar: Inggris** di semua berkas `src/lib/**` dan `src/components/**` yang disentuh plan ini (mengikuti tetangganya: `filters.ts`, `imageEditor.ts`, `scanStorage.ts` semuanya Inggris). Teks yang dilihat user tetap **Bahasa Indonesia**. Jangan mencampur dua bahasa dalam satu berkas (CLAUDE.md Bagian 4).
- **Dua suite test, pilih yang benar** (CLAUDE.md Bagian 4): `*.test.ts` → suite `node` untuk logika murni; `*.browser.test.ts(x)` → Chromium sungguhan untuk kode kanvas & komponen React. **Jangan me-mock canvas untuk menguji kode canvas.** `render()` dari `vitest-browser-react` mengembalikan Promise — wajib `await`.
- **Angka algoritma di plan ini teknis, bukan angka bisnis** — boleh disetel ulang tanpa bertanya ke Boss Ali: kisi 16×16, citra kerja 256px, persentil 0,95, jendela MAD 5×5, `σ̂ = max(1,4826 × MAD, 4)`, ambang `p_i < m − 3σ̂`, katup batal >50%, batas penguatan 2,5×, kualitas encode 0,9.
- **Satu angka yang BUKAN teknis: gerbang ±30 detik untuk 20 halaman di Task 3.** Kalau proyeksi melewatinya, **berhenti dan lapor ke Boss Ali** — jangan lanjut ke UI, jangan memutuskan sendiri rancangan penggantinya.
- Perintah: `npm run test:node`, `npm run test:browser`, `npm test` (keduanya), `npm run build` (typecheck + build), `npm run lint` (oxlint).
- **Basis test sekarang: 705 tes node di 48 berkas** (`npm run test:node`, 30 Agustus 2026 pagi). Tiap task menyebut angka yang diharapkan setelahnya sebagai pemeriksaan kasar, bukan sebagai target.
- Commit per task, conventional commits, akhiri dengan `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Matematika peta cahaya (`enhance.ts`)

**Files:**
- Create: `src/lib/enhance.ts`
- Create: `src/lib/enhance.test.ts`

**Interfaces:**
- Consumes: `luminance()` dari `src/lib/filters.ts` (sudah ada, sudah diekspor).
- Produces:
  - `export const GRID = 16`
  - `export const WORK_EDGE = 256`
  - `export const MAX_GAIN = 2.5`
  - `export function estimateLightGrid(data: Uint8ClampedArray, width: number, height: number, cols?: number, rows?: number): Float32Array | null`
  - `export function correctLighting(data: Uint8ClampedArray, width: number, height: number, grid: Float32Array, cols?: number, rows?: number, maxGain?: number): void`

  Task 2 memakai keempatnya. `null` dari `estimateLightGrid` berarti "peta cahayanya tidak bisa dipercaya, biarkan halaman ini apa adanya" — Task 2 meneruskannya sebagai `null`, Task 5 menghitungnya sebagai `unchanged`.

- [ ] **Step 1: Tulis tesnya dulu — `src/lib/enhance.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { correctLighting, estimateLightGrid, GRID, MAX_GAIN } from './enhance'
import { luminance } from './filters'

/** A flat grey page — no shadow anywhere. */
function flatPage(width: number, height: number, value: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
    data[i + 3] = 255
  }
  return data
}

/** A page whose paper darkens from left to right — a hand's shadow across it. */
function shadowedPage(
  width: number,
  height: number,
  left: number,
  right: number,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const paper = left + ((right - left) * x) / (width - 1)
      const i = (y * width + x) * 4
      data[i] = paper
      data[i + 1] = paper
      data[i + 2] = paper
      data[i + 3] = 255
    }
  }
  return data
}

/** Luminance of one pixel. */
function lumaAt(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  const i = (y * width + x) * 4
  return luminance(data[i], data[i + 1], data[i + 2])
}

/** Paints a solid block over one tile of a 16x16 grid on a 256px page. */
function paintTile(data: Uint8ClampedArray, width: number, tx: number, ty: number, value: number) {
  const size = width / GRID
  for (let y = ty * size; y < (ty + 1) * size; y++) {
    for (let x = tx * size; x < (tx + 1) * size; x++) {
      const i = (y * width + x) * 4
      data[i] = value
      data[i + 1] = value
      data[i + 2] = value
    }
  }
}

describe('estimateLightGrid', () => {
  it('follows the shadow: the lit side reads far brighter than the dark side', () => {
    const grid = estimateLightGrid(shadowedPage(256, 256, 210, 90), 256, 256)!

    expect(grid[0]).toBeGreaterThan(grid[GRID - 1] + 80)
  })

  it('reads a page with even lighting as even', () => {
    const grid = estimateLightGrid(flatPage(256, 256, 200), 256, 256)!
    const values = Array.from(grid)

    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(2)
  })

  /**
   * The failure this locks out. A pasted photo or a solid black block reports
   * "the paper is dark here" when the paper is not dark at all. Following that
   * reading would multiply the block by the gain cap and wash the photo out.
   */
  it('patches a black block from its neighbours instead of believing it', () => {
    const data = flatPage(256, 256, 200)
    paintTile(data, 256, 8, 8, 10)

    const grid = estimateLightGrid(data, 256, 256)!

    expect(grid[8 * GRID + 8]).toBeGreaterThan(150)
  })

  it('gives up when most tiles have no pixels at all', () => {
    // 5x5 pixels against a 16x16 grid: 231 of 256 tiles are empty.
    expect(estimateLightGrid(flatPage(5, 5, 200), 5, 5)).toBeNull()
  })
})

describe('correctLighting', () => {
  it('flattens a shadow that spans the page', () => {
    const data = shadowedPage(256, 256, 210, 90)
    const before = Math.abs(lumaAt(data, 256, 8, 128) - lumaAt(data, 256, 248, 128))

    correctLighting(data, 256, 256, estimateLightGrid(data, 256, 256)!)
    const after = Math.abs(lumaAt(data, 256, 8, 128) - lumaAt(data, 256, 248, 128))

    expect(before).toBeGreaterThan(100)
    expect(after).toBeLessThan(20)
  })

  /**
   * The stage flattens lighting; it never darkens. That is what `target =
   * max(grid)` buys, and it is what keeps the filters downstream working on a
   * page shaped the way they expect.
   */
  it('never makes any pixel darker than it was', () => {
    const data = shadowedPage(256, 256, 210, 90)
    const before = Uint8ClampedArray.from(data)

    correctLighting(data, 256, 256, estimateLightGrid(data, 256, 256)!)

    let darkened = false
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < before[i]) darkened = true
    }
    expect(darkened).toBe(false)
  })

  it('caps the gain, so a near-black corner is not turned into amplified noise', () => {
    const data = shadowedPage(256, 256, 250, 20)

    correctLighting(data, 256, 256, estimateLightGrid(data, 256, 256)!)

    // 20 x 2.5 = 50; anything above that means the cap did not hold.
    expect(lumaAt(data, 256, 255, 128)).toBeLessThan(55)
  })

  it('keeps ink darker than the paper around it', () => {
    const data = shadowedPage(256, 256, 210, 90)
    for (let y = 0; y < 256; y++) {
      const i = (y * 256 + 240) * 4
      data[i] = data[i] * 0.25
      data[i + 1] = data[i + 1] * 0.25
      data[i + 2] = data[i + 2] * 0.25
    }

    correctLighting(data, 256, 256, estimateLightGrid(data, 256, 256)!)

    expect(lumaAt(data, 256, 240, 128)).toBeLessThan(lumaAt(data, 256, 248, 128) - 100)
  })

  it('scales the channels together, so colour is not shifted', () => {
    const data = flatPage(256, 256, 40)
    // One bright tile makes the target, so the rest asks for real gain.
    paintTile(data, 256, 0, 0, 200)
    const i = (128 * 256 + 128) * 4
    data[i] = 80
    data[i + 1] = 40
    data[i + 2] = 20

    correctLighting(data, 256, 256, estimateLightGrid(data, 256, 256)!)

    expect(data[i] / data[i + 1]).toBeCloseTo(2, 1)
    expect(data[i + 1] / data[i + 2]).toBeCloseTo(2, 1)
  })

  it('leaves a page that is black all over exactly as it was', () => {
    const data = flatPage(64, 64, 0)

    correctLighting(data, 64, 64, estimateLightGrid(data, 64, 64)!)

    expect(data[0]).toBe(0)
  })

  it('exposes the gain cap it enforces', () => {
    expect(MAX_GAIN).toBe(2.5)
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm run test:node -- enhance`
Expected: FAIL — `Failed to resolve import "./enhance"`.

- [ ] **Step 3: Tulis `src/lib/enhance.ts`**

```ts
import { luminance } from './filters'

/**
 * The pixel maths behind "Perbaiki Pencahayaan" — Fase 7A.
 *
 * Free of canvas and every other DOM API, exactly like `filters.ts`: these read
 * or mutate a raw RGBA buffer, so they can be unit-tested under Node against
 * pixels whose right answer is known. `imageEditor.enhancePage` does the
 * decoding and encoding around them.
 *
 * Ordinary deterministic image processing — no model, no new dependency. The
 * name "AI Enhance" belongs to the TFLite version and must not be used for this
 * one in any UI or copy (CLAUDE.md Bagian 6).
 */

/** Tiles per axis in the light map. */
export const GRID = 16

/** Long edge of the work image the map is estimated from. */
export const WORK_EDGE = 256

/**
 * Most a pixel may be multiplied by.
 *
 * Without it a near-black corner asks for a gain of twenty, and what comes back
 * is amplified sensor noise rather than paper.
 */
export const MAX_GAIN = 2.5

/**
 * How bright a tile's paper is taken to be.
 *
 * A percentile, not a mean — a mean is dragged down by every letter on the tile
 * — and not the maximum, which one reflection off a staple would own.
 */
const PERCENTILE = 0.95

/** Half-width of the tile neighbourhood outliers are judged against: 5x5. */
const WINDOW_RADIUS = 2

/** Turns a median absolute deviation into a standard-deviation estimate. */
const MAD_SCALE = 1.4826

/**
 * Floor under the deviation estimate.
 *
 * MAD is exactly zero across plain paper, and without a floor the test would
 * then reject any tile differing by a single level.
 */
const MIN_SIGMA = 4

/** How many deviations below its neighbours a tile must sit to be rejected. */
const OUTLIER_K = 3

/** Past this share of rejected tiles the map is not worth trusting at all. */
const MAX_REJECTED = 0.5

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/**
 * Fills a rejected tile from the accepted tiles nearest to it.
 *
 * The square grows until it finds something rather than reaching for a global
 * average: lighting is a local property, and a tile in a dark corner should be
 * patched from that corner, not from the lit half of the page.
 */
function patchFromNeighbours(
  raw: Float32Array,
  rejected: Uint8Array,
  tx: number,
  ty: number,
  cols: number,
  rows: number,
): number {
  for (let radius = 1; radius <= Math.max(cols, rows); radius++) {
    let total = 0
    let count = 0

    for (let y = Math.max(0, ty - radius); y <= Math.min(rows - 1, ty + radius); y++) {
      for (let x = Math.max(0, tx - radius); x <= Math.min(cols - 1, tx + radius); x++) {
        const cell = y * cols + x
        if (rejected[cell]) continue
        total += raw[cell]
        count++
      }
    }

    if (count > 0) return total / count
  }

  return raw[ty * cols + tx]
}

/**
 * Estimates how much light fell on each part of the page.
 *
 * Returns one value per tile of a `cols` x `rows` grid, or `null` when too much
 * of the grid had to be thrown away to trust what is left — in which case the
 * caller must leave the page exactly as it is rather than dividing it by a
 * guess (design doc, Bagian 4.3).
 *
 * Meant to be handed a *work* image of about `WORK_EDGE` on its long side, not
 * a full-resolution page: lighting is a low-frequency signal, so sampling it at
 * 65k pixels instead of 12 million changes the answer by nothing measurable and
 * costs two orders of magnitude less.
 */
export function estimateLightGrid(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cols = GRID,
  rows = GRID,
): Float32Array | null {
  const raw = new Float32Array(cols * rows)
  const rejected = new Uint8Array(cols * rows)
  let rejectedCount = 0

  for (let ty = 0; ty < rows; ty++) {
    const y0 = Math.floor((ty * height) / rows)
    const y1 = Math.floor(((ty + 1) * height) / rows)

    for (let tx = 0; tx < cols; tx++) {
      const x0 = Math.floor((tx * width) / cols)
      const x1 = Math.floor(((tx + 1) * width) / cols)
      const cell = ty * cols + tx

      const values: number[] = []
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4
          values.push(luminance(data[i], data[i + 1], data[i + 2]))
        }
      }

      // No pixels landed in this tile — the work image is smaller than the
      // grid. Rejected rather than guessed; enough of these trip the valve
      // below and the page is left alone.
      if (values.length === 0) {
        rejected[cell] = 1
        rejectedCount++
        continue
      }

      values.sort((a, b) => a - b)
      raw[cell] = values[Math.min(values.length - 1, Math.floor(values.length * PERCENTILE))]
    }
  }

  /*
    Written to its own array, not back into `rejected`, so every verdict is
    read from the raw grid. Sharing one array lets a rejection change the
    neighbourhood the next tile is judged against, and rejection then spreads
    across the page from wherever it started.
  */
  const outlier = new Uint8Array(cols * rows)

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const cell = ty * cols + tx
      if (rejected[cell]) continue

      const window: number[] = []
      for (let y = Math.max(0, ty - WINDOW_RADIUS); y <= Math.min(rows - 1, ty + WINDOW_RADIUS); y++) {
        for (let x = Math.max(0, tx - WINDOW_RADIUS); x <= Math.min(cols - 1, tx + WINDOW_RADIUS); x++) {
          const neighbour = y * cols + x
          if (!rejected[neighbour]) window.push(raw[neighbour])
        }
      }
      if (window.length < 3) continue

      const centre = median(window)
      const sigma = Math.max(MAD_SCALE * median(window.map((v) => Math.abs(v - centre))), MIN_SIGMA)

      // Only tiles *darker* than their neighbourhood are suspect: that is what
      // ink, a photo, or a black block looks like. A brighter tile is a
      // brighter part of the page, which is exactly what is being measured.
      if (raw[cell] < centre - OUTLIER_K * sigma) {
        outlier[cell] = 1
        rejectedCount++
      }
    }
  }

  for (let cell = 0; cell < outlier.length; cell++) {
    if (outlier[cell]) rejected[cell] = 1
  }

  if (rejectedCount > cols * rows * MAX_REJECTED) return null

  const grid = Float32Array.from(raw)
  for (let cell = 0; cell < grid.length; cell++) {
    if (!rejected[cell]) continue
    grid[cell] = patchFromNeighbours(raw, rejected, cell % cols, Math.floor(cell / cols), cols, rows)
  }

  return grid
}

/**
 * Divides the page by its light map, in place.
 *
 * The reference is the map's own maximum rather than a fixed white level, so
 * the brightest paper on the page is left untouched and everything else is
 * lifted to meet it. That keeps this a *flattening* stage: it never darkens
 * anything, and it never doubles as a brightness control — `bright` and `magic`
 * already own that, and they run after this one.
 *
 * The map is never expanded to page size. For a 12 MP scan that array would be
 * 48MB, asked for while a 48MB pixel buffer is already open; the bilinear
 * lookup below reads the 256 numbers directly instead, with only the per-column
 * weights precomputed (design doc, Bagian 4.5).
 *
 * Alpha is never touched, and the destination being a `Uint8ClampedArray` means
 * the clamp on store is the browser's, not ours.
 */
export function correctLighting(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  grid: Float32Array,
  cols = GRID,
  rows = GRID,
  maxGain = MAX_GAIN,
): void {
  let target = 0
  for (let cell = 0; cell < grid.length; cell++) {
    if (grid[cell] > target) target = grid[cell]
  }

  // A page that is black all over has no paper to take as the reference, and
  // dividing by it would only amplify whatever noise is in there.
  if (target <= 1) return

  const leftIndex = new Int32Array(width)
  const rightIndex = new Int32Array(width)
  const weightX = new Float32Array(width)

  for (let x = 0; x < width; x++) {
    const gx = Math.min(cols - 1, Math.max(0, ((x + 0.5) * cols) / width - 0.5))
    const x0 = Math.floor(gx)
    leftIndex[x] = x0
    rightIndex[x] = Math.min(cols - 1, x0 + 1)
    weightX[x] = gx - x0
  }

  for (let y = 0; y < height; y++) {
    const gy = Math.min(rows - 1, Math.max(0, ((y + 0.5) * rows) / height - 0.5))
    const y0 = Math.floor(gy)
    const y1 = Math.min(rows - 1, y0 + 1)
    const wy = gy - y0
    const topRow = y0 * cols
    const bottomRow = y1 * cols

    for (let x = 0; x < width; x++) {
      const x0 = leftIndex[x]
      const x1 = rightIndex[x]
      const wx = weightX[x]

      const top = grid[topRow + x0] + (grid[topRow + x1] - grid[topRow + x0]) * wx
      const bottom = grid[bottomRow + x0] + (grid[bottomRow + x1] - grid[bottomRow + x0]) * wx
      const background = top + (bottom - top) * wy

      const gain = Math.min(target / Math.max(background, 1), maxGain)
      if (gain <= 1) continue

      const i = (y * width + x) * 4
      data[i] = data[i] * gain
      data[i + 1] = data[i + 1] * gain
      data[i + 2] = data[i + 2] * gain
    }
  }
}
```

- [ ] **Step 4: Jalankan tesnya sampai hijau**

Run: `npm run test:node -- enhance`
Expected: PASS, 11 tes.

- [ ] **Step 5: Typecheck & lint**

Run: `npm run build && npm run lint`
Expected: keduanya bersih.

- [ ] **Step 6: Commit**

```bash
git add src/lib/enhance.ts src/lib/enhance.test.ts
git commit -m "$(cat <<'EOF'
feat(enhance): peta cahaya 16x16 & koreksi pembagian untuk Perbaiki Pencahayaan

Matematika murni Fase 7A, tanpa DOM sama sekali supaya bisa diuji di suite
node melawan piksel yang jawabannya diketahui — pola yang sama dengan
filters.ts.

Estimasi: persentil ke-95 per ubin, penolakan pencilan lokal (median + MAD
jendela 5x5, sigma dilantai di 4), penambalan dari tetangga terdekat, dan
katup batal saat lebih dari separuh ubin ditolak.

Koreksi: target diambil dari maksimum peta, bukan putih tetap — jadi tahap
ini meratakan cahaya dan tidak pernah menggelapkan atau merangkap jadi
kontrol kecerahan. Latar tidak pernah dimaterialisasi seukuran halaman;
interpolasi bilinear membaca langsung dari 256 angka.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Sisi kanvas — `enhancePage()`

**Files:**
- Modify: `src/lib/imageEditor.ts` (tambah satu fungsi ekspor + satu import)
- Modify: `src/lib/imageEditor.browser.test.ts` (tambah blok describe)

**Interfaces:**
- Consumes: `estimateLightGrid`, `correctLighting`, `WORK_EDGE` dari Task 1; `decode`, `draw`, `toBlob`, `DERIVED_QUALITY` yang sudah ada di `imageEditor.ts` (semuanya module-private, dipakai langsung).
- Produces: `export async function enhancePage(blob: Blob): Promise<Blob | null>` — JPEG kualitas `DERIVED_QUALITY`, ukuran piksel sama dengan sumbernya, atau `null` kalau peta cahayanya ditolak. Task 5 memakai tanda tangan ini lewat tipe `EnhanceRenderer`; Task 6 menyambungkannya.

- [ ] **Step 1: Tulis tesnya dulu — tambahkan di akhir `src/lib/imageEditor.browser.test.ts`**

```ts
/** A page lit from the left: paper fading from bright to dark across the sheet. */
async function shadowedScan(width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const gradient = ctx.createLinearGradient(0, 0, width, 0)
  gradient.addColorStop(0, 'rgb(214, 212, 205)')
  gradient.addColorStop(1, 'rgb(92, 91, 88)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.92))
}

/** Luminance of one pixel of an encoded image, read back through a canvas. */
async function sample(blob: Blob, x: number, y: number): Promise<number> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const [r, g, b] = ctx.getImageData(x, y, 1, 1).data
  return 0.299 * r + 0.587 * g + 0.114 * b
}

describe('enhancePage', () => {
  it('flattens a shadow that runs across the page', async () => {
    const page = await shadowedScan(600, 800)
    const before = Math.abs((await sample(page, 20, 400)) - (await sample(page, 580, 400)))

    const enhanced = (await enhancePage(page))!
    const after = Math.abs((await sample(enhanced, 20, 400)) - (await sample(enhanced, 580, 400)))

    expect(before).toBeGreaterThan(80)
    expect(after).toBeLessThan(30)
  })

  /**
   * The bytes, not the MIME type. What comes out is read back by the export,
   * the cloud backup and ML Kit, and all three care about the actual encoding
   * (CLAUDE.md Bagian 4).
   */
  it('produces a real JPEG', async () => {
    const enhanced = (await enhancePage(await shadowedScan(400, 500)))!
    const head = new Uint8Array(await enhanced.slice(0, 3).arrayBuffer())

    expect([head[0], head[1], head[2]]).toEqual([0xff, 0xd8, 0xff])
  })

  it('keeps the page the same size', async () => {
    const enhanced = (await enhancePage(await shadowedScan(400, 500)))!

    expect(await getImageSize(enhanced)).toEqual({ width: 400, height: 500 })
  })

  it('declines a page it cannot read the lighting of, instead of guessing', async () => {
    // 4x4 pixels: almost every tile of the 16x16 grid is empty.
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 4
    canvas.getContext('2d')!.fillRect(0, 0, 4, 4)
    const tiny = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), 'image/jpeg'),
    )

    expect(await enhancePage(tiny)).toBeNull()
  })
})
```

Tambahkan `enhancePage` ke daftar import di baris atas berkas itu (`import { compressImage, ..., enhancePage, getImageSize, rotateImage } from './imageEditor'`).

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm run test:browser -- imageEditor`
Expected: FAIL — `enhancePage is not a function` / import tidak ditemukan.

- [ ] **Step 3: Tulis implementasinya di `src/lib/imageEditor.ts`**

Tambahkan import di atas:

```ts
import { correctLighting, estimateLightGrid, WORK_EDGE } from './enhance'
```

lalu fungsinya, taruh tepat **sebelum** `filterImage` supaya urutan berkasnya mengikuti urutan rantainya:

```ts
/**
 * Flattens the lighting across a page — "Perbaiki Pencahayaan" (Fase 7A).
 *
 * A stage of its own, not a sixth filter: it runs *before* whichever filter the
 * document carries, so the two can be used together. That combination is where
 * the value is — Hitam-Putih on a shadowed page is what produces the black
 * blotches this removes.
 *
 * Only the canvas work lives here. The maths is in `enhance.ts`, kept free of
 * the DOM so it can be tested against known pixels under Node.
 *
 * `null` means the light map could not be trusted — see `estimateLightGrid`.
 * The caller must then leave the page exactly as it was; a page divided by a
 * guessed light map is worse than an untouched one.
 *
 * Deterministic maths, no model. The name "AI Enhance" is reserved for the
 * TFLite version, which will replace the body of this function and nothing else
 * (CLAUDE.md Bagian 6).
 */
export async function enhancePage(blob: Blob): Promise<Blob | null> {
  const bitmap = await decode(blob)
  const [canvas, ctx] = draw(bitmap.width, bitmap.height)
  ctx.drawImage(bitmap, 0, 0)

  // Estimated from a small copy, corrected at full size. Lighting is a
  // low-frequency signal: 65k pixels answer the question as well as 12 million,
  // and the map is 256 numbers either way (design doc, Bagian 4.1).
  const scale = Math.min(1, WORK_EDGE / Math.max(bitmap.width, bitmap.height))
  const [work, workCtx] = draw(bitmap.width * scale, bitmap.height * scale)
  workCtx.drawImage(bitmap, 0, 0, work.width, work.height)
  bitmap.close()

  const sample = workCtx.getImageData(0, 0, work.width, work.height)
  const grid = estimateLightGrid(sample.data, work.width, work.height)
  if (!grid) return null

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  correctLighting(image.data, canvas.width, canvas.height, grid)
  ctx.putImageData(image, 0, 0)

  return toBlob(canvas, DERIVED_QUALITY)
}
```

- [ ] **Step 4: Jalankan tesnya sampai hijau**

Run: `npm run test:browser -- imageEditor`
Expected: PASS — 4 tes baru di `describe('enhancePage')`, dan semua tes lama di berkas itu tetap hijau.

- [ ] **Step 5: Typecheck & lint**

Run: `npm run build && npm run lint`
Expected: bersih.

- [ ] **Step 6: Commit**

```bash
git add src/lib/imageEditor.ts src/lib/imageEditor.browser.test.ts
git commit -m "$(cat <<'EOF'
feat(enhance): enhancePage() — render koreksi cahaya di kanvas

Estimasi peta cahaya dari salinan 256px, koreksi di resolusi penuh, encode
di DERIVED_QUALITY yang sama dengan filterImage dan renderMarks — berkas ini
yang nanti dibaca ekspor dan cadangan cloud.

Mengembalikan null saat estimator menolak, dan pemanggilnya wajib
meninggalkan halaman apa adanya: halaman yang dibagi peta cahaya tebakan
lebih buruk daripada halaman yang tidak disentuh.

Diuji di Chromium sungguhan, bukan kanvas palsu — termasuk memeriksa tiga
byte pertama keluarannya benar-benar JPEG.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Gerbang pengukuran — **berhenti di sini kalau angkanya lewat**

Ini bukan pemeriksaan di akhir. Ini gerbang yang memutuskan apakah rancangan UI di Task 7 masih berlaku (spec Bagian 8; keputusan brainstorm 29 Agustus 2026).

**Files:**
- Create: `src/lib/enhanceBench.browser.test.ts`
- Modify: `TASKS.md` (catat angkanya di Fase 7A)

**Interfaces:**
- Consumes: `enhancePage` (Task 2), `estimateLightGrid`/`correctLighting` (Task 1).
- Produces: satu angka milidetik per halaman 12 MP di Chromium desktop, plus rinciannya per tahap. Tidak ada API baru untuk task berikutnya.

- [ ] **Step 1: Tulis benchmark-nya**

```ts
import { describe, expect, it } from 'vitest'
import { correctLighting, estimateLightGrid, WORK_EDGE } from './enhance'
import { enhancePage } from './imageEditor'

/**
 * Not a test of behaviour — a measurement, and a gate.
 *
 * Perbaiki Pencahayaan decodes and re-encodes every page at full resolution,
 * and Pro has no page limit. Before any progress UI was designed, the
 * brainstorm on 29 Agustus 2026 asked for the real number first: measure one
 * 12 MP page in Chromium, multiply by four for a mid-range phone (the baseline
 * device is a Xiaomi T15 flagship — if it feels slow there, mid-range is far
 * worse), and if twenty pages project past about 30 seconds the design changes
 * rather than the UI absorbing it.
 *
 * The breakdown matters as much as the total: decode and encode are fixed costs
 * this feature cannot avoid, while the estimate and the correction are the only
 * parts a redesign could actually shrink.
 */

async function bigScan(width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, 'rgb(214, 212, 205)')
  gradient.addColorStop(1, 'rgb(96, 95, 92)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#1a1a22'
  for (let y = 60; y < height - 60; y += 48) {
    ctx.fillRect(60, y, Math.max(20, width - 120 - ((y * 11) % 400)), 14)
  }

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.92))
}

describe('enhancePage cost on a 12 MP page', () => {
  it('measures the whole call and each stage inside it', async () => {
    const page = await bigScan(3000, 4000)

    const startedAll = performance.now()
    const result = await enhancePage(page)
    const total = performance.now() - startedAll
    expect(result).not.toBeNull()

    // The same stages again, timed one by one.
    const t0 = performance.now()
    const bitmap = await createImageBitmap(page, { imageOrientation: 'from-image' })
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const decodeMs = performance.now() - t0

    const t1 = performance.now()
    const scale = WORK_EDGE / Math.max(bitmap.width, bitmap.height)
    const work = document.createElement('canvas')
    work.width = Math.round(bitmap.width * scale)
    work.height = Math.round(bitmap.height * scale)
    const workCtx = work.getContext('2d')!
    workCtx.drawImage(bitmap, 0, 0, work.width, work.height)
    const grid = estimateLightGrid(
      workCtx.getImageData(0, 0, work.width, work.height).data,
      work.width,
      work.height,
    )!
    const estimateMs = performance.now() - t1
    bitmap.close()

    const t2 = performance.now()
    correctLighting(image.data, canvas.width, canvas.height, grid)
    ctx.putImageData(image, 0, 0)
    const correctMs = performance.now() - t2

    const t3 = performance.now()
    await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.9))
    const encodeMs = performance.now() - t3

    console.log(
      `[bench] enhancePage 3000x4000 — total ${Math.round(total)}ms ` +
        `(decode+getImageData ${Math.round(decodeMs)}ms, estimate ${Math.round(estimateMs)}ms, ` +
        `correct ${Math.round(correctMs)}ms, encode ${Math.round(encodeMs)}ms) — ` +
        `proyeksi 20 halaman di mid-range: ${Math.round((total * 4 * 20) / 1000)} detik`,
    )

    // Loose ceiling only, so a hang fails instead of stalling CI. The real gate
    // is the projection above, read by a human.
    expect(total).toBeLessThan(30_000)
  })
})
```

- [x] **Step 2: Jalankan dan baca angkanya**

Run: `npm run test:browser -- enhanceBench`
Expected: PASS, dan satu baris `[bench] …` di keluarannya. **Catat keempat angka dan proyeksinya.**

- [x] **Step 3: Terapkan gerbangnya** — tidak lolos (35 detik), dilaporkan ke Boss
  Ali, dan ditutup dengan batas `ENHANCED_EDGE` 2400 px + `resamplerFor()`:
  **265 ms/halaman, proyeksi 21 detik, LOLOS.** Rinciannya di `TASKS.md` Fase 7A
  dan spec Bagian 8.1. Task 4 boleh jalan.

Hitung: `proyeksi = total_ms × 4 × 20 / 1000` detik.

- **≤ ±30 detik** → lanjut ke Task 4. Tulis angkanya di `TASKS.md` (Step 4) dan teruskan.
- **> ±30 detik** → **BERHENTI. Jangan kerjakan Task 4–8.** Laporkan ke Boss Ali dalam Bahasa Indonesia, isinya: keempat angka terukur, proyeksinya, dan mana yang mendominasi (kalau decode+encode yang mendominasi, mengecilkan resolusi kerja koreksi **tidak** akan menolong — itu fakta yang menentukan pilihan mana yang masuk akal). Dua arah yang sudah disebut Boss Ali saat brainstorm: (a) resolusi kerja koreksi lebih kecil, (b) hanya dijalankan saat simpan/ekspor, bukan saat sakelar dinyalakan. Pilihannya milik Boss Ali, bukan milik eksekutor plan ini.

- [x] **Step 4: Catat angkanya di `TASKS.md`**

Di bawah butir "Ukur sebelum merancang UI progres" pada bagian **7A**, ganti `- [ ]` jadi `- [x]` dan tambahkan sub-baris hasil pengukurannya, format:

```markdown
  **Hasil ukur 30 Agustus 2026 (Chromium desktop, halaman 3000×4000):**
  total <T>ms/halaman — decode+getImageData <D>ms, estimasi <E>ms, koreksi <C>ms,
  encode <N>ms. Proyeksi mid-range (×4) untuk 20 halaman: **<P> detik**.
  Gerbang ±30 detik: **<lolos / tidak lolos>**.
```

- [x] **Step 5: Commit**

```bash
git add src/lib/enhanceBench.browser.test.ts TASKS.md
git commit -m "$(cat <<'EOF'
test(enhance): ukur biaya enhancePage per halaman 12 MP & catat gerbangnya

Gerbang dari brainstorm 29 Agustus 2026: ukur dulu, baru rancang UI progres.
Benchmark ini melaporkan total per halaman sekaligus rinciannya per tahap,
karena rinciannya yang menentukan pilihan kalau angkanya jelek — decode dan
encode adalah biaya tetap yang tidak bisa dihindari fitur ini, sedangkan
estimasi dan koreksi satu-satunya bagian yang bisa dikecilkan rancangan lain.

Batas 30 detik di assert-nya cuma penjaga supaya CI gagal alih-alih
menggantung; gerbang yang sebenarnya adalah proyeksi yang dibaca manusia.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Schema v6 — `enhanced` masuk rantai turunan

**Files:**
- Modify: `src/lib/scanIndexMigration.ts`
- Modify: `src/lib/scanIndexMigration.test.ts`
- Modify: `src/lib/scanStorage.ts` (baris re-export saja)
- Modify: berkas fixture yang masih menulis `schemaVersion: 5` (dilacak oleh typecheck di Step 5)

**Interfaces:**
- Consumes: tidak ada dari task sebelumnya.
- Produces:
  - `ScanPage.enhanced?: string`
  - `LocalScanDocument.enhance?: boolean`
  - `CURRENT_SCHEMA_VERSION = 6`
  - `export function enhanceSource(page: ScanPage): string` → `page.edited ?? page.original`
  - `resolvePage` = `annotated ?? filtered ?? enhanced ?? edited ?? original`
  - `filterSource` = `enhanced ?? edited ?? original`
  - `annotationSource` = `filtered ?? enhanced ?? edited ?? original`

  Task 5 memakai `enhanceSource` dan field `enhanced`/`enhance`; Task 7 membaca `page.enhanced` untuk menghitung berapa halaman yang sudah selesai.

- [ ] **Step 1: Tulis tesnya dulu — tambahkan di `src/lib/scanIndexMigration.test.ts`**

```ts
describe('schema v6 — Perbaiki Pencahayaan', () => {
  it('lifts a v5 document to v6 without losing anything', () => {
    const [doc] = migrateScanIndex([
      {
        schemaVersion: 5,
        id: 'doc-1',
        title: 'Kontrak',
        createdAt: '2026-08-25T00:00:00.000Z',
        pageCount: 1,
        filter: 'bw',
        pages: [{ original: 'scans/doc-1/page-1.jpg', edited: 'scans/doc-1/page-1-edited.jpg' }],
      },
    ])

    expect(doc.schemaVersion).toBe(6)
    expect(doc.filter).toBe('bw')
    expect(doc.pages[0].edited).toBe('scans/doc-1/page-1-edited.jpg')
    expect(doc.enhance).toBeUndefined()
  })

  it('keeps the lighting render while the document switch is on', () => {
    const [doc] = migrateScanIndex([
      {
        schemaVersion: 6,
        id: 'doc-1',
        title: 'Kontrak',
        createdAt: '2026-08-30T00:00:00.000Z',
        pageCount: 1,
        enhance: true,
        pages: [
          { original: 'scans/doc-1/page-1.jpg', enhanced: 'scans/doc-1/page-1-enhanced.jpg' },
        ],
      },
    ])

    expect(doc.enhance).toBe(true)
    expect(doc.pages[0].enhanced).toBe('scans/doc-1/page-1-enhanced.jpg')
  })

  /**
   * The same pairing rule the annotated render already follows. Without it a
   * document whose switch is off keeps displaying and exporting a corrected
   * page that nothing left in the index can explain, undo, or re-render.
   */
  it('drops the lighting render when the document switch is not on', () => {
    const [doc] = migrateScanIndex([
      {
        schemaVersion: 6,
        id: 'doc-1',
        title: 'Kontrak',
        createdAt: '2026-08-30T00:00:00.000Z',
        pageCount: 1,
        pages: [
          { original: 'scans/doc-1/page-1.jpg', enhanced: 'scans/doc-1/page-1-enhanced.jpg' },
        ],
      },
    ])

    expect(doc.enhance).toBeUndefined()
    expect(doc.pages[0].enhanced).toBeUndefined()
  })
})

describe('the derived chain with lighting in it', () => {
  const page = {
    original: 'a.jpg',
    edited: 'a-edited.jpg',
    enhanced: 'a-enhanced.jpg',
    filtered: 'a-filtered.jpg',
    annotated: 'a-annotated.jpg',
  }

  it('shows the ink render, which sits on top of everything', () => {
    expect(resolvePage(page)).toBe('a-annotated.jpg')
  })

  it('falls back to the lighting render when there is no filter and no ink', () => {
    expect(resolvePage({ original: 'a.jpg', edited: 'a-edited.jpg', enhanced: 'a-enhanced.jpg' }))
      .toBe('a-enhanced.jpg')
  })

  it('renders a filter from the lighting fix, so the two stack', () => {
    expect(filterSource(page)).toBe('a-enhanced.jpg')
  })

  it('renders the lighting fix from geometry alone, never from a filter', () => {
    expect(enhanceSource(page)).toBe('a-edited.jpg')
  })

  it('draws ink on the filter first, then the lighting fix, then the crop', () => {
    expect(annotationSource(page)).toBe('a-filtered.jpg')
    expect(annotationSource({ original: 'a.jpg', enhanced: 'a-enhanced.jpg' })).toBe('a-enhanced.jpg')
  })
})
```

Import di atas berkas tes itu saat ini `{ effectiveFilter, filterSource, hasEdits, migrateScanIndex, resolvePage }` — tambahkan **dua**: `annotationSource` dan `enhanceSource`.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm run test:node -- scanIndexMigration`
Expected: FAIL — `enhanceSource` tidak ada, dan `schemaVersion` masih 5.

- [ ] **Step 3: Ubah `src/lib/scanIndexMigration.ts`**

Di `interface ScanPage`, sisipkan **setelah** `edited` dan **sebelum** `filter`:

```ts
  /**
   * The lighting-corrected render, derived from `edited ?? original`.
   *
   * A stage of its own rather than a sixth filter, so it can be used together
   * with one — Hitam-Putih on a shadowed page is exactly where it earns its
   * place (design doc Fase 7A, Bagian 3). Only ever present while the
   * document's `enhance` switch is on.
   */
  enhanced?: string
```

Naikkan versinya dan tambahkan sakelarnya:

```ts
export const CURRENT_SCHEMA_VERSION = 6
```

```ts
export interface LocalScanDocument {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION
  id: string
  title: string
  createdAt: string
  pageCount: number
  pages: ScanPage[]
  /** Applies to every page that does not override it. */
  filter?: DocumentFilter
  /**
   * Whether "Perbaiki Pencahayaan" is on for this document. Every tier — there
   * is deliberately no tier check anywhere on this path (CLAUDE.md Bagian 6).
   */
  enhance?: boolean
  /** Set when this document was produced by merging others. */
  sourceDocumentIds?: string[]
}
```

`migratePage` menerima sakelar dokumennya dan memberlakukan aturan pasangan:

```ts
/** Keeps only the fields a page is allowed to carry, dropping anything malformed. */
function migratePage(page: ScanPage, enhanceOn: boolean): ScanPage {
  const marks = sanitizeMarks(page.marks)

  return {
    original: page.original,
    ...(typeof page.edited === 'string' ? { edited: page.edited } : {}),
    /*
      Paired with the document's switch, the way the annotated render is paired
      with its marks: a page that keeps a lighting render after the switch is
      off would display and export a correction that nothing left in the index
      can explain, undo, or re-render.
    */
    ...(enhanceOn && typeof page.enhanced === 'string' ? { enhanced: page.enhanced } : {}),
    ...(page.filter === 'none' || isDocumentFilter(page.filter) ? { filter: page.filter } : {}),
    ...(typeof page.filtered === 'string' ? { filtered: page.filtered } : {}),
    ...(marks.length > 0 ? { marks } : {}),
    ...(marks.length > 0 && typeof page.annotated === 'string'
      ? { annotated: page.annotated }
      : {}),
    ...(typeof page.text === 'string' ? { text: page.text } : {}),
  }
}
```

Di `migrateScanIndex`, hitung sakelarnya sebelum memetakan halaman, dan bawa ke hasilnya:

```ts
    const enhanceOn = entry.enhance === true

    let pages: ScanPage[]
    if (isV1(entry) && entry.pagePaths) {
      pages = entry.pagePaths.map((path) => ({ original: path }))
    } else if (Array.isArray(entry.pages)) {
      pages = entry.pages
        .filter((page) => page && typeof page.original === 'string')
        .map((page) => migratePage(page, enhanceOn))
    } else {
      continue
    }
```

```ts
    migrated.push({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: entry.id,
      title: entry.title ?? 'Dokumen tanpa judul',
      createdAt: entry.createdAt ?? new Date(0).toISOString(),
      pageCount: pages.length,
      pages,
      ...(isDocumentFilter(entry.filter) ? { filter: entry.filter } : {}),
      ...(enhanceOn ? { enhance: true } : {}),
      ...(entry.sourceDocumentIds ? { sourceDocumentIds: entry.sourceDocumentIds } : {}),
    })
```

Perbarui komentar doc `migrateScanIndex` supaya menyebut v6 (kalimat "Brings any stored index entry up to the v5 shape" jadi v6, dan tambahkan satu kalimat: v5 documents arrive with no lighting stage).

Empat fungsi resolusi rantainya:

```ts
/**
 * Resolves which file a page should currently display/export.
 *
 * Every consumer — the document list, the editor, export, merge, backup —
 * goes through here, which is why adding filters, and later the lighting
 * stage, needed no change in any of them.
 */
export function resolvePage(page: ScanPage): string {
  return page.annotated ?? page.filtered ?? page.enhanced ?? page.edited ?? page.original
}

/**
 * What a filter render must start from: the page with its geometry and its
 * lighting settled, never another filter.
 *
 * Reading the lighting render here is what makes the two stack — Hitam-Putih
 * applied to a page whose shadows have already been flattened, which is the
 * whole point of keeping them separate.
 */
export function filterSource(page: ScanPage): string {
  return page.enhanced ?? page.edited ?? page.original
}

/**
 * What a lighting render must start from: geometry only.
 *
 * Never the filter render — correcting a thresholded page means estimating the
 * light on an image that has already thrown its greys away — and never its own
 * previous output, which would compound the correction every time.
 */
export function enhanceSource(page: ScanPage): string {
  return page.edited ?? page.original
}

/**
 * What an annotation render must start from: the paper, without the previous
 * render of the ink. Reading the annotated file back would draw every stroke a
 * second time on top of itself, and undo would never remove anything.
 */
export function annotationSource(page: ScanPage): string {
  return page.filtered ?? page.enhanced ?? page.edited ?? page.original
}
```

- [ ] **Step 4: Re-export dari `scanStorage.ts`**

Tambahkan `enhanceSource` ke dua tempat di `src/lib/scanStorage.ts`: blok `import { ... } from './scanIndexMigration'` di atas, dan blok `export { ... } from './scanIndexMigration'` di bawahnya.

- [ ] **Step 5: Jalankan typecheck untuk menemukan semua fixture yang masih v5**

Run: `npm run build`
Expected: TypeScript menyebut setiap fixture yang masih menulis `schemaVersion: 5` pada objek bertipe `LocalScanDocument`. Yang sudah diketahui saat plan ini ditulis:

- `src/lib/batchExport.test.ts:71`
- `src/lib/documentExport.test.ts:62`
- `src/lib/documentSelection.test.ts:15`
- `src/lib/documentSplit.test.ts:21` dan `:42`
- `src/lib/exportEstimate.test.ts:33`
- `src/lib/scanSplit.test.ts:13`
- `src/screens/DocumentsScreen.browser.test.tsx:10`
- `src/lib/scanIndexMigration.test.ts` — beberapa `schemaVersion: 5 as const` **dan** tiga `expect(doc.schemaVersion).toBe(5)`

Ubah tiap `schemaVersion: 5` jadi `6` dan tiap `.toBe(5)` jadi `.toBe(6)`. **Jangan** mengubah angka yang memang menjadi *masukan* uji migrasi versi lama (`schemaVersion: 2`, `3`, `4`, dan seed JSON mentah di `scanStorageFilter.test.ts`) — itu justru yang sedang diuji.

Satu lagi yang bukan typecheck tapi wajib: `src/lib/scanStorageSave.test.ts:342` — `expect(writtenIndex()[0].schemaVersion).toBe(5)` jadi `6`, dan fixture v5 di baris 41/248/292 jadi 6.

- [ ] **Step 6: Jalankan kedua suite**

Run: `npm test`
Expected: PASS semua. Node naik dari 705 jadi ±715 tes.

- [ ] **Step 7: Lint & commit**

```bash
npm run lint
git add src/lib/scanIndexMigration.ts src/lib/scanIndexMigration.test.ts src/lib/scanStorage.ts src/lib/*.test.ts src/screens/DocumentsScreen.browser.test.tsx
git commit -m "$(cat <<'EOF'
feat(schema): rantai turunan halaman naik ke v6 dengan tahap enhanced

original -> edited -> enhanced -> filtered -> annotated. filterSource kini
membaca hasil koreksi cahaya, jadi Perbaiki Pencahayaan dan Hitam-Putih
menumpuk alih-alih saling meniadakan — itu justru kombinasi yang paling
dibutuhkan.

enhanced dipasangkan dengan sakelar dokumen enhance, meniru aturan yang
sudah berlaku untuk annotated dan marks: berkas turunan tidak boleh hidup
lebih lama daripada hal yang menjelaskannya.

Dokumen v1-v5 naik tanpa kehilangan apa pun; keduanya sekadar datang tanpa
field baru ini, persis seperti tiap kenaikan versi sebelumnya.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Penyimpanan — `applyDocumentEnhance` & `applyPageEnhance`

**Files:**
- Modify: `src/lib/scanStorage.ts`
- Create: `src/lib/scanStorageEnhance.test.ts`

**Interfaces:**
- Consumes: `enhanceSource`, field `enhanced`/`enhance` (Task 4); `renderPageDerived`, `derivedPath`, `discard`, `readPageBlob`, `effectiveFilter`, `FilterRenderer`, `MarkRenderer` (semua sudah ada di `scanStorage.ts`).
- Produces:
  - `export type EnhanceRenderer = (source: Blob) => Promise<Blob | null>`
  - `export interface EnhanceOutcome { changed: number; skipped: number; unchanged: number; failed: number; cancelled: boolean }`
  - `export async function applyDocumentEnhance(docId, enabled, renderEnhance, renderFilter, renderMarks, options?): Promise<{ document: LocalScanDocument; outcome: EnhanceOutcome }>` dengan `options?: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal }`
  - `export async function applyPageEnhance(docId, pageIndex, render): Promise<LocalScanDocument>`

  Task 6 memanggil keduanya; Task 7 memakai `EnhanceOutcome` lewat `describeEnhanceOutcome`.

- [ ] **Step 1: Tulis tesnya dulu — `src/lib/scanStorageEnhance.test.ts`**

```ts
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

  it('writes the switch and each page’s render into the index', async () => {
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

    const { outcome } = await applyDocumentEnhance(
      DOC_ID,
      true,
      failing,
      renderFilter,
      renderMarks,
    )

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
    expect(fs.deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'p1-enhanced.jpg' }),
    )
    expect(filterRenders).toEqual([{ source: 'p1.jpg', filter: 'bw' }])
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
  it('rebuilds one page’s lighting render after its geometry changed', async () => {
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
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm run test:node -- scanStorageEnhance`
Expected: FAIL — `applyDocumentEnhance is not a function`.

- [ ] **Step 3: Ubah `src/lib/scanStorage.ts`**

**3a.** `derivedPath` menerima suffix baru:

```ts
function derivedPath(
  original: string,
  suffix: 'edited' | 'enhanced' | 'filtered' | 'annotated',
): string {
  return original.replace(/\.jpg$/i, `-${suffix}.jpg`)
}
```

**3b.** `savePageEdit` — `enhanced` ikut dibuang bersama turunan lain yang geometrinya sudah usang. Ganti blok destructure & discard-nya:

```ts
  // Every derived file was made from the *old* geometry, so every one of them
  // is now wrong. Dropped here; the caller re-renders them from the new edit
  // (see documentEditing.editPage).
  //
  // The marks themselves survive: they are coordinates, and the caller remaps
  // them onto the new geometry rather than asking the user to draw again.
  //
  // Recognised text is coordinates too, but it goes. Marks cannot be made
  // again by anything but the user's hand, so they are worth remapping;
  // recognised text can be read again by the machine, and reading it from the
  // cropped page gives a better result than remapping the old one. Left in
  // place it would be *invisibly* wrong — the layer nobody sees, quietly
  // sending search and copy-paste to the wrong part of the page.
  const { enhanced, filtered, annotated, text, ...rest } = page
  await discard(enhanced)
  await discard(filtered)
  await discard(annotated)
  await discard(text)
```

**3c.** `resetPageEdit` — tambahkan `page.enhanced` ke daftar path yang dibuang, dan sebut di komentarnya bahwa render cahaya ikut dibuang karena dibuat dari geometri yang sedang dibuang:

```ts
  for (const path of [page.edited, page.enhanced, page.filtered, page.annotated, page.text]) {
    await discard(path)
  }
```

**3d.** Tambahkan tipe renderer & outcome di dekat `FilterRenderer`/`MarkRenderer` yang sudah ada:

```ts
/**
 * Renders one page's lighting fix.
 *
 * `null` means the estimator declined the page — the light map could not be
 * trusted, so the page is left exactly as it is. Not an error: the machine
 * looked and said "not this one".
 */
export type EnhanceRenderer = (source: Blob) => Promise<Blob | null>

export interface EnhanceOutcome {
  /** Pages rendered — or cleared — on this run. */
  changed: number
  /** Pages already in the state asked for, so nothing was done to them. */
  skipped: number
  /** Pages the estimator declined. They keep whatever they had. */
  unchanged: number
  /** Pages whose render threw. The document keeps whatever it had. */
  failed: number
  /** True when the run stopped early because its signal was aborted. */
  cancelled: boolean
}
```

**3e.** Dua helper privat, taruh tepat sebelum `renderPageDerived`:

```ts
/**
 * Renders one page's lighting fix and returns the new page entry, or `null`
 * when the estimator declined it.
 *
 * Always from `enhanceSource` — geometry only. Reading the filter render here
 * would mean estimating the light of a page that has already thrown its greys
 * away, and reading its own previous output would compound the correction on
 * every run.
 */
async function renderPageEnhance(
  page: ScanPage,
  render: EnhanceRenderer,
): Promise<ScanPage | null> {
  const rendered = await render(await readPageBlob(enhanceSource(page)))
  if (!rendered) return null

  const path = derivedPath(page.original, 'enhanced')
  await Filesystem.writeFile({
    path,
    directory: Directory.Data,
    data: await blobToBase64(rendered),
  })
  // The path is stable across re-renders, so any cached object URL is stale.
  invalidateDisplayUri(path)

  return { ...page, enhanced: path }
}

/** Drops a page's lighting render, so the chain falls back to its geometry. */
async function clearPageEnhance(page: ScanPage): Promise<ScanPage> {
  await discard(page.enhanced)
  const { enhanced: _dropped, ...rest } = page
  return rest
}
```

**3f.** Fungsi utamanya, taruh setelah `applyDocumentFilter`:

```ts
/**
 * Turns "Perbaiki Pencahayaan" on or off for a whole document.
 *
 * Every tier — there is deliberately no tier parameter here and no tier check
 * anywhere on this path (CLAUDE.md Bagian 6, keputusan Boss Ali 29 Agustus
 * 2026). The Pro gate belongs to the TFLite version, if and when it exists.
 *
 * The filter and ink renderers come along because switching this stage changes
 * what the filter render is *derived from*: `filterSource` reads the lighting
 * render when there is one, so both files under it have to be rebuilt.
 *
 * Unlike `applyDocumentFilter`, this one can be cancelled. Filtering a document
 * is seconds of work over at most a few dozen pages; this decodes and re-encodes
 * every page at full resolution, and Pro has no page limit — without a way out,
 * a sixty-page run leaves killing the app as the only option. The signal is
 * checked between pages, never inside one: stopping mid-page would leave a
 * half-written file.
 *
 * A cancelled run keeps what it finished and still records the switch the user
 * asked for. The state that leaves is visible (the panel says "12 dari 20"),
 * resumable (a second run skips the pages already in the right state), and
 * lossless — `original` and `edited` are never touched here.
 */
export async function applyDocumentEnhance(
  docId: string,
  enabled: boolean,
  renderEnhance: EnhanceRenderer,
  renderFilter: FilterRenderer,
  renderMarks: MarkRenderer,
  options: {
    onProgress?: (done: number, total: number) => void
    signal?: AbortSignal
  } = {},
): Promise<{ document: LocalScanDocument; outcome: EnhanceOutcome }> {
  const docs = await readIndex()
  const doc = docs.find((entry) => entry.id === docId)
  if (!doc) throw new Error('Dokumen tidak ditemukan.')

  const next: LocalScanDocument = { ...doc, enhance: enabled ? true : undefined }
  if (!enabled) delete next.enhance

  const outcome: EnhanceOutcome = {
    changed: 0,
    skipped: 0,
    unchanged: 0,
    failed: 0,
    cancelled: false,
  }

  const pages: ScanPage[] = []
  for (const page of doc.pages) {
    if (options.signal?.aborted) {
      outcome.cancelled = true
      break
    }

    if (enabled === Boolean(page.enhanced)) {
      // Already in the state being asked for: on a resumed run this is most of
      // the document, and skipping it is the whole point of resuming.
      outcome.skipped++
      pages.push(page)
      options.onProgress?.(pages.length, doc.pages.length)
      continue
    }

    try {
      const settled = enabled
        ? await renderPageEnhance(page, renderEnhance)
        : await clearPageEnhance(page)

      if (!settled) {
        // Declined. Nothing under it changed, so nothing under it is re-rendered.
        outcome.unchanged++
        pages.push(page)
      } else {
        pages.push(
          await renderPageDerived(
            settled,
            effectiveFilter(next, settled),
            renderFilter,
            renderMarks,
          ),
        )
        outcome.changed++
      }
    } catch {
      // The page keeps whatever it had, and the count is what the caller
      // reports. Nineteen good pages beat one clean failure.
      outcome.failed++
      pages.push(page)
    }

    options.onProgress?.(pages.length, doc.pages.length)
  }

  // Whatever the loop did not reach stays exactly as it was.
  next.pages = [...pages, ...doc.pages.slice(pages.length)]
  docs[docs.indexOf(doc)] = next
  await writeIndex(docs)

  return { document: next, outcome }
}

/**
 * Rebuilds one page's lighting render, for the moment right after its geometry
 * changed and `savePageEdit`/`resetPageEdit` threw the old one away.
 *
 * A no-op when the document's switch is off, so the caller can call it
 * unconditionally. It deliberately does *not* re-render the filter or the ink:
 * the caller does that next in one pass via `applyPageDerived`, and doing it
 * here as well would render the ink twice over a 12 MP page.
 */
export async function applyPageEnhance(
  docId: string,
  pageIndex: number,
  render: EnhanceRenderer,
): Promise<LocalScanDocument> {
  const docs = await readIndex()
  const doc = docs.find((entry) => entry.id === docId)
  if (!doc) throw new Error('Dokumen tidak ditemukan.')

  const page = doc.pages[pageIndex]
  if (!page) throw new Error('Halaman tidak ditemukan.')
  if (!doc.enhance) return doc

  doc.pages[pageIndex] = (await renderPageEnhance(page, render)) ?? (await clearPageEnhance(page))

  await writeIndex(docs)
  return doc
}
```

**3g.** Import `enhanceSource` di blok import `scanIndexMigration` (kalau Task 4 Step 4 belum menambahkannya).

- [ ] **Step 4: Jalankan tesnya sampai hijau**

Run: `npm run test:node -- scanStorage`
Expected: PASS — berkas baru hijau (16 tes), **dan** `scanStorageFilter.test.ts` serta `scanStorageSave.test.ts` tetap hijau. Kalau ada yang merah di dua berkas lama itu, baca dulu apa yang berubah — jangan longgarkan asersinya.

- [ ] **Step 5: Typecheck, lint, suite penuh**

Run: `npm run build && npm run lint && npm test`
Expected: bersih. Node ±731 tes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scanStorage.ts src/lib/scanStorageEnhance.test.ts
git commit -m "$(cat <<'EOF'
feat(enhance): sakelar Perbaiki Pencahayaan per dokumen di lapisan penyimpanan

applyDocumentEnhance menyalakan/mematikan tahap koreksi cahaya lalu merender
ulang filter dan tinta di bawahnya, karena filterSource membaca hasil koreksi
begitu ada. Tanda tangan applyDocumentFilter dan kawan-kawannya sengaja tidak
diubah — begitu filterSource benar, jalur filter tidak perlu tahu apa-apa
soal tahap baru ini.

Punya pembatalan, tidak seperti applyDocumentFilter. Basic mentok 20 halaman
tapi Pro tidak terbatas, dan tiap halaman didekode ulang di resolusi penuh;
tanpa Batal, satu-satunya jalan keluar dari dokumen 60 halaman adalah
membunuh aplikasi. Signal diperiksa antar halaman, tidak pernah di tengah
satu halaman — berhenti di tengah render hanya menyisakan berkas separuh.

Jalan yang dibatalkan menyimpan yang sudah jadi dan tetap mencatat sakelar
yang diminta user: sakelar merekam niat, berkasnya merekam sejauh mana.

Tanpa satu pun cek tier di sepanjang jalur ini — keputusan Boss Ali
29 Agustus 2026.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Sambungan editor — `setDocumentEnhance` & pemulihan sesudah crop

**Files:**
- Modify: `src/lib/documentEditing.ts`
- Modify: `src/lib/documentEditing.test.ts`

**Interfaces:**
- Consumes: `applyDocumentEnhance`, `applyPageEnhance`, `EnhanceOutcome` (Task 5); `enhancePage` (Task 2).
- Produces:
  - `export async function setDocumentEnhance(doc, enabled, options?): Promise<{ document: LocalScanDocument; outcome: EnhanceOutcome }>` dengan `options?: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal }`
  - `export function describeEnhanceOutcome(outcome: EnhanceOutcome, enabled: boolean): string`

  Task 7 memanggil keduanya dari `EditorScreen`.

- [ ] **Step 1: Tulis tesnya dulu — tambahkan di `src/lib/documentEditing.test.ts`**

Berkas itu memakai mock modul yang ditulis tangan, bukan `vi.mocked` — jadi ada empat penyesuaian sebelum tesnya bisa jalan:

1. Ke objek `imageEditor` (yang di-mock jadi seluruh modul `./imageEditor`), tambahkan `enhancePage: vi.fn(async () => new Blob(['enhanced']))`.
2. Ke objek `scanStorage`, tambahkan `applyDocumentEnhance: vi.fn()` dan `applyPageEnhance: vi.fn()`.
3. Objek `scanStorage` juga memuat **salinan tulis-tangan** `filterSource` dan `resolvePage` (sengaja, supaya berkas ini bebas Capacitor — lihat komentarnya). Salinan itu ikut berubah bersama yang asli di Task 4:

```ts
  filterSource: (page: { enhanced?: string; edited?: string; original: string }) =>
    page.enhanced ?? page.edited ?? page.original,
  resolvePage: (page: {
    filtered?: string
    enhanced?: string
    edited?: string
    original: string
  }) => page.filtered ?? page.enhanced ?? page.edited ?? page.original,
```

4. Fungsi yang diuji diambil lewat `await import('./documentEditing')` di dekat atas berkas — tambahkan `describeEnhanceOutcome` dan `setDocumentEnhance` ke destructure itu, **bukan** sebagai import statis di baris pertama.

Lalu tesnya:

```ts
describe('setDocumentEnhance', () => {
  it('hands the storage layer the canvas renderers and the caller’s signal', async () => {
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
```

(Keduanya sudah masuk lewat penyesuaian nomor 4 di atas — tidak ada import statis yang perlu ditambahkan.)

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm run test:node -- documentEditing`
Expected: FAIL — `setDocumentEnhance is not exported`.

- [ ] **Step 3: Ubah `src/lib/documentEditing.ts`**

**3a.** Tambahkan ke import `./imageEditor`: `enhancePage`. Tambahkan ke import `./scanStorage`: `applyDocumentEnhance`, `applyPageEnhance`, dan `type EnhanceOutcome`.

**3b.** `rebuildDerived` menerima dokumennya, bukan hanya id-nya, dan memulihkan render cahaya lebih dulu:

```ts
/**
 * Rebuilds every derived file after a page's geometry changed underneath them.
 *
 * `savePageEdit`/`resetPageEdit` delete the lighting render, the filter render
 * and the ink render as a side effect — right, since all three were made from
 * geometry that no longer exists — but none of them can regenerate anything;
 * they are storage, with no canvas to render with. This is the one place that
 * closes the gap, shared by `editPage` (after a crop or rotate) and
 * `revertPage` (after undoing one).
 *
 * The lighting fix goes first and on its own, because the filter renders *from*
 * it. The filter and the ink then go together in one call: the filter pass
 * renders the ink too, so splitting those two would draw every stroke twice —
 * once at the coordinates the crop just invalidated.
 */
async function rebuildDerived(
  doc: LocalScanDocument,
  pageIndex: number,
  marks: Mark[],
): Promise<LocalScanDocument> {
  if (doc.enhance) await applyPageEnhance(doc.id, pageIndex, enhancePage)
  return applyPageDerived(doc.id, pageIndex, marks, filterImage, drawMarks)
}
```

Ubah dua pemanggilnya: di `editPage`, `return rebuildDerived(doc, pageIndex, remap(...))`; di `revertPage`, `return rebuildDerived(doc, pageIndex, reverted.pages[pageIndex].marks ?? [])`.

**3c.** Fungsi barunya, taruh setelah `setPageFilter`:

```ts
/**
 * Turns "Perbaiki Pencahayaan" on or off for the whole document.
 *
 * Every tier. No tier argument, no tier check — see `applyDocumentEnhance`.
 *
 * `signal` is not optional decoration: every page is decoded and re-encoded at
 * full resolution and Pro has no page limit, so the user needs a way out that
 * is not force-quitting the app.
 */
export async function setDocumentEnhance(
  doc: LocalScanDocument,
  enabled: boolean,
  options: {
    onProgress?: (done: number, total: number) => void
    signal?: AbortSignal
  } = {},
): Promise<{ document: LocalScanDocument; outcome: EnhanceOutcome }> {
  return applyDocumentEnhance(doc.id, enabled, enhancePage, filterImage, drawMarks, options)
}

/**
 * The one line the editor shows once a run is over.
 *
 * `unchanged` has to reach the user rather than being rounded into the total:
 * a page the estimator declined will never get a lighting render, so the
 * panel's count stops short of the total permanently. Reported as a plain
 * success, that leaves the user pressing "Lanjutkan" forever with nothing to
 * explain why — the same trap `describeOcrOutcome` exists to avoid.
 *
 * Never say "AI" here (CLAUDE.md Bagian 6): this is deterministic maths, and
 * the name belongs to the TFLite version.
 */
export function describeEnhanceOutcome(outcome: EnhanceOutcome, enabled: boolean): string {
  if (outcome.cancelled) return `Dihentikan setelah ${outcome.changed} halaman.`
  if (!enabled) return 'Perbaikan pencahayaan dimatikan.'
  if (outcome.changed === 0 && outcome.unchanged === 0 && outcome.failed === 0) {
    return 'Semua halaman sudah diperbaiki.'
  }

  const problems: string[] = []
  if (outcome.unchanged > 0) problems.push(`${outcome.unchanged} halaman dilewati`)
  if (outcome.failed > 0) problems.push(`${outcome.failed} gagal`)

  const done = `Pencahayaan ${outcome.changed} halaman diperbaiki`
  return problems.length === 0 ? `${done}.` : `${done}, ${problems.join(', ')}.`
}
```

- [ ] **Step 4: Jalankan tesnya sampai hijau**

Run: `npm run test:node -- documentEditing`
Expected: PASS, termasuk tes lama di berkas itu.

- [ ] **Step 5: Typecheck, lint, suite penuh**

Run: `npm run build && npm run lint && npm test`
Expected: bersih. Node ±738 tes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/documentEditing.ts src/lib/documentEditing.test.ts
git commit -m "$(cat <<'EOF'
feat(enhance): sambungkan sakelar pencahayaan ke editor & pulihkan sesudah crop

setDocumentEnhance menyerahkan renderer kanvas ke lapisan penyimpanan, plus
signal pembatalan milik pemanggil.

rebuildDerived kini menerima dokumennya, bukan cuma id-nya, supaya bisa
memulihkan render cahaya lebih dulu saat sakelarnya menyala — filter dirender
dari berkas itu, jadi urutannya tidak bisa dibalik. Filter dan tinta tetap
satu panggilan seperti sebelumnya, karena memisahnya menggambar tiap coretan
dua kali.

describeEnhanceOutcome menyebut halaman yang dilewati secara terpisah dari
yang gagal. Halaman yang ditolak estimator tidak akan pernah punya hasil,
jadi hitungan di panel berhenti di bawah total selamanya — melaporkannya
sebagai sukses polos meninggalkan user menekan "Lanjutkan" tanpa penjelasan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: UI — panel Perbaiki Pencahayaan di editor

**Files:**
- Modify: `src/components/Icons.tsx` (tambah `SunIcon`)
- Create: `src/components/EnhancePanel.tsx`
- Create: `src/components/EnhancePanel.browser.test.tsx`
- Modify: `src/screens/EditorScreen.tsx`
- Modify: `src/App.tsx` (satu prop baru: `onNotice={setToast}`)
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `setDocumentEnhance`, `describeEnhanceOutcome` (Task 6); `page.enhanced` & `doc.enhance` (Task 4).
- Produces: mode `'enhance'` di `EditorScreen`, dan komponen `EnhancePanel` dengan props `{ enabled, enhancedCount, total, progress, isBusy, onToggle, onCancel }`.

- [ ] **Step 1: Tulis tes komponennya dulu — `src/components/EnhancePanel.browser.test.tsx`**

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { EnhancePanel } from './EnhancePanel'

async function renderPanel(overrides: Partial<Parameters<typeof EnhancePanel>[0]> = {}) {
  return await render(
    <EnhancePanel
      enabled={false}
      enhancedCount={0}
      total={20}
      progress={null}
      isBusy={false}
      onToggle={() => {}}
      onCancel={() => {}}
      {...overrides}
    />,
  )
}

describe('EnhancePanel', () => {
  it('shows which state the document is in', async () => {
    const screen = await renderPanel({ enabled: true, enhancedCount: 20 })

    await expect.element(screen.getByRole('button', { name: 'Aktif' })).toBeVisible()
  })

  it('asks the caller to switch it on', async () => {
    const onToggle = vi.fn()
    const screen = await renderPanel({ onToggle })

    await screen.getByRole('button', { name: 'Aktif' }).click()

    expect(onToggle).toHaveBeenCalledWith(true)
  })

  /** The same lesson as FilterPicker: a live control during a render starts a second one. */
  it('locks both options while a run is in flight', async () => {
    const screen = await renderPanel({ isBusy: true, progress: { done: 3, total: 20 } })

    await expect.element(screen.getByRole('button', { name: 'Aktif' })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Nonaktif' })).toBeDisabled()
  })

  it('reports progress and offers a way out of a long run', async () => {
    const onCancel = vi.fn()
    const screen = await renderPanel({ isBusy: true, progress: { done: 3, total: 20 }, onCancel })

    await expect.element(screen.getByText('Memperbaiki halaman 3 dari 20…')).toBeVisible()
    await screen.getByRole('button', { name: 'Batal' }).click()

    expect(onCancel).toHaveBeenCalled()
  })

  /**
   * What is left after a cancelled run, and it has to be legible: the switch
   * says on, but only part of the document has been through.
   */
  it('says how far a half-finished document got, and offers to continue', async () => {
    const screen = await renderPanel({ enabled: true, enhancedCount: 12 })

    await expect.element(screen.getByText('12 dari 20 halaman diperbaiki')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Lanjutkan' })).toBeVisible()
  })

  it('offers no Lanjutkan when the document is complete', async () => {
    const screen = await renderPanel({ enabled: true, enhancedCount: 20 })

    expect(screen.container.textContent).not.toContain('Lanjutkan')
  })

  /**
   * A binding decision, guarded by a test because the way it gets broken is one
   * word slipped into copy during a redesign: this feature is deterministic
   * maths and must never be presented as AI (CLAUDE.md Bagian 6). The name "AI
   * Enhance" belongs to the TFLite version.
   */
  it('never presents itself as AI', async () => {
    const screen = await renderPanel({ enabled: true, enhancedCount: 12 })

    expect(screen.container.textContent).not.toMatch(/\bAI\b/i)
    expect(screen.container.textContent).toContain('Perbaiki Pencahayaan')
  })

  /** Every tier. No badge, no upgrade path — see the design doc header. */
  it('shows no Pro badge', async () => {
    const screen = await renderPanel()

    expect(screen.container.textContent).not.toContain('Pro')
  })
})
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm run test:browser -- EnhancePanel`
Expected: FAIL — modul `./EnhancePanel` tidak ada.

- [ ] **Step 3: Tulis `src/components/EnhancePanel.tsx`**

```tsx
interface EnhancePanelProps {
  /** What the document's switch currently says. */
  enabled: boolean
  /** Pages that already carry a lighting render. */
  enhancedCount: number
  total: number
  /** Progress while a run is in flight, or null when idle. */
  progress: { done: number; total: number } | null
  /** Set for the whole run, which is also what locks the switch. */
  isBusy: boolean
  onToggle: (next: boolean) => void
  onCancel: () => void
}

/**
 * The "Perbaiki Pencahayaan" switch.
 *
 * A stage of its own rather than a sixth filter chip, and this panel is where
 * that shows: turning it on does not take Hitam-Putih away, it runs before it.
 *
 * Three resting states, because three things actually happen: off, on and
 * complete, and on but only part-way — what a cancelled run leaves behind, and
 * also what a document with pages the estimator declined settles at for good.
 * Rounding the middle state to either end would leave the user with no way to
 * tell why one page still looks the way it did.
 *
 * Every tier: no badge, no upgrade path, no tier prop (CLAUDE.md Bagian 6). And
 * never the word "AI" anywhere in here — this is deterministic maths, and there
 * is a test holding that line.
 */
export function EnhancePanel({
  enabled,
  enhancedCount,
  total,
  progress,
  isBusy,
  onToggle,
  onCancel,
}: EnhancePanelProps) {
  const running = progress !== null || isBusy
  const partial = enabled && enhancedCount > 0 && enhancedCount < total

  return (
    <div className="filter-picker">
      <p className="enhance-note">
        Meratakan cahaya dan menghapus bayangan sebelum filter diterapkan.
      </p>

      <div className="enhance-switch" role="group" aria-label="Perbaiki Pencahayaan">
        <button
          type="button"
          className={`enhance-switch__option${!enabled ? ' enhance-switch__option--active' : ''}`}
          onClick={() => onToggle(false)}
          disabled={running}
        >
          Nonaktif
        </button>
        <button
          type="button"
          className={`enhance-switch__option${enabled ? ' enhance-switch__option--active' : ''}`}
          onClick={() => onToggle(true)}
          disabled={running}
        >
          Aktif
        </button>
      </div>

      {progress && (
        <p className="filter-progress">
          Memperbaiki halaman {progress.done} dari {progress.total}…
        </p>
      )}

      {progress && (
        <button type="button" className="button" onClick={onCancel}>
          <span>Batal</span>
        </button>
      )}

      {!running && partial && (
        <>
          <p className="filter-progress">
            {enhancedCount} dari {total} halaman diperbaiki
          </p>
          <button type="button" className="button" onClick={() => onToggle(true)}>
            <span>Lanjutkan</span>
          </button>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Tambahkan `SunIcon` di `src/components/Icons.tsx`**

Berkas itu punya helper `base(size)` di atas yang memegang semua atribut bersama (`viewBox`, `fill`, `stroke`, `strokeWidth`, `strokeLinecap`, `strokeLinejoin`) — pakai itu, jangan menulis ulang atributnya satu per satu:

```tsx
export function SunIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2" />
      <path d="M12 19v2" />
      <path d="M3 12h2" />
      <path d="M19 12h2" />
      <path d="m5.6 5.6 1.4 1.4" />
      <path d="m17 17 1.4 1.4" />
      <path d="m18.4 5.6-1.4 1.4" />
      <path d="m7 17-1.4 1.4" />
    </svg>
  )
}
```

- [ ] **Step 5: Sambungkan di `src/screens/EditorScreen.tsx`**

**5a.** Import: tambahkan `useRef` ke import `react`; `EnhancePanel` dari `../components/EnhancePanel`; `SunIcon` ke import `../components/Icons`; `describeEnhanceOutcome, setDocumentEnhance` ke import `../lib/documentEditing`.

**5b.** Props: tambahkan `onNotice: (message: string) => void` ke `EditorScreenProps` (dengan komentar: pesan biasa, bukan kegagalan — `onError` sudah dipakai untuk yang gagal), dan terima di parameter komponennya.

**5c.** Mode & judul:

```ts
type Mode = 'none' | 'crop' | 'filter' | 'enhance' | 'reorder' | 'annotate'

const TITLES: Record<Mode, string> = {
  none: 'Edit Halaman',
  crop: 'Potong Halaman',
  filter: 'Filter Dokumen',
  enhance: 'Perbaiki Pencahayaan',
  reorder: 'Urutkan Halaman',
  annotate: 'Anotasi & Tanda Tangan',
}
```

**5d.** State & handler, taruh setelah `handlePick`:

```ts
  const [enhanceProgress, setEnhanceProgress] = useState<{ done: number; total: number } | null>(
    null,
  )
  /** Held in a ref, not state: cancelling must not wait for a re-render. */
  const enhanceRun = useRef<AbortController | null>(null)

  const enhancedCount = doc.pages.filter((entry) => entry.enhanced).length

  const handleEnhanceToggle = async (next: boolean) => {
    const controller = new AbortController()
    enhanceRun.current = controller

    setIsBusy(true)
    setEnhanceProgress({ done: 0, total: doc.pages.length })
    try {
      const { document: updated, outcome } = await setDocumentEnhance(doc, next, {
        onProgress: (done, total) => setEnhanceProgress({ done, total }),
        signal: controller.signal,
      })
      onDocumentChange(updated)
      onNotice(describeEnhanceOutcome(outcome, next))
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Gagal memperbaiki pencahayaan.')
    } finally {
      enhanceRun.current = null
      setEnhanceProgress(null)
      setIsBusy(false)
    }
  }
```

**5e.** Panelnya, tepat setelah blok `{mode === 'filter' && page && (…)}`:

```tsx
      {mode === 'enhance' && (
        <EnhancePanel
          enabled={doc.enhance === true}
          enhancedCount={enhancedCount}
          total={doc.pages.length}
          progress={enhanceProgress}
          isBusy={isBusy}
          onToggle={(next) => void handleEnhanceToggle(next)}
          onCancel={() => enhanceRun.current?.abort()}
        />
      )}
```

**5f.** Tombolnya, di baris `editor-actions` yang sudah berisi Filter & Urutkan — jadi tiga tombol, dan komentar barisnya diperbarui:

```tsx
          {/* Yang berlaku untuk seluruh dokumen — semuanya terbuka untuk semua tier. */}
          <div className="editor-actions">
            <button
              type="button"
              className="button"
              onClick={() => setMode('filter')}
              disabled={isBusy}
            >
              <ImageIcon size={17} />
              <span>Filter</span>
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setMode('enhance')}
              disabled={isBusy}
            >
              <SunIcon size={17} />
              <span>Cahaya</span>
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setMode('reorder')}
              disabled={isBusy || doc.pages.length < 2}
            >
              <MergeIcon size={17} />
              <span>Urutkan</span>
            </button>
          </div>
```

**5g.** Tombol Kembali di header: mode `'enhance'` sudah tertangani cabang `else setMode('none')` yang ada — jangan tambah cabang baru, tapi **pastikan** tombolnya tetap `disabled={isBusy}` supaya user tidak bisa keluar di tengah jalan tanpa membatalkan.

- [ ] **Step 6: Sambungkan prop barunya di `src/App.tsx`**

Tambahkan satu baris di elemen `<EditorScreen …>`, tepat di bawah `onError={setToast}`:

```tsx
          onNotice={setToast}
```

- [ ] **Step 7: CSS di `src/App.css`**

Tambahkan `.enhance-switch` ke daftar selektor `.filter-scope, .format-switch` yang sudah ada (dua blok: wadah dan `__option`, plus varian `--active` dan `:disabled`), lalu satu aturan baru di dekat `.filter-progress`:

```css
.enhance-note {
  font-size: 13px;
  color: var(--fg-dim);
  line-height: 1.5;
}
```

Jangan memperkenalkan warna atau font baru — token yang ada sudah final (CLAUDE.md Bagian 9.2).

- [ ] **Step 8: Jalankan tesnya sampai hijau**

Run: `npm run test:browser`
Expected: PASS — 8 tes `EnhancePanel` hijau, dan tes browser lama tetap hijau.

- [ ] **Step 9: Typecheck, lint, suite penuh**

Run: `npm run build && npm run lint && npm test`
Expected: bersih.

- [ ] **Step 10: Commit**

```bash
git add src/components/EnhancePanel.tsx src/components/EnhancePanel.browser.test.tsx src/components/Icons.tsx src/screens/EditorScreen.tsx src/App.tsx src/App.css
git commit -m "$(cat <<'EOF'
feat(editor): panel Perbaiki Pencahayaan dengan progres & tombol Batal

Satu mode baru di editor, di sebelah Filter — bukan chip filter keenam,
karena menyalakannya tidak boleh mencabut Hitam-Putih; justru kombinasi itu
yang paling dibutuhkan.

Tiga keadaan diam, bukan dua: mati, hidup-dan-lengkap, dan hidup-tapi-baru
sebagian — yang tersisa setelah dibatalkan, dan juga tempat berhenti permanen
buat dokumen yang sebagian halamannya ditolak estimator. Membulatkan keadaan
tengah ke salah satu ujung membuat user tidak punya cara tahu kenapa satu
halaman masih tampak seperti semula.

AbortController dipegang di ref, bukan state: membatalkan tidak boleh
menunggu render ulang.

Tanpa badge Pro dan tanpa jalur upgrade, dan ada tes yang menjaga panel ini
tidak pernah menyebut dirinya "AI" — dua-duanya keputusan Boss Ali
29 Agustus 2026, bukan kelalaian.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Verifikasi menyeluruh, review, & dokumen

**Files:**
- Modify: `TASKS.md`
- (kemungkinan) berkas mana pun yang disentuh perbaikan dari code-review

**Interfaces:**
- Consumes: seluruh hasil Task 1–7.
- Produces: status Fase 7A tercatat, daftar uji device untuk Boss Ali.

- [ ] **Step 1: Suite penuh, typecheck, lint — semuanya sekali jalan**

Run: `npm test && npm run build && npm run lint`
Expected: semua hijau. Catat angkanya (node ±738+, browser semuanya) — angka ini masuk laporan, **jangan** mengklaim selesai tanpa menjalankan ini lebih dulu.

- [ ] **Step 2: `security-review` sebelum commit terakhir**

Jalankan skill `security-review` atas diff cabang ini (CLAUDE.md Bagian 9.1). Yang relevan di sini: tidak ada credential, tidak ada jaringan, tidak ada input user yang jadi path berkas — tapi jalankan tetap, dan laporkan temuannya sebelum lanjut, jangan didiamkan.

- [ ] **Step 3: `code-review` atas seluruh perubahan Fase 7A**

Jalankan `/code-review` (CLAUDE.md Bagian 9.4 — perubahan ini jauh lebih dari satu berkas). **Nilai tiap temuan sebelum menerapkannya** dan tutup semuanya sebelum lanjut — jangan menumpuk temuan lintas potongan. Kalau sebuah temuan minta melonggarkan asersi tes, curigai temuannya, bukan tesnya.

- [ ] **Step 4: Perbarui `TASKS.md` bagian 7A**

Centang butir-butir yang sudah selesai:
- `[x]` **Tahap terpisah, bukan filter keenam** — sebutkan schema naik ke v6 dan `enhanceSource`/`filterSource` yang baru.
- `[x]` **Algoritma** — sebutkan `src/lib/enhance.ts`, dan bahwa katup batal yang benar-benar terpicu di praktik adalah ubin kosong, bukan pencilan (spec Bagian 4.3).
- `[x]` **Batch dengan `signal`** — sebutkan `applyDocumentEnhance` dan bahwa jalan yang dibatalkan bisa dilanjutkan.
- `[x]` **Ukur sebelum merancang UI progres** — sudah dicatat di Task 3.
- `[x]` **Toggle on/off per dokumen** — sebutkan `EnhancePanel` di editor.

Tambahkan blok daftar uji device (belum dicentang — itu tugas Boss Ali di HP):

```markdown
**Menunggu uji di device fisik (Xiaomi T15):**

- [ ] Dokumen berbayang (foto halaman dengan bayangan tangan) → sakelar **Aktif** → bayangan rata, teks tetap terbaca
- [ ] Sakelar **Aktif** lalu filter **Hitam-Putih** → tidak ada lagi bercak hitam pekat di daerah bayangan; keduanya berlaku bersamaan
- [ ] Dokumen 20 halaman → progres berjalan per halaman, tombol **Batal** benar-benar menghentikan
- [ ] Setelah **Batal**: panel bilang "N dari 20 halaman", tombol **Lanjutkan** meneruskan dari halaman N+1, bukan mengulang dari awal
- [ ] Sakelar **Nonaktif** → halaman kembali seperti semula, berkas `-enhanced.jpg` hilang dari penyimpanan
- [ ] Crop satu halaman saat sakelar menyala → halaman itu diperbaiki ulang, filternya ikut benar
- [ ] Tutup & buka ulang aplikasi → sakelar dan hasilnya masih sama
- [ ] Ekspor PDF dengan sakelar menyala → yang keluar halaman hasil perbaikan
- [ ] Waktu nyata per halaman di HP dibanding proyeksi Task 3
- [ ] Tidak ada satu pun kata "AI" di layar mana pun
```

- [ ] **Step 5: Commit terakhir**

```bash
git add TASKS.md
git commit -m "$(cat <<'EOF'
docs(tasks): tandai Fase 7A selesai di kode & daftar uji device

Perbaiki Pencahayaan versi klasik jalan penuh dari matematika sampai UI.
Yang tersisa untuk fase ini adalah uji di HP fisik — daftarnya di TASKS.md,
termasuk memeriksa langsung dua hal yang sifatnya keputusan, bukan bug:
sakelar bisa dipakai bersamaan dengan Hitam-Putih, dan tidak ada satu pun
kata "AI" di layar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Laporkan ke Boss Ali dalam Bahasa Indonesia**

Isinya: apa yang jalan, angka pengukuran Task 3 beserta proyeksinya, jumlah tes sebelum/sesudah, temuan review yang ditutup (dan yang sengaja ditolak beserta alasannya), lalu daftar uji device di atas. Sebutkan juga **known gap** yang sengaja tidak dikerjakan: noise reduction & peningkatan ketajaman (`TASKS.md` Fase 7), impor/ReviewScreen, dan 7B.

---

## Catatan untuk eksekutor

**Urutan tidak boleh dibalik.** Task 3 adalah gerbang: kalau proyeksinya melewati ±30 detik, Task 4–8 **tidak** dikerjakan sampai Boss Ali memutuskan arahnya. Itu bukan formalitas — seluruh rancangan UI di Task 7 berdiri di atas asumsi bahwa satu jalan penuh masuk akal ditunggu dengan progres dan tombol Batal.

**Dua hal yang paling mudah salah, dan keduanya sudah dijaga tes:**

1. **Menaruh cek tier di suatu tempat "untuk konsistensi dengan OCR".** Jangan. OCR memang Pro; ini tidak. Alasannya ada di kepala spec.
2. **Menulis "AI Enhance", "AI", atau "cerdas" di copy.** Nama itu milik versi model yang belum ada.

**Yang tidak boleh diam-diam ikut dikerjakan:** noise reduction, sharpening, auto-deskew, auto-crop (7B), dan enhance di `ReviewScreen` sebelum dokumen disimpan. Semuanya sudah tercatat sebagai di luar cakupan; menambahkannya di sini membuat satu potongan jadi tiga subsistem sekaligus (CLAUDE.md Bagian 1).
