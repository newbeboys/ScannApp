# Fase 7B — Auto-deskew & Auto-crop (Jalur Impor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halaman yang masuk lewat share sheet atau rasterisasi PDF pihak ketiga bisa diluruskan (koreksi perspektif) lewat kuadrilateral 4-sudut yang bisa digeser bebas — sekali saat ditinjau sebelum disimpan, dan kapan saja lagi lewat tombol permanen di editor. v1 tidak mendeteksi tepi apa pun secara otomatis; ia hanya menyediakan alatnya, dengan tebakan awal netral yang selalu menunggu konfirmasi user.

**Architecture:** Matematika homografi murni di modul baru `src/lib/perspective.ts` (pemetaan unit-square→kuadrilateral tertutup ala Heckbert, inversi 3×3, pemetaan-balik per piksel dengan sampel bilinear) — tanpa DOM, node-testable, mengikuti pola `enhance.ts`. Sisi kanvas di `imageEditor.warpImage()`, mengikuti pola `enhancePage`/`cropImage`. `straightenPage()` masuk `documentEditing.ts` sebagai pembungkus ketiga di atas `editPage()` yang sudah ada, sejajar `cropPage`/`rotatePage` — **tidak ada schemaVersion baru, tidak ada field baru di `ScanPage`**. Komponen baru `QuadOverlay` (4 sudut bebas, mirip `CropOverlay`) dipakai di dua tempat: layar baru `StraightenScreen` (jalur impor, sebelum dokumen tersimpan) dan mode baru `'straighten'` di `EditorScreen` (permanen, sejajar Potong/Putar). `pendingPages` di `App.tsx` **tidak berubah tipe** — origin impor dilacak lewat state terpisah `straightenQueue: number[]` (indeks yang masih menunggu keputusan), dan halaman yang diluruskan digantikan `URL.createObjectURL` dari hasilnya di tempat yang sama.

**Tech Stack:** React 19 + TypeScript + Vite + Capacitor 8; Canvas 2D API (`getImageData`/`putImageData`/`toBlob`); Vitest suite `node` untuk matematika & orkestrasi, suite `browser` (Chromium via Playwright) untuk kanvas & komponen. **Nol dependency baru.**

**Spec:** `docs/superpowers/specs/2026-08-31-fase7b-auto-deskew-design.md`

## Global Constraints

- **Selalu konfirmasi user, tidak pernah auto-terap.** Tidak ada jalur yang menyimpan hasil luruskan tanpa layar `StraightenScreen`/mode editor menampilkan sudutnya dulu. (Keputusan Boss Ali, brainstorm 31 Agustus 2026.)
- **v1 tanpa deteksi tepi otomatis.** Sudut awal `QuadOverlay` selalu persegi inset 5% dari tepi gambar (`FULL_CROP`-style), tidak pernah hasil analisis piksel. Jangan menambahkan heuristik deteksi apa pun di plan ini.
- **Warp memakai pemetaan-balik homografi asli**, bukan pendekatan 2-segitiga. Lihat spec Bagian 5.1 untuk alasannya.
- **Tidak ada `schemaVersion` baru, tidak ada field baru di `ScanPage`/`LocalScanDocument`.** `straightenPage()` menulis ke `edited` lewat `editPage()` yang sudah ada, persis seperti `cropPage`/`rotatePage`.
- **Semua tier, tanpa gerbang tier apa pun** — pola yang sama dengan crop/rotate/filter; ini matematika, bukan model, jadi tidak ada argumen biaya untuk menahannya di belakang paywall (CLAUDE.md Bagian 6, pola "dasar untuk semua").
- **Nol dependency baru.** Tidak ada npm install, tidak ada perubahan Gradle.
- **Bahasa komentar: Inggris** di `src/lib/**` dan `src/components/**`/`src/screens/**` yang disentuh plan ini (mengikuti tetangganya: `enhance.ts`, `imageEditor.ts`, `annotations.ts`, `documentEditing.ts` semuanya Inggris) — **kecuali** file test yang sudah berbahasa Indonesia (`scanStorageSave.test.ts`), yang tetap dilanjutkan dalam Indonesia. Teks yang dilihat user selalu Bahasa Indonesia. Jangan mencampur dua bahasa dalam satu berkas (CLAUDE.md Bagian 4).
- **Dua suite test, pilih yang benar** (CLAUDE.md Bagian 4): `*.test.ts` → suite `node` untuk logika murni; `*.browser.test.ts(x)` → Chromium sungguhan untuk kode kanvas & komponen. **Jangan me-mock canvas untuk menguji kode canvas.** `render()` dari `vitest-browser-react` mengembalikan Promise — wajib `await`.
- **Komponen overlay pointer-drag (`CropOverlay`, `AnnotateOverlay`) tidak punya test file sendiri di codebase ini** — hanya diverifikasi lewat build/typecheck dan device test manual. `QuadOverlay` mengikuti pola yang sama: tidak ada `QuadOverlay.browser.test.tsx` baru. Penjaga degenerate-nya (`quadArea`) sudah teruji tuntas di lapisan matematika (Task 1). Layar penuh (`StraightenScreen`) **beda** — screen-level browser test tetap dibuat, mengikuti pola `ReviewScreen.browser.test.tsx`/`SplitScanScreen.browser.test.tsx`.
- **`App.tsx` tidak punya test file di codebase ini** — App.tsx diverifikasi lewat `npm run build` (typecheck) + `npm run lint` + checklist uji device manual di `TASKS.md`. Task 9 mengikuti pola ini, sama seperti setiap task App.tsx sebelumnya di Fase 6/7A.
- **Satu bug urutan yang mudah terlewat, ditulis eksplisit di Task 9:** `exitSplit()` akan direvisi untuk ikut mengosongkan `straightenQueue`. React membatch beberapa `setState` dalam satu handler dan memakai pemanggilan **terakhir** untuk variabel yang sama — jadi di titik mana pun `exitSplit()` dipanggil BERSAMA `setStraightenQueue(sesuatu-yang-bukan-[])` dalam satu fungsi, `exitSplit()` **harus dipanggil lebih dulu**, atau isian queue yang baru saja diisi langsung tertimpa kosong lagi.
- Perintah: `npm run test:node`, `npm run test:browser`, `npm test` (keduanya), `npm run build` (typecheck + build), `npm run lint` (oxlint).
- **Basis test sekarang: 764 tes node + 135 tes browser = 899 total** (31 Agustus 2026 siang, `npm run test:node`/`npm run test:browser`). Tiap task menyebut angka yang diharapkan setelahnya sebagai pemeriksaan kasar, bukan target.
- Commit per task, conventional commits, akhiri dengan `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Matematika homografi (`src/lib/perspective.ts`)

**Files:**
- Create: `src/lib/perspective.ts`
- Test: `src/lib/perspective.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module, pure math, no imports beyond nothing).
- Produces:
  - `interface Point { x: number; y: number }` — used wherever `Quad`/`Matrix3` are (Tasks 2, 4, 6, 7, 8, 9).
  - `interface Quad { topLeft: Point; topRight: Point; bottomLeft: Point; bottomRight: Point }` — used by Tasks 2, 4, 5 (via re-export), 6, 7, 8, 9.
  - `type Matrix3 = readonly [number, number, number, number, number, number, number, number, number]` — internal to `perspective.ts`, not imported elsewhere.
  - `export const MIN_QUAD_AREA = 0.001` — used only within this file's own tests (Task 1).
  - `export function quadArea(quad: Quad): number` — used by Task 6 (`QuadOverlay`'s drag guard).
  - `export function unitSquareToQuad(quad: Quad): Matrix3 | null` — used by Task 2 (`warpImage`) and Task 4 (`remapMarksForWarp`).
  - `export function invertMatrix3(m: Matrix3): Matrix3 | null` — used by Task 4 (`remapMarksForWarp`).
  - `export function applyMatrix3(m: Matrix3, point: Point): Point` — used by Task 4 (`remapMarksForWarp`).
  - `export function warpedOutputSize(quad: Quad, sourceWidth: number, sourceHeight: number): { width: number; height: number }` — used by Task 2 (`warpImage`).
  - `export function sampleWarp(source: Uint8ClampedArray, sourceWidth: number, sourceHeight: number, dest: Uint8ClampedArray, destWidth: number, destHeight: number, matrix: Matrix3): void` — used by Task 2 (`warpImage`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/perspective.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  applyMatrix3,
  invertMatrix3,
  MIN_QUAD_AREA,
  quadArea,
  sampleWarp,
  unitSquareToQuad,
  warpedOutputSize,
  type Matrix3,
  type Quad,
} from './perspective'

/** The whole source image, corner for corner — the default a fresh QuadOverlay starts from. */
const FULL: Quad = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomLeft: { x: 0, y: 1 },
  bottomRight: { x: 1, y: 1 },
}

describe('quadArea', () => {
  it('is 1 for the full unit square', () => {
    expect(quadArea(FULL)).toBeCloseTo(1, 10)
  })

  it('is 0 for four corners collapsed onto one point', () => {
    const point = { x: 0.4, y: 0.4 }
    expect(quadArea({ topLeft: point, topRight: point, bottomLeft: point, bottomRight: point })).toBe(0)
  })

  it('is 0.25 for a quad covering exactly one quadrant', () => {
    const quadrant: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0.5, y: 0 },
      bottomLeft: { x: 0, y: 0.5 },
      bottomRight: { x: 0.5, y: 0.5 },
    }
    expect(quadArea(quadrant)).toBeCloseTo(0.25, 10)
  })
})

describe('unitSquareToQuad', () => {
  it('is the identity matrix for the full-image quad', () => {
    const matrix = unitSquareToQuad(FULL)!
    expect(matrix).not.toBeNull()

    for (const point of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0.3, y: 0.7 }]) {
      const mapped = applyMatrix3(matrix, point)
      expect(mapped.x).toBeCloseTo(point.x, 10)
      expect(mapped.y).toBeCloseTo(point.y, 10)
    }
  })

  /**
   * The common case in practice: a user who barely touches the corners ends
   * up with something very close to an axis-aligned rectangle, which is a
   * parallelogram — the branch of Heckbert's derivation that divides by
   * nothing. If this branch is wrong, every ordinary straighten breaks.
   */
  it('maps a plain inset rectangle without distorting it', () => {
    const rect: Quad = {
      topLeft: { x: 0.1, y: 0.2 },
      topRight: { x: 0.9, y: 0.2 },
      bottomLeft: { x: 0.1, y: 0.8 },
      bottomRight: { x: 0.9, y: 0.8 },
    }
    const matrix = unitSquareToQuad(rect)!

    expect(applyMatrix3(matrix, { x: 0, y: 0 })).toEqual({ x: 0.1, y: 0.2 })
    expect(applyMatrix3(matrix, { x: 1, y: 1 })).toEqual({ x: 0.9, y: 0.8 })
    expect(applyMatrix3(matrix, { x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 })
  })

  /**
   * A genuine perspective quad — not a parallelogram, so this exercises the
   * g/h branch. Hand-derived: P0=(0,0) P1=(2,0) P2=(1,1) P3=(0,1), verified
   * independently against the plan's own derivation (design doc Bagian 5.1 /
   * plan Task 1 notes) before being written here.
   */
  it('matches a hand-derived mapping for a true (non-parallelogram) quad', () => {
    const quad: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 2, y: 0 },
      bottomLeft: { x: 0, y: 1 },
      bottomRight: { x: 1, y: 1 },
    }
    const matrix = unitSquareToQuad(quad)!

    expect(applyMatrix3(matrix, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
    expect(applyMatrix3(matrix, { x: 1, y: 0 })).toEqual({ x: 2, y: 0 })
    expect(applyMatrix3(matrix, { x: 0, y: 1 })).toEqual({ x: 0, y: 1 })

    const bottomRight = applyMatrix3(matrix, { x: 1, y: 1 })
    expect(bottomRight.x).toBeCloseTo(1, 10)
    expect(bottomRight.y).toBeCloseTo(1, 10)
  })

  it('refuses four corners collapsed onto one point', () => {
    const point = { x: 0.4, y: 0.4 }
    expect(
      unitSquareToQuad({ topLeft: point, topRight: point, bottomLeft: point, bottomRight: point }),
    ).toBeNull()
  })

  it('refuses four corners that are all on one line', () => {
    const line: Quad = {
      topLeft: { x: 0.1, y: 0.5 },
      topRight: { x: 0.4, y: 0.5 },
      bottomLeft: { x: 0.6, y: 0.5 },
      bottomRight: { x: 0.9, y: 0.5 },
    }
    expect(unitSquareToQuad(line)).toBeNull()
  })

  it('refuses exactly at the documented MIN_QUAD_AREA threshold', () => {
    // A square of side s has area s^2; picking s just under sqrt(MIN_QUAD_AREA)
    // keeps this test tied to the exported constant instead of a made-up number,
    // so a future change to the threshold is caught here instead of silently
    // changing what counts as "too small" for every caller.
    const side = Math.sqrt(MIN_QUAD_AREA) * 0.99
    const tooSmall: Quad = {
      topLeft: { x: 0.5 - side / 2, y: 0.5 - side / 2 },
      topRight: { x: 0.5 + side / 2, y: 0.5 - side / 2 },
      bottomLeft: { x: 0.5 - side / 2, y: 0.5 + side / 2 },
      bottomRight: { x: 0.5 + side / 2, y: 0.5 + side / 2 },
    }
    expect(unitSquareToQuad(tooSmall)).toBeNull()

    const bigEnoughSide = Math.sqrt(MIN_QUAD_AREA) * 1.5
    const bigEnough: Quad = {
      topLeft: { x: 0.5 - bigEnoughSide / 2, y: 0.5 - bigEnoughSide / 2 },
      topRight: { x: 0.5 + bigEnoughSide / 2, y: 0.5 - bigEnoughSide / 2 },
      bottomLeft: { x: 0.5 - bigEnoughSide / 2, y: 0.5 + bigEnoughSide / 2 },
      bottomRight: { x: 0.5 + bigEnoughSide / 2, y: 0.5 + bigEnoughSide / 2 },
    }
    expect(unitSquareToQuad(bigEnough)).not.toBeNull()
  })
})

describe('invertMatrix3', () => {
  it('inverts the identity to itself', () => {
    const identity = unitSquareToQuad({
      topLeft: { x: 0, y: 0 },
      topRight: { x: 1, y: 0 },
      bottomLeft: { x: 0, y: 1 },
      bottomRight: { x: 1, y: 1 },
    })!
    expect(invertMatrix3(identity)).toEqual(identity)
  })

  it('round-trips a point through a true perspective matrix and its inverse', () => {
    const quad: Quad = {
      topLeft: { x: 0.05, y: 0.1 },
      topRight: { x: 0.85, y: 0.02 },
      bottomLeft: { x: 0.1, y: 0.92 },
      bottomRight: { x: 0.95, y: 0.88 },
    }
    const matrix = unitSquareToQuad(quad)!
    const inverse = invertMatrix3(matrix)!

    for (const point of [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.6 }, { x: 0.5, y: 0.5 }]) {
      const forward = applyMatrix3(matrix, point)
      const back = applyMatrix3(inverse, forward)
      expect(back.x).toBeCloseTo(point.x, 8)
      expect(back.y).toBeCloseTo(point.y, 8)
    }
  })

  it('refuses a singular matrix', () => {
    const singular: Matrix3 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
    expect(invertMatrix3(singular)).toBeNull()
  })
})

describe('warpedOutputSize', () => {
  it('matches the source size exactly for the full-image quad', () => {
    expect(warpedOutputSize(FULL, 3000, 4000)).toEqual({ width: 3000, height: 4000 })
  })

  it('follows the quad edges, not the source frame, for a half-height selection', () => {
    const topHalf: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 1, y: 0 },
      bottomLeft: { x: 0, y: 0.5 },
      bottomRight: { x: 1, y: 0.5 },
    }
    expect(warpedOutputSize(topHalf, 800, 1000)).toEqual({ width: 800, height: 500 })
  })

  it('never returns a zero dimension', () => {
    const point = { x: 0.4, y: 0.4 }
    const collapsed: Quad = { topLeft: point, topRight: point, bottomLeft: point, bottomRight: point }
    const size = warpedOutputSize(collapsed, 1000, 1000)
    expect(size.width).toBeGreaterThanOrEqual(1)
    expect(size.height).toBeGreaterThanOrEqual(1)
  })
})

describe('sampleWarp', () => {
  /** 2x2 source, one flat colour per pixel: TL=red, TR=green, BL=blue, BR=white. */
  function tinySource(): Uint8ClampedArray {
    // prettier-ignore
    return new Uint8ClampedArray([
      255, 0, 0, 255,     0, 255, 0, 255,
      0, 0, 255, 255,     255, 255, 255, 255,
    ])
  }

  it('reproduces the source pixel-for-pixel through the identity mapping', () => {
    const matrix = unitSquareToQuad(FULL)!
    const source = tinySource()
    const dest = new Uint8ClampedArray(source.length)

    sampleWarp(source, 2, 2, dest, 2, 2, matrix)

    // Pixel centres land exactly on the source grid at equal size, so this is
    // an exact match, not a "close enough" bilinear blend.
    expect([...dest]).toEqual([...source])
  })

  it('reads only the top-left quadrant when the quad selects just that corner', () => {
    const topLeftQuadrant: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0.5, y: 0 },
      bottomLeft: { x: 0, y: 0.5 },
      bottomRight: { x: 0.5, y: 0.5 },
    }
    const matrix = unitSquareToQuad(topLeftQuadrant)!
    // 4x4 source: solid red in the top-left quadrant, solid blue everywhere else.
    const source = new Uint8ClampedArray(4 * 4 * 4)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4
        const inTopLeft = x < 2 && y < 2
        source[i] = inTopLeft ? 255 : 0
        source[i + 1] = 0
        source[i + 2] = inTopLeft ? 0 : 255
        source[i + 3] = 255
      }
    }
    const dest = new Uint8ClampedArray(4 * 4 * 4)

    sampleWarp(source, 4, 4, dest, 4, 4, matrix)

    for (let i = 0; i < dest.length; i += 4) {
      expect(dest[i]).toBeGreaterThan(200) // red channel, everywhere
      expect(dest[i + 2]).toBeLessThan(60) // blue channel stays low everywhere
    }
  })

  it('clamps sampling at the source edge instead of reading past it', () => {
    const matrix = unitSquareToQuad(FULL)!
    const source = tinySource()
    const dest = new Uint8ClampedArray(4 * 4 * 4) // upsampled 4x — every sample still valid

    expect(() => sampleWarp(source, 2, 2, dest, 4, 4, matrix)).not.toThrow()
    // Bottom-right destination pixel should read close to the source's
    // bottom-right (white) pixel, not garbage from outside the buffer.
    const lastPixel = dest.length - 4
    expect(dest[lastPixel]).toBeGreaterThan(200)
    expect(dest[lastPixel + 1]).toBeGreaterThan(200)
    expect(dest[lastPixel + 2]).toBeGreaterThan(200)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project node perspective`
Expected: FAIL — `Cannot find module './perspective'` (file does not exist yet).

- [ ] **Step 3: Implement `src/lib/perspective.ts`**

```ts
/**
 * Perspective-correction maths behind "Luruskan Halaman" — Fase 7B.
 *
 * Free of canvas and every other DOM API, exactly like `enhance.ts`: these
 * read raw typed arrays and plain points, so they can be unit-tested under
 * Node against pixels and coordinates whose right answer is known.
 * `imageEditor.warpImage` does the decoding and encoding around them.
 *
 * No detection here — v1 only builds the tool (design doc Bagian 2). The
 * quad always comes from the user, dragged in `QuadOverlay` from a neutral
 * default. A detector, if one is ever built, only has to produce a `Quad` —
 * nothing in this module changes.
 */

export interface Point {
  x: number
  y: number
}

/**
 * Four corners of the region to straighten, in coordinates normalised 0..1
 * against the *source* image — same convention as `CropRect`. Not
 * necessarily axis-aligned; that is the whole point of this module.
 */
export interface Quad {
  topLeft: Point
  topRight: Point
  bottomLeft: Point
  bottomRight: Point
}

/**
 * Row-major 3x3 projective matrix: `[a, b, c, d, e, f, g, h, i]` representing
 *
 * ```
 * | a b c |
 * | d e f |
 * | g h i |
 * ```
 *
 * `applyMatrix3` treats the third row as the homogeneous divisor.
 */
export type Matrix3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
]

/** Guards `unitSquareToQuad`/`invertMatrix3` against division that would produce `NaN`/`Infinity`. */
const EPSILON = 1e-9

/**
 * Below this fraction of the unit square's area, a quad is treated as
 * degenerate — too close to a line or a point for a homography to be
 * numerically trustworthy. `QuadOverlay` enforces a much larger, usability
 * driven minimum of its own (Task 6); this is the last-resort safety net for
 * the maths itself, which must stand on its own (design doc Bagian 5.3).
 */
export const MIN_QUAD_AREA = 0.001

/**
 * Signed shoelace area of the quad, corners taken in `topLeft, topRight,
 * bottomRight, bottomLeft` order (i.e. walking the boundary). Correct for any
 * simple (non-self-crossing) quad; a self-crossing one can under-report its
 * visual area, which only makes this guard *more* conservative — acceptable,
 * since a self-crossing quad should be rejected anyway.
 */
export function quadArea(quad: Quad): number {
  const { topLeft: p0, topRight: p1, bottomRight: p2, bottomLeft: p3 } = quad
  const sum =
    (p0.x * p1.y - p1.x * p0.y) +
    (p1.x * p2.y - p2.x * p1.y) +
    (p2.x * p3.y - p3.x * p2.y) +
    (p3.x * p0.y - p0.x * p3.y)
  return Math.abs(sum) / 2
}

/**
 * Homography mapping the unit square `(0,0)-(1,0)-(1,1)-(0,1)` onto `quad`'s
 * four corners in the same order (`topLeft, topRight, bottomRight,
 * bottomLeft`) — Paul Heckbert's closed-form square-to-quad mapping
 * ("Fundamentals of Texture Mapping and Image Warping", 1989, §"Mapping a
 * Square to a Quadrilateral").
 *
 * Used two ways: directly, as the *sampling* matrix for `warpImage` (it
 * already maps "where in the output" to "where in the source", which is
 * exactly what per-pixel resampling wants — no inversion needed there); and
 * inverted (`invertMatrix3`), to move ink from source space into the
 * straightened page's space in `remapMarksForWarp`.
 *
 * Returns `null` when the quad is degenerate (`quadArea` below
 * `MIN_QUAD_AREA`) or its diagonals are parallel enough that the underlying
 * 2x2 linear solve would divide by (near) zero.
 */
export function unitSquareToQuad(quad: Quad): Matrix3 | null {
  if (quadArea(quad) < MIN_QUAD_AREA) return null

  const { topLeft: p0, topRight: p1, bottomRight: p2, bottomLeft: p3 } = quad

  const dx1 = p1.x - p2.x
  const dx2 = p3.x - p2.x
  const dx3 = p0.x - p1.x + p2.x - p3.x
  const dy1 = p1.y - p2.y
  const dy2 = p3.y - p2.y
  const dy3 = p0.y - p1.y + p2.y - p3.y

  let g = 0
  let h = 0
  // Exactly zero (not "close to zero") for a parallelogram — which is what
  // any axis-aligned rectangle is, including QuadOverlay's own untouched
  // default. Taking this branch there avoids dividing 0/0.
  if (dx3 !== 0 || dy3 !== 0) {
    const det = dx1 * dy2 - dx2 * dy1
    if (Math.abs(det) < EPSILON) return null
    g = (dx3 * dy2 - dx2 * dy3) / det
    h = (dx1 * dy3 - dx3 * dy1) / det
  }

  const a = p1.x - p0.x + g * p1.x
  const b = p3.x - p0.x + h * p3.x
  const c = p0.x
  const d = p1.y - p0.y + g * p1.y
  const e = p3.y - p0.y + h * p3.y
  const f = p0.y

  return [a, b, c, d, e, f, g, h, 1]
}

/** Standard cofactor-expansion inverse of a 3x3 matrix. `null` when singular. */
export function invertMatrix3(m: Matrix3): Matrix3 | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (Math.abs(det) < EPSILON) return null

  const invDet = 1 / det
  return [
    (e * i - f * h) * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    (f * g - d * i) * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    (d * h - e * g) * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet,
  ]
}

/** Maps `point` through `m`, dividing by the homogeneous coordinate. */
export function applyMatrix3(m: Matrix3, point: Point): Point {
  const [a, b, c, d, e, f, g, h, i] = m
  const w = g * point.x + h * point.y + i
  return {
    x: (a * point.x + b * point.y + c) / w,
    y: (d * point.x + e * point.y + f) / w,
  }
}

/**
 * Target pixel size for a straightened page: the quad's own edge lengths in
 * source pixels, not the source frame's size (design doc Bagian 5.2). A
 * photo taken at an angle should come back shaped like the paper, not like
 * the crooked frame the camera happened to capture.
 */
export function warpedOutputSize(
  quad: Quad,
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  const edge = (p1: Point, p2: Point) =>
    Math.hypot((p2.x - p1.x) * sourceWidth, (p2.y - p1.y) * sourceHeight)

  const topWidth = edge(quad.topLeft, quad.topRight)
  const bottomWidth = edge(quad.bottomLeft, quad.bottomRight)
  const leftHeight = edge(quad.topLeft, quad.bottomLeft)
  const rightHeight = edge(quad.topRight, quad.bottomRight)

  return {
    width: Math.max(1, Math.round((topWidth + bottomWidth) / 2)),
    height: Math.max(1, Math.round((leftHeight + rightHeight) / 2)),
  }
}

/** Bilinear sample of `src` at `(x, y)`, clamped to the buffer's edge. */
function sampleBilinear(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  out: Uint8ClampedArray,
  outIndex: number,
): void {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)))
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = Math.max(0, Math.min(1, x - x0))
  const ty = Math.max(0, Math.min(1, y - y0))

  const i00 = (y0 * width + x0) * 4
  const i10 = (y0 * width + x1) * 4
  const i01 = (y1 * width + x0) * 4
  const i11 = (y1 * width + x1) * 4

  for (let channel = 0; channel < 4; channel++) {
    const top = src[i00 + channel] * (1 - tx) + src[i10 + channel] * tx
    const bottom = src[i01 + channel] * (1 - tx) + src[i11 + channel] * tx
    out[outIndex + channel] = top * (1 - ty) + bottom * ty
  }
}

/**
 * Fills `dest` by reading `source` through `matrix` — for every destination
 * pixel, `matrix` gives the point in source space it came from (sampled at
 * the pixel's centre), read back bilinearly. `matrix` is `unitSquareToQuad`'s
 * output directly: it already maps "position in the straightened output,
 * 0..1" to "position in the source image, 0..1", which is exactly the
 * direction per-pixel resampling needs — no inversion in this hot loop.
 *
 * A first, straightforward pass — not yet optimised the way `correctLighting`
 * eventually was (design doc / Fase 7A Bagian 8). Task 3 measures it on a
 * realistic page before deciding whether it needs to be.
 */
export function sampleWarp(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  dest: Uint8ClampedArray,
  destWidth: number,
  destHeight: number,
  matrix: Matrix3,
): void {
  const [a, b, c, d, e, f, g, h, i] = matrix

  let index = 0
  for (let dy = 0; dy < destHeight; dy++) {
    const v = (dy + 0.5) / destHeight
    for (let dx = 0; dx < destWidth; dx++) {
      const u = (dx + 0.5) / destWidth
      const w = g * u + h * v + i
      const sx = ((a * u + b * v + c) / w) * sourceWidth - 0.5
      const sy = ((d * u + e * v + f) / w) * sourceHeight - 0.5

      sampleBilinear(source, sourceWidth, sourceHeight, sx, sy, dest, index)
      index += 4
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project node perspective`
Expected: PASS, all tests in `perspective.test.ts`.

- [ ] **Step 5: Full node suite + typecheck + lint**

Run: `npm run test:node && npm run build && npm run lint`
Expected: all pass. Node test count should read **764 + (however many were added above) passed**.

- [ ] **Step 6: Commit**

```bash
git add src/lib/perspective.ts src/lib/perspective.test.ts
git commit -m "feat(perspective): matematika homografi untuk Luruskan Halaman

Modul murni baru — pemetaan unit-square ke kuadrilateral (Heckbert
square-to-quad), inversi 3x3, dan pemetaan-balik per piksel dengan
sampel bilinear. Tanpa DOM, node-testable, mengikuti pola enhance.ts.
Bagian dari Fase 7B (auto-deskew jalur impor).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Sisi kanvas — `warpImage()`

**Files:**
- Modify: `src/lib/imageEditor.ts`
- Modify (add tests): `src/lib/imageEditor.browser.test.ts`

**Interfaces:**
- Consumes: `Quad`, `unitSquareToQuad`, `warpedOutputSize`, `sampleWarp` from `./perspective` (Task 1); `draw`, `decode`, `toBlob` (already private to `imageEditor.ts`).
- Produces (used by Task 5 via `straightenPage`, and directly by Task 9): `export async function warpImage(blob: Blob, quad: Quad): Promise<Blob>` — throws `Error` on a degenerate quad, never returns `null`.

- [ ] **Step 1: Write the failing tests**

Add to the end of `src/lib/imageEditor.browser.test.ts` (after the existing `enhancePage` describe block; the file already imports `describe, expect, it, vi` from `vitest`):

```ts
import { warpImage } from './imageEditor'
import type { Quad } from './perspective'
```

Add these two imports to the existing `import` list at the top of the file (merge into the existing `from './imageEditor'` import rather than adding a second one):

```ts
import {
  compressImage,
  compressImagePair,
  cropImage,
  enhancePage,
  getImageSize,
  rotateImage,
  warpImage,
} from './imageEditor'
```

Then append:

```ts
/** Four flat colours, one per quadrant, well separated in luminance so `sample()` tells them apart. */
async function quadrants(width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const halfW = width / 2
  const halfH = height / 2

  ctx.fillStyle = 'rgb(20, 20, 20)' // top-left, luminance ~20
  ctx.fillRect(0, 0, halfW, halfH)
  ctx.fillStyle = 'rgb(85, 85, 85)' // top-right, ~85
  ctx.fillRect(halfW, 0, halfW, halfH)
  ctx.fillStyle = 'rgb(170, 170, 170)' // bottom-left, ~170
  ctx.fillRect(0, halfH, halfW, halfH)
  ctx.fillStyle = 'rgb(235, 235, 235)' // bottom-right, ~235
  ctx.fillRect(halfW, halfH, halfW, halfH)

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.95))
}

const FULL_QUAD: Quad = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomLeft: { x: 0, y: 1 },
  bottomRight: { x: 1, y: 1 },
}

describe('warpImage', () => {
  it('produces a real JPEG', async () => {
    const out = await warpImage(await quadrants(400, 500), FULL_QUAD)
    const head = new Uint8Array(await out.slice(0, 3).arrayBuffer())

    expect([head[0], head[1], head[2]]).toEqual([0xff, 0xd8, 0xff])
  })

  it('leaves the four quadrants where they were for the full-image quad', async () => {
    const page = await quadrants(400, 400)
    const out = await warpImage(page, FULL_QUAD)

    expect(await sample(out, 50, 50)).toBeLessThan(50) // top-left, ~20
    const topRight = await sample(out, 350, 50) // top-right, ~85
    expect(topRight).toBeGreaterThan(60)
    expect(topRight).toBeLessThan(120)
    const bottomLeft = await sample(out, 50, 350) // bottom-left, ~170
    expect(bottomLeft).toBeGreaterThan(140)
    expect(bottomLeft).toBeLessThan(200)
    expect(await sample(out, 350, 350)).toBeGreaterThan(210) // bottom-right, ~235
  })

  it('extracts just the selected quadrant, filling the whole output with its colour', async () => {
    const page = await quadrants(400, 400)
    const topLeftQuadrant: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0.5, y: 0 },
      bottomLeft: { x: 0, y: 0.5 },
      bottomRight: { x: 0.5, y: 0.5 },
    }

    const out = await warpImage(page, topLeftQuadrant)

    // Every corner of the *output* should now read close to the top-left
    // quadrant's own luminance (~20) — the crop-like case of a general warp.
    const size = await getImageSize(out)
    expect(await sample(out, 5, 5)).toBeLessThan(50)
    expect(await sample(out, size.width - 5, size.height - 5)).toBeLessThan(50)
  })

  it('sizes the output from the quad edges, not the source frame', async () => {
    const page = await quadrants(800, 1000)
    const topHalf: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 1, y: 0 },
      bottomLeft: { x: 0, y: 0.5 },
      bottomRight: { x: 1, y: 0.5 },
    }

    const out = await warpImage(page, topHalf)

    expect(await getImageSize(out)).toEqual({ width: 800, height: 500 })
  })

  it('rejects a degenerate quad instead of producing garbage', async () => {
    const page = await quadrants(200, 200)
    const point = { x: 0.4, y: 0.4 }
    const collapsed: Quad = { topLeft: point, topRight: point, bottomLeft: point, bottomRight: point }

    await expect(warpImage(page, collapsed)).rejects.toThrow()
  })
})
```

The `sample()` helper already exists further down in this same file (used by the `enhancePage` tests) — no need to redefine it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project browser imageEditor`
Expected: FAIL — `warpImage is not a function` / `does not provide an export named 'warpImage'`.

- [ ] **Step 3: Implement `warpImage()` in `src/lib/imageEditor.ts`**

Add the import at the top of the file (alongside the existing `enhance.ts` import):

```ts
import {
  sampleWarp,
  unitSquareToQuad,
  warpedOutputSize,
  type Quad,
} from './perspective'
```

Re-export `Quad` for callers that only import from `imageEditor.ts` (`documentEditing.ts` already imports `CropRect`/`Rotation` from here — keeping `Quad` reachable the same way avoids a second import source for one type):

```ts
export type { Quad } from './perspective'
```

Add the function itself, right after `cropImage` (before `compressImage`):

```ts
/**
 * Straightens a page by warping the quadrilateral `quad` (in the source
 * image's own coordinates) into a rectangle — "Luruskan Halaman" (Fase 7B).
 *
 * Only the canvas work lives here. The maths — the homography and the
 * per-pixel resampling — is in `perspective.ts`, kept free of the DOM so it
 * can be tested against known pixels under Node.
 *
 * Always at the source's own resolution — unlike `enhancePage`, this is a
 * one-off operation (once per imported page, occasionally again from the
 * editor), not something every export re-runs, so there is no resolution cap
 * here to begin with (design doc Bagian 6). Task 3 measures whether that
 * holds up before the UI is designed any further.
 *
 * Throws rather than returning `null` on a degenerate quad: `QuadOverlay`
 * already keeps the user from dragging into one, so reaching this is a bug
 * report, not a normal outcome the caller should quietly absorb (design doc
 * Bagian 5.3).
 */
export async function warpImage(blob: Blob, quad: Quad): Promise<Blob> {
  const matrix = unitSquareToQuad(quad)
  if (!matrix) throw new Error('Empat sudut ini tidak membentuk bidang yang sah.')

  const bitmap = await decode(blob)
  const [srcCanvas, srcCtx] = draw(bitmap.width, bitmap.height)
  srcCtx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const source = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height)

  const { width: outWidth, height: outHeight } = warpedOutputSize(
    quad,
    srcCanvas.width,
    srcCanvas.height,
  )
  const [canvas, ctx] = draw(outWidth, outHeight)
  const dest = ctx.createImageData(canvas.width, canvas.height)

  sampleWarp(
    source.data,
    srcCanvas.width,
    srcCanvas.height,
    dest.data,
    canvas.width,
    canvas.height,
    matrix,
  )
  ctx.putImageData(dest, 0, 0)

  return toBlob(canvas, 0.92)
}
```

`0.92` matches `cropImage`/`rotateImage` — `warpImage` is their sibling in `editPage`'s transform family (Task 5), not a "derived render" in the `DERIVED_QUALITY` sense (that constant is reserved for the filter/ink/lighting renders — see its own doc comment above in this file).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project browser imageEditor`
Expected: PASS.

- [ ] **Step 5: Full browser suite + typecheck + lint**

Run: `npm run test:browser && npm run build && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/imageEditor.ts src/lib/imageEditor.browser.test.ts
git commit -m "feat(imageEditor): warpImage() untuk Luruskan Halaman

Sisi kanvas dari koreksi perspektif — decode, pemetaan-balik lewat
perspective.ts, encode. Kualitas 0.92 mengikuti cropImage/rotateImage,
bukan DERIVED_QUALITY (bukan render turunan, sejajar crop/rotate).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Gerbang pengukuran — **catat hasilnya sebelum lanjut ke Task 4**

**Files:**
- Create: `src/lib/warpBench.browser.test.ts`

**Interfaces:**
- Consumes: `warpImage` from `./imageEditor` (Task 2).
- Produces: nothing consumed by later tasks — this is a measurement, not a feature. Kept as a permanent file, mirroring `enhanceBench.browser.test.ts` (design doc Bagian 6 asks for this discipline the same way Fase 7A Bagian 8 did).

- [ ] **Step 1: Write the benchmark**

```ts
import { describe, expect, it } from 'vitest'
import { warpImage } from './imageEditor'
import type { Quad } from './perspective'

/**
 * Not a test of behaviour — a measurement, and a gate.
 *
 * `warpImage` runs at the source's own resolution (Task 2's doc comment) —
 * unlike Perbaiki Pencahayaan there is no cap to fall back on if this is too
 * slow. But the shape of the cost is different too: this runs once per
 * imported page (StraightenScreen, Task 9) and occasionally again from the
 * editor (Task 7) — not once per export, so the ±30 second / twenty pages
 * gate from Fase 7A Bagian 8 does not apply as-is here (design doc Bagian 6).
 * What matters is whether one page, on a mid-range phone, feels instant or
 * feels like a wait.
 *
 * Baseline device is a Xiaomi T15 flagship — if it feels slow there,
 * mid-range is far worse (TASKS.md Fase 7A pattern).
 *
 *   npx vitest run --project browser warpBench --reporter=verbose --silent=false
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

async function timeRuns(runs: number, call: () => Promise<unknown>): Promise<number[]> {
  const times: number[] = []
  for (let run = 0; run < runs; run++) {
    const started = performance.now()
    await call()
    times.push(performance.now() - started)
  }
  return times
}

function median(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

const ms = (times: number[]) => times.map((t) => Math.round(t)).join('/')
/** A phone with no discrete GPU is taken as roughly 4x a desktop browser — same multiplier as Fase 7A. */
const midRange = (time: number) => Math.round((time * 4) / 1000)

/** A gentle, realistic drag — corners pulled in a few percent, not a plain rectangle. */
const REALISTIC_QUAD: Quad = {
  topLeft: { x: 0.03, y: 0.06 },
  topRight: { x: 0.94, y: 0.02 },
  bottomLeft: { x: 0.05, y: 0.97 },
  bottomRight: { x: 0.96, y: 0.92 },
}

describe('warpImage cost on a 12 MP page', () => {
  it('measures one straighten at full resolution', async () => {
    const page = await bigScan(3000, 4000)

    const times = await timeRuns(4, () => warpImage(page, REALISTIC_QUAD))
    const total = median(times)

    console.log(
      `[bench] warpImage 3000x4000 — total ${ms(times)} median ${Math.round(total)}ms — ` +
        `proyeksi di mid-range: ${midRange(total)} detik per halaman`,
    )

    // Loose ceiling only, so a hang fails instead of stalling CI. Read the
    // console line above for the number that actually matters.
    expect(total).toBeLessThan(30_000)
  })
})
```

- [ ] **Step 2: Run it and read the console output**

Run: `npx vitest run --project browser warpBench --reporter=verbose --silent=false`

Read the `[bench]` line. This is a human decision point, not an automated pass/fail:

- If the mid-range projection is comfortably **under ~2 seconds per page**: it is fast enough for an interactive, one-page-at-a-time screen (`StraightenScreen`, Task 9) — proceed to Task 4 as planned.
- If it is **noticeably slower than that**: **stop and report the number to Boss Ali** before Task 6/7/9. Two directions already on record for exactly this situation (design doc Bagian 6, mirroring Fase 7A Bagian 8's own two fallback directions): cap the source resolution the way `ENHANCED_EDGE` caps Perbaiki Pencahayaan (accepting that a straightened page then permanently loses some resolution, unlike Perbaiki Pencahayaan's cap which only applies while its switch is on), or add a resampler-quality lever the way `resamplerFor()` does for compression. Do not pick one and implement it without that conversation — this changes what `StraightenScreen`'s progress UI (if any) needs to look like.

Record the measured numbers directly in this plan file (edit this step in place) and in `TASKS.md` Fase 7B once Task 10 writes that section, exactly as Fase 7A Bagian 8.1 did — the number is part of the record, not just terminal scrollback.

- [ ] **Step 3: Commit**

```bash
git add src/lib/warpBench.browser.test.ts
git commit -m "test(perspective): gerbang pengukuran warpImage per halaman 12 MP

Mengukur satu kali luruskan pada halaman 3000x4000 di Chromium,
proyeksi mid-range x4 — pola sama dengan enhanceBench.browser.test.ts
(Fase 7A). Angka dicatat di plan & TASKS.md, bukan hanya scrollback.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Ikut memindahkan tinta — `remapMarksForWarp()`

**Files:**
- Modify: `src/lib/annotations.ts`
- Modify (add tests): `src/lib/annotations.test.ts`

**Interfaces:**
- Consumes: `Quad`, `unitSquareToQuad`, `invertMatrix3`, `applyMatrix3` from `./perspective` (Task 1).
- Produces (used by Task 5): `export function remapMarksForWarp(marks: Mark[], quad: Quad): Mark[]`

- [ ] **Step 1: Write the failing tests**

Add `remapMarksForWarp` to the existing import list at the top of `src/lib/annotations.test.ts`:

```ts
import {
  defaultSignatureBox,
  HIGHLIGHTER_WIDTH_FACTOR,
  INK_COLORS,
  INK_WIDTHS,
  MIN_SIGNATURE_WIDTH,
  moveSignature,
  remapMarksForCrop,
  remapMarksForRotation,
  remapMarksForWarp,
  sanitizeMarks,
  resizeSignature,
  signatureAt,
  simplifyStroke,
  strokeWidth,
  type InkStroke,
  type Mark,
  type SignatureStamp,
} from './annotations'
import type { Quad } from './perspective'
```

Append at the end of the file:

```ts
describe('remapMarksForWarp', () => {
  const FULL: Quad = {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 1, y: 0 },
    bottomLeft: { x: 0, y: 1 },
    bottomRight: { x: 1, y: 1 },
  }

  it('leaves a stroke untouched through the full-image quad', () => {
    const marks: Mark[] = [stroke([0.2, 0.3, 0.7, 0.6])]
    const [remapped] = remapMarksForWarp(marks, FULL) as InkStroke[]

    expect(remapped.points[0]).toBeCloseTo(0.2, 8)
    expect(remapped.points[1]).toBeCloseTo(0.3, 8)
    expect(remapped.points[2]).toBeCloseTo(0.7, 8)
    expect(remapped.points[3]).toBeCloseTo(0.6, 8)
  })

  it('moves a stroke onto the straightened geometry for a quadrant quad', () => {
    // Selecting the top-left quadrant is the crop-like case: the page's
    // centre (0.25, 0.25 in source space) becomes the new page's bottom-right
    // corner.
    const quadrant: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0.5, y: 0 },
      bottomLeft: { x: 0, y: 0.5 },
      bottomRight: { x: 0.5, y: 0.5 },
    }
    const marks: Mark[] = [stroke([0.25, 0.25, 0.25, 0.25])]

    const [remapped] = remapMarksForWarp(marks, quadrant) as InkStroke[]

    expect(remapped.points[0]).toBeCloseTo(1, 8)
    expect(remapped.points[1]).toBeCloseTo(1, 8)
  })

  it('drops a stroke that lands entirely outside the straightened page', () => {
    const quadrant: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0.5, y: 0 },
      bottomLeft: { x: 0, y: 0.5 },
      bottomRight: { x: 0.5, y: 0.5 },
    }
    // Entirely in the bottom-right quadrant of the source — nowhere near the
    // top-left quadrant this quad keeps.
    const marks: Mark[] = [stroke([0.7, 0.7, 0.9, 0.9])]

    expect(remapMarksForWarp(marks, quadrant)).toEqual([])
  })

  it('keeps a stroke that only partly survives the warp', () => {
    const quadrant: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0.5, y: 0 },
      bottomLeft: { x: 0, y: 0.5 },
      bottomRight: { x: 0.5, y: 0.5 },
    }
    // One end inside the kept quadrant, one end outside it.
    const marks: Mark[] = [stroke([0.1, 0.1, 0.6, 0.6])]

    expect(remapMarksForWarp(marks, quadrant)).toHaveLength(1)
  })

  it('re-fits a signature box to the bounding box of its warped corners', () => {
    const quadrant: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0.5, y: 0 },
      bottomLeft: { x: 0, y: 0.5 },
      bottomRight: { x: 0.5, y: 0.5 },
    }
    const [moved] = remapMarksForWarp(
      [signature({ x: 0.1, y: 0.1, width: 0.2, height: 0.1 })],
      quadrant,
    ) as SignatureStamp[]

    // The box sat entirely in the kept quadrant (0..0.5, 0..0.5), doubled
    // onto the straightened page.
    expect(moved.x).toBeCloseTo(0.2, 8)
    expect(moved.y).toBeCloseTo(0.2, 8)
    expect(moved.width).toBeCloseTo(0.4, 8)
    expect(moved.height).toBeCloseTo(0.2, 8)
  })

  it('returns every mark unchanged when the quad is degenerate', () => {
    const point = { x: 0.4, y: 0.4 }
    const collapsed: Quad = { topLeft: point, topRight: point, bottomLeft: point, bottomRight: point }
    const marks: Mark[] = [stroke([0.1, 0.1, 0.2, 0.2])]

    // Unreachable in practice — QuadOverlay and warpImage both refuse this
    // quad first — but remapMarksForWarp must not crash if it is ever called
    // standalone with one. Dropping the marks would look like data loss for
    // no reason; passing them through unchanged is the safer failure.
    expect(remapMarksForWarp(marks, collapsed)).toEqual(marks)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project node annotations`
Expected: FAIL — `remapMarksForWarp is not a function`.

- [ ] **Step 3: Implement `remapMarksForWarp` in `src/lib/annotations.ts`**

Add the import at the top of the file (the existing first line already imports from `./imageEditor`):

```ts
import type { CropRect, Rotation } from './imageEditor'
import { applyMatrix3, invertMatrix3, unitSquareToQuad, type Quad } from './perspective'
```

Add the function after `remapMarksForRotation` (before `rotatePoint`):

```ts
/**
 * Moves marks onto the geometry `warpImage` produces for the same `quad`.
 *
 * Marks are stored in the *source* image's coordinates (design doc Bagian
 * 5.1's convention). `unitSquareToQuad(quad)` maps the straightened page onto
 * the source, so ink — which lives in the source — needs the *inverse* of
 * that same matrix to land in the straightened page's space. If the quad is
 * degenerate, `unitSquareToQuad`/`invertMatrix3` return `null` and the marks
 * are handed back untouched — `warpImage` already refuses to run on a
 * degenerate quad, so this path is a safety net, not a real one.
 */
export function remapMarksForWarp(marks: Mark[], quad: Quad): Mark[] {
  const forward = unitSquareToQuad(quad)
  const inverse = forward && invertMatrix3(forward)
  if (!inverse) return marks

  const remapped: Mark[] = []
  for (const mark of marks) {
    if (mark.kind === 'signature') {
      const corners = [
        { x: mark.x, y: mark.y },
        { x: mark.x + mark.width, y: mark.y },
        { x: mark.x, y: mark.y + mark.height },
        { x: mark.x + mark.width, y: mark.y + mark.height },
      ].map((point) => applyMatrix3(inverse, point))
      const xs = corners.map((point) => point.x)
      const ys = corners.map((point) => point.y)
      const box = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      }
      if (box.x + box.width <= 0 || box.x >= 1 || box.y + box.height <= 0 || box.y >= 1) continue
      remapped.push({ ...mark, ...box })
      continue
    }

    const points: number[] = []
    for (let i = 0; i < mark.points.length; i += 2) {
      const mapped = applyMatrix3(inverse, { x: mark.points[i], y: mark.points[i + 1] })
      points.push(mapped.x, mapped.y)
    }
    if (!touchesPage(points)) continue
    remapped.push({ ...mark, points })
  }

  return remapped
}
```

`touchesPage` already exists in this file (used by `remapMarksForCrop`) — reused here as-is.

**Note on the signature box:** a general homography can map an axis-aligned rectangle into a non-rectangular quadrilateral, and `SignatureStamp` only has room to store an axis-aligned box. Fitting the *bounding box* of the four warped corners (rather than, say, just two diagonal corners) is the closest a box can get — for the gentle warps a straighten in practice produces (the corners a user drags are rarely far from a plain rectangle) this is barely visible; for a sharp warp it can grow the stamp somewhat. That is an accepted approximation, not a bug — leave the comment above in place so the next reader does not "fix" it into something that silently drops precision at the corners instead.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project node annotations`
Expected: PASS.

- [ ] **Step 5: Full node suite + typecheck + lint**

Run: `npm run test:node && npm run build && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/annotations.ts src/lib/annotations.test.ts
git commit -m "feat(annotations): remapMarksForWarp() memindahkan tinta lewat homografi

Sejajar remapMarksForCrop/remapMarksForRotation. Memakai inversi
matriks unitSquareToQuad karena tinta hidup di ruang sumber, sedangkan
matriks itu sendiri memetakan ruang hasil ke ruang sumber.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `straightenPage()` — pembungkus ketiga di atas `editPage()`

**Files:**
- Modify: `src/lib/documentEditing.ts`
- Modify (add tests): `src/lib/documentEditing.test.ts`

**Interfaces:**
- Consumes: `warpImage` from `./imageEditor` (Task 2, added to the mock in the test file); `remapMarksForWarp` from `./annotations` (Task 4, real — not mocked, same as `remapMarksForCrop`/`remapMarksForRotation`); `editPage` (already private to `documentEditing.ts`).
- Produces (used by Task 7, 9): `export async function straightenPage(doc: LocalScanDocument, pageIndex: number, quad: Quad): Promise<LocalScanDocument>`

- [ ] **Step 1: Write the failing tests**

In `src/lib/documentEditing.test.ts`, add `warpImage` to the mocked `imageEditor` object at the top:

```ts
const imageEditor = {
  cropImage: vi.fn(async () => new Blob(['cropped'])),
  rotateImage: vi.fn(async () => new Blob(['rotated'])),
  filterImage: vi.fn(async () => new Blob(['filtered'])),
  enhancePage: vi.fn(async () => new Blob(['enhanced'])),
  warpImage: vi.fn(async () => new Blob(['warped'])),
}
vi.mock('./imageEditor', () => imageEditor)
```

Add `straightenPage` to the `await import('./documentEditing')` destructure:

```ts
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
```

Add a `QUAD` fixture near the existing `RECT` constant:

```ts
const RECT = { x: 0, y: 0, width: 1, height: 1 }
const QUAD = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomLeft: { x: 0, y: 1 },
  bottomRight: { x: 1, y: 1 },
}
```

Append a new `describe` block after the existing `describe('cropPage / rotatePage — ...')` block:

```ts
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
    const doc = { id: 'd', pages: [{ original: 'a.jpg', marks: [INK] }] }
    scanStorage.savePageEdit.mockResolvedValue({
      ...doc,
      pages: [{ original: 'a.jpg', edited: 'a-edited.jpg', marks: [INK] }],
    })
    scanStorage.applyPageDerived.mockResolvedValue(doc)

    // Selecting the top-left quadrant sends the page's centre to the
    // straightened page's bottom-right corner — same fixture reasoning as
    // remapMarksForWarp's own tests.
    const quadrant = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0.5, y: 0 },
      bottomLeft: { x: 0, y: 0.5 },
      bottomRight: { x: 0.5, y: 0.5 },
    }
    await straightenPage(
      { id: 'd', pages: [{ original: 'a.jpg', marks: [{ ...INK, points: [0.25, 0.25, 0.25, 0.25] }] }] },
      0,
      quadrant,
    )

    const marks = scanStorage.applyPageDerived.mock.calls[0][2]
    expect(marks[0].points[0]).toBeCloseTo(1, 8)
    expect(marks[0].points[1]).toBeCloseTo(1, 8)
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project node documentEditing`
Expected: FAIL — `straightenPage is not a function`.

- [ ] **Step 3: Implement `straightenPage` in `src/lib/documentEditing.ts`**

Add `warpImage` and `Quad` to the existing `./imageEditor` import:

```ts
import {
  cropImage,
  enhancePage,
  filterImage,
  renderMarks,
  rotateImage,
  warpImage,
  type CropRect,
  type Quad,
  type Rotation,
} from './imageEditor'
```

Add `remapMarksForWarp` to the existing `./annotations` import:

```ts
import {
  remapMarksForCrop,
  remapMarksForRotation,
  remapMarksForWarp,
  type Mark,
  type SignatureStamp,
} from './annotations'
```

Add the function right after `cropPage` (before `revertPage`):

```ts
/**
 * Straightens a page by warping the quadrilateral `quad` — "Luruskan
 * Halaman" (Fase 7B). A third sibling of `cropPage`/`rotatePage`: same
 * `editPage` machinery, so "Reset ke asli" undoes it and every derived
 * render (lighting, filter, ink) is rebuilt on top of it for free.
 */
export async function straightenPage(
  doc: LocalScanDocument,
  pageIndex: number,
  quad: Quad,
): Promise<LocalScanDocument> {
  return editPage(
    doc,
    pageIndex,
    (blob) => warpImage(blob, quad),
    (marks) => remapMarksForWarp(marks, quad),
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project node documentEditing`
Expected: PASS.

- [ ] **Step 5: Full node suite + typecheck + lint**

Run: `npm run test:node && npm run build && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/documentEditing.ts src/lib/documentEditing.test.ts
git commit -m "feat(documentEditing): straightenPage() sejajar cropPage/rotatePage

Pembungkus ketiga di atas editPage() yang sudah ada. Tidak ada
schemaVersion baru, tidak ada field baru di ScanPage — hasil warp
masuk edited persis seperti crop/rotate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Komponen `QuadOverlay`

**Files:**
- Create: `src/components/QuadOverlay.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `Point`, `Quad`, `quadArea` from `../lib/perspective` (Task 1).
- Produces (used by Task 7, 8): `export function QuadOverlay({ quad, onChange }: { quad: Quad; onChange: (quad: Quad) => void }): JSX.Element`

No dedicated test file — matches the established convention in this codebase for pointer-drag overlay components (`CropOverlay`, `AnnotateOverlay` have none either; see Global Constraints). Verified by typecheck/lint/build and, downstream, by the `StraightenScreen` and `EditorScreen` integrations that render it.

- [ ] **Step 1: Implement `src/components/QuadOverlay.tsx`**

```tsx
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { quadArea, type Point, type Quad } from '../lib/perspective'

type Corner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'

interface QuadOverlayProps {
  quad: Quad
  onChange: (quad: Quad) => void
}

/**
 * Below this fraction of the unit square's area, a corner drag is rejected
 * outright rather than applied. Ten times `perspective.ts`'s own
 * `MIN_QUAD_AREA` (0.001) — a margin the user can actually feel before a drag
 * stops responding, well before the maths itself would ever refuse the quad.
 * Not a "minimum useful size" the way `CropOverlay`'s `MIN_SIZE` is: a small
 * but well-formed quad (picking out one corner of a page) is a legitimate
 * thing to want, same as a small crop.
 */
const MIN_AREA = 0.01

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Four independently draggable corners for a perspective straighten — "Luruskan
 * Halaman" (Fase 7B). Sibling of `CropOverlay`, same normalised 0..1
 * coordinate convention, but a free quadrilateral rather than an
 * axis-aligned rectangle: there is no "move" handle, because there is no
 * single rigid shape here to slide as a whole.
 */
export function QuadOverlay({ quad, onChange }: QuadOverlayProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ corner: Corner; startX: number; startY: number; start: Point } | null>(
    null,
  )

  const beginDrag = (corner: Corner) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { corner, startX: event.clientX, startY: event.clientY, start: quad[corner] }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    const frame = frameRef.current
    if (!drag || !frame) return

    const bounds = frame.getBoundingClientRect()
    if (bounds.width === 0 || bounds.height === 0) return

    const dx = (event.clientX - drag.startX) / bounds.width
    const dy = (event.clientY - drag.startY) / bounds.height

    const next: Quad = {
      ...quad,
      [drag.corner]: { x: clamp01(drag.start.x + dx), y: clamp01(drag.start.y + dy) },
    }

    // A drag that would fold the quad in on itself is dropped rather than
    // applied — better than a corner the user can no longer see or grab.
    if (quadArea(next) < MIN_AREA) return

    onChange(next)
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
  }

  const corners: Corner[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']
  const points = corners.map((corner) => `${quad[corner].x * 100},${quad[corner].y * 100}`).join(' ')

  return (
    <div className="quad-overlay" ref={frameRef} onPointerMove={onPointerMove} onPointerUp={endDrag}>
      <svg className="quad-outline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon points={points} />
      </svg>
      {corners.map((corner) => (
        <span
          key={corner}
          className="quad-handle"
          style={{ left: `${quad[corner].x * 100}%`, top: `${quad[corner].y * 100}%` }}
          onPointerDown={beginDrag(corner)}
          onPointerUp={endDrag}
          role="slider"
          tabIndex={0}
          aria-label={`Sudut ${corner}`}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Add CSS to `src/App.css`**

Add right after the existing `.crop-handle--se` block (the last of the four crop-handle direction rules):

```css
.quad-overlay {
  position: absolute;
  inset: 0;
  touch-action: none;
}

.quad-outline {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.quad-outline polygon {
  fill: var(--acc-soft);
  stroke: #fff;
  stroke-width: 0.6;
  vector-effect: non-scaling-stroke;
}

.quad-handle {
  position: absolute;
  width: 30px;
  height: 30px;
  margin: -15px 0 0 -15px;
  border-radius: 999px;
  border: 3px solid #fff;
  background: var(--acc);
  cursor: grab;
  touch-action: none;
}

.quad-handle:active {
  cursor: grabbing;
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: both pass. (`QuadOverlay` is not yet imported anywhere — an unused-export warning from `oxlint`, if any, is expected to clear once Task 7/8 import it. If lint fails on an *unused component* rule specifically, note it and move on — Task 7 wires it in immediately after.)

- [ ] **Step 4: Commit**

```bash
git add src/components/QuadOverlay.tsx src/App.css
git commit -m "feat(components): QuadOverlay — kuadrilateral 4-sudut bebas

Sejajar CropOverlay tapi tanpa gagang 'move' — tidak ada bentuk kaku
tunggal untuk digeser sebagai satu unit. Penjaga area minimum memakai
quadArea() dari perspective.ts, jadi konsisten dengan penjaga
degenerate di lapisan matematika. Tidak ada test file khusus, mengikuti
pola CropOverlay/AnnotateOverlay di codebase ini.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Sambungan editor — mode `'straighten'` permanen

**Files:**
- Modify: `src/components/Icons.tsx`
- Modify: `src/screens/EditorScreen.tsx`

**Interfaces:**
- Consumes: `QuadOverlay` (Task 6), `straightenPage` (Task 5), `Quad` (re-exported from `../lib/imageEditor`, Task 2).
- Produces: nothing consumed by later tasks — this is the editor-side terminal integration. No dedicated test file, matching the established convention that `EditorScreen.tsx` itself has no test file in this codebase (see Global Constraints); verified by typecheck/lint/build and the device-test checklist Task 10 adds to `TASKS.md`.

- [ ] **Step 1: Add `StraightenIcon` to `src/components/Icons.tsx`**

Add after `CropIcon`:

```tsx
export function StraightenIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M5 6.5 8 3.5h8l3 3" />
      <path d="M3.5 20.5h17" />
      <path d="M5 6.5 3.5 20.5" />
      <path d="M19 6.5l1.5 14" />
    </svg>
  )
}
```

A trapezoid narrowing towards the top and a flat base beneath it — a page tapering with perspective, resting on a straight line.

- [ ] **Step 2: Wire the mode into `src/screens/EditorScreen.tsx`**

Widen the `Mode` union and `TITLES` map:

```ts
type Mode = 'none' | 'crop' | 'straighten' | 'filter' | 'enhance' | 'reorder' | 'annotate'

const TITLES: Record<Mode, string> = {
  none: 'Edit Halaman',
  crop: 'Potong Halaman',
  straighten: 'Luruskan Halaman',
  filter: 'Filter Dokumen',
  enhance: 'Perbaiki Pencahayaan',
  reorder: 'Urutkan Halaman',
  annotate: 'Anotasi & Tanda Tangan',
}
```

Add `StraightenIcon` to the `Icons` import, `QuadOverlay` to the components imports, `straightenPage` to the `documentEditing` import, and `Quad`/a `FULL_QUAD` default alongside the existing `FULL_CROP`:

```ts
import { QuadOverlay } from '../components/QuadOverlay'
```

```ts
import {
  CheckIcon,
  ChevronLeftIcon,
  CloseIcon,
  CropIcon,
  ImageIcon,
  MergeIcon,
  RotateIcon,
  SignatureIcon,
  StraightenIcon,
  SunIcon,
  UndoIcon,
} from '../components/Icons'
```

```ts
import {
  cropPage,
  describeEnhanceOutcome,
  loadAnnotationBase,
  loadPageBlob,
  movePage,
  revertPage,
  rotatePage,
  setDocumentEnhance,
  setDocumentFilter,
  setPageFilter,
  setPageMarks,
  straightenPage,
} from '../lib/documentEditing'
import type { CropRect, Quad } from '../lib/imageEditor'
```

Add the default quad next to `FULL_CROP` (near the top of the file, alongside the existing `const FULL_CROP: CropRect = ...`):

```ts
/** A neutral rectangle a few percent in from every edge — same inset as FULL_CROP, and for the same reason: easy to grab, and close enough to a no-op that applying it untouched changes very little. Never the output of any pixel analysis (design doc, Fase 7B Bagian 2 — v1 has no detection). */
const FULL_QUAD: Quad = {
  topLeft: { x: 0.05, y: 0.05 },
  topRight: { x: 0.95, y: 0.05 },
  bottomLeft: { x: 0.05, y: 0.95 },
  bottomRight: { x: 0.95, y: 0.95 },
}
```

Add state next to the existing `rect` state:

```ts
const [rect, setRect] = useState<CropRect>(FULL_CROP)
const [quad, setQuad] = useState<Quad>(FULL_QUAD)
```

Add handlers next to `handleApplyCrop`/`startCrop`:

```ts
const handleApplyStraighten = async () => {
  await run(() => straightenPage(doc, pageIndex, quad))
  setMode('none')
  setQuad(FULL_QUAD)
}

const startStraighten = () => {
  setQuad(FULL_QUAD)
  setMode('straighten')
}
```

Add the button to the first `.editor-actions` row (the page-geometry row — `Potong`, `Putar`, `Asli`), right after the `Potong` button:

```tsx
<div className="editor-actions">
  <button type="button" className="button" onClick={startCrop} disabled={isBusy}>
    <CropIcon size={17} />
    <span>Potong</span>
  </button>
  <button type="button" className="button" onClick={startStraighten} disabled={isBusy}>
    <StraightenIcon size={17} />
    <span>Luruskan</span>
  </button>
  <button type="button" className="button" onClick={handleRotate} disabled={isBusy}>
    <RotateIcon size={17} />
    <span>Putar</span>
  </button>
  <button
    type="button"
    className="button"
    onClick={handleReset}
    disabled={isBusy || !page?.edited}
  >
    <UndoIcon size={17} />
    <span>Asli</span>
  </button>
</div>
```

Extend the stage's crop-mode class check to cover `straighten` too, so it gets the same taller `--stage-max: 58vh` precision-work sizing as crop (the `editor-stage` block, currently `${mode === 'crop' ? ' editor-stage--crop' : ''}`):

```tsx
<div
  className={`editor-stage${mode === 'crop' || mode === 'straighten' ? ' editor-stage--crop' : ''}`}
  style={{ '--page-aspect': String(aspect) } as CSSProperties}
>
```

Render `QuadOverlay` next to the existing `CropOverlay` line:

```tsx
{mode === 'crop' && <CropOverlay rect={rect} onChange={setRect} />}
{mode === 'straighten' && <QuadOverlay quad={quad} onChange={setQuad} />}
```

Add the header subtitle case (the `mode === 'crop' ? '...' : ...` ternary in `flow-header__titles`):

```tsx
<p>
  {mode === 'crop'
    ? 'Geser sudut untuk mengatur area'
    : mode === 'straighten'
      ? 'Geser sudut untuk meluruskan'
      : `Halaman ${pageIndex + 1} dari ${doc.pageCount}`}
</p>
```

Add the apply/cancel action row, mirroring the existing `mode === 'crop'` block exactly, right after it:

```tsx
{mode === 'straighten' && (
  <div className="editor-actions">
    <button type="button" className="button" onClick={() => setMode('none')} disabled={isBusy}>
      <CloseIcon size={17} />
      <span>Batal</span>
    </button>
    <button
      type="button"
      className="button button--primary"
      onClick={handleApplyStraighten}
      disabled={isBusy}
    >
      <CheckIcon size={17} />
      <span>{isBusy ? 'Memproses…' : 'Terapkan'}</span>
    </button>
  </div>
)}
```

Every tier — no badge, no tier check anywhere in this task, matching Global Constraints.

- [ ] **Step 3: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/Icons.tsx src/screens/EditorScreen.tsx
git commit -m "feat(editor): tombol Luruskan permanen, sejajar Potong/Putar

Mode 'straighten' baru — QuadOverlay dibuka dari baris tombol geometri
per-halaman, memanggil straightenPage(). Semua tier, tanpa gerbang.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Layar `StraightenScreen`

**Files:**
- Create: `src/screens/StraightenScreen.tsx`
- Create: `src/screens/StraightenScreen.browser.test.tsx`

**Interfaces:**
- Consumes: `QuadOverlay` (Task 6), `Quad` (from `../lib/perspective`).
- Produces (used by Task 9): `export function StraightenScreen(props: StraightenScreenProps): JSX.Element`, where:

```ts
interface StraightenScreenProps {
  pageUri: string
  pageNumber: number
  pageCount: number
  isBusy: boolean
  onApply: (quad: Quad) => void
  onSkip: () => void
  onCancelAll: () => void
}
```

The screen holds only UI state (the dragged quad, reset per page); it does **not** call `warpImage` itself. `onApply` hands the chosen quad up to the caller, which owns the actual `fetch` + `warpImage()` + error handling — the same division already established between `EnhancePanel` (UI, receives callbacks) and `EditorScreen` (owns the async work), and required here because `App.tsx` has no test file to hide a real fetch/canvas call behind (Global Constraints).

- [ ] **Step 1: Write the failing tests**

Create `src/screens/StraightenScreen.browser.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { StraightenScreen } from './StraightenScreen'

async function renderScreen(overrides: Partial<Parameters<typeof StraightenScreen>[0]> = {}) {
  return await render(
    <StraightenScreen
      pageUri="uri-1"
      pageNumber={1}
      pageCount={3}
      isBusy={false}
      onApply={() => {}}
      onSkip={() => {}}
      onCancelAll={() => {}}
      {...overrides}
    />,
  )
}

const DEFAULT_QUAD = {
  topLeft: { x: 0.05, y: 0.05 },
  topRight: { x: 0.95, y: 0.05 },
  bottomLeft: { x: 0.05, y: 0.95 },
  bottomRight: { x: 0.95, y: 0.95 },
}

describe('the straighten screen', () => {
  it('hands the untouched default quad to Luruskan when nothing was dragged', async () => {
    const onApply = vi.fn()
    const screen = await renderScreen({ onApply })

    await screen.getByRole('button', { name: 'Luruskan' }).click()

    expect(onApply).toHaveBeenCalledWith(DEFAULT_QUAD)
  })

  it('skips without applying anything', async () => {
    const onSkip = vi.fn()
    const onApply = vi.fn()
    const screen = await renderScreen({ onSkip, onApply })

    await screen.getByRole('button', { name: 'Lewati' }).click()

    expect(onSkip).toHaveBeenCalled()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('leaves the whole import through the back chevron', async () => {
    const onCancelAll = vi.fn()
    const screen = await renderScreen({ onCancelAll })

    await screen.getByRole('button', { name: 'Kembali' }).click()

    expect(onCancelAll).toHaveBeenCalled()
  })

  it('disables every button while busy', async () => {
    const screen = await renderScreen({ isBusy: true })

    await expect.element(screen.getByRole('button', { name: 'Lewati' })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Memproses…' })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Kembali' })).toBeDisabled()
  })

  it('shows the page position in the header', async () => {
    const screen = await renderScreen({ pageNumber: 2, pageCount: 5 })

    await expect.element(screen.getByText('Halaman 2 dari 5 · geser sudut untuk meluruskan')).toBeVisible()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project browser StraightenScreen`
Expected: FAIL — `Failed to resolve import "./StraightenScreen"`.

- [ ] **Step 3: Implement `src/screens/StraightenScreen.tsx`**

```tsx
import { useEffect, useState, type CSSProperties } from 'react'
import { QuadOverlay } from '../components/QuadOverlay'
import { CheckIcon, ChevronLeftIcon } from '../components/Icons'
import type { Quad } from '../lib/perspective'

interface StraightenScreenProps {
  /** Displayable URI of the page awaiting confirmation — a raw scanner/import URI, already convertFileSrc'd (see documentScanner.ts's own note). */
  pageUri: string
  /** Position within the whole pending-pages list — matches the numbering ReviewScreen shows moments later, not a separate "import batch" count. */
  pageNumber: number
  pageCount: number
  isBusy: boolean
  onApply: (quad: Quad) => void
  onSkip: () => void
  onCancelAll: () => void
}

/**
 * A neutral rectangle a few percent in from every edge — same inset as
 * EditorScreen's FULL_CROP, and for the same reason: easy to grab, and close
 * enough to a no-op that applying it untouched changes very little. Never the
 * output of any pixel analysis — v1 has no edge detection (design doc,
 * Fase 7B Bagian 2).
 */
const DEFAULT_QUAD: Quad = {
  topLeft: { x: 0.05, y: 0.05 },
  topRight: { x: 0.95, y: 0.05 },
  bottomLeft: { x: 0.05, y: 0.95 },
  bottomRight: { x: 0.95, y: 0.95 },
}

/**
 * One page at a time, standing between an imported page and ReviewScreen —
 * "Luruskan Halaman" for the import path (Fase 7B). Only ML Kit scanner pages
 * skip this screen; they already arrive perspective-corrected.
 *
 * Deliberately does not call `warpImage` itself. The caller (`App.tsx`) owns
 * the actual fetch + warp + error handling, the same split already used
 * between `EnhancePanel` and `EditorScreen` — this screen stays a plain,
 * fully testable function of its props.
 */
export function StraightenScreen({
  pageUri,
  pageNumber,
  pageCount,
  isBusy,
  onApply,
  onSkip,
  onCancelAll,
}: StraightenScreenProps) {
  const [quad, setQuad] = useState<Quad>(DEFAULT_QUAD)
  const [aspect, setAspect] = useState(1 / Math.SQRT2)

  // Every new page starts from the same neutral guess — a quad left bent from
  // the previous page would show up already skewed on one that may not need
  // it at all.
  useEffect(() => {
    setQuad(DEFAULT_QUAD)
  }, [pageUri])

  return (
    <div className="screen screen--flow">
      <header className="flow-header">
        <button
          type="button"
          className="icon-button"
          onClick={onCancelAll}
          aria-label="Kembali"
          disabled={isBusy}
        >
          <ChevronLeftIcon size={20} />
        </button>
        <div className="flow-header__titles">
          <h1>Luruskan Halaman</h1>
          <p>
            Halaman {pageNumber} dari {pageCount} · geser sudut untuk meluruskan
          </p>
        </div>
      </header>

      <div
        className="editor-stage editor-stage--crop"
        style={{ '--page-aspect': String(aspect) } as CSSProperties}
      >
        <img
          className="editor-image"
          src={pageUri}
          alt={`Halaman impor ${pageNumber}`}
          onLoad={(event) =>
            setAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)
          }
        />
        <QuadOverlay quad={quad} onChange={setQuad} />
      </div>

      <div className="flow-footer">
        <button type="button" className="button" onClick={onSkip} disabled={isBusy}>
          <span>Lewati</span>
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={() => onApply(quad)}
          disabled={isBusy}
        >
          <CheckIcon size={17} />
          <span>{isBusy ? 'Memproses…' : 'Luruskan'}</span>
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project browser StraightenScreen`
Expected: PASS.

- [ ] **Step 5: Full browser suite + typecheck + lint**

Run: `npm run test:browser && npm run build && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/screens/StraightenScreen.tsx src/screens/StraightenScreen.browser.test.tsx
git commit -m "feat(screens): StraightenScreen — konfirmasi luruskan per halaman impor

Satu halaman per satu, di antara impor dan ReviewScreen. Tidak
memanggil warpImage sendiri — App.tsx (Task 9) yang memegang kerja
async-nya, supaya layar ini tetap fungsi murni dari props yang bisa
diuji penuh.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Sambungan `App.tsx` — `straightenQueue` & jalur impor

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `StraightenScreen` (Task 8), `warpImage` (Task 2, from `./lib/imageEditor`), `Quad` (re-exported from `./lib/imageEditor`).
- Produces: nothing consumed by later tasks — top-level wiring, no dedicated test file (Global Constraints). Verified by typecheck/lint/build; device-test checklist added in Task 10.

- [ ] **Step 1: Add imports**

Add `StraightenScreen` next to the other screen imports:

```ts
import { SplitScanScreen } from './screens/SplitScanScreen'
import { StraightenScreen } from './screens/StraightenScreen'
```

Add `warpImage` and `Quad` — a new import from `./lib/imageEditor` (not previously imported in `App.tsx`):

```ts
import { warpImage, type Quad } from './lib/imageEditor'
```

- [ ] **Step 2: Add `straightenQueue` state**

Right after the existing `pendingPagesRef` block:

```ts
const [pendingPages, setPendingPages] = useState<string[] | null>(null)
const pendingPagesRef = useRef(pendingPages)
pendingPagesRef.current = pendingPages
/**
 * Indices into `pendingPages` still waiting on a Luruskan/Lewati decision —
 * only ever populated by pages that arrived through the share/import path
 * (`onSharedFilesReceived` below). Scanner pages never enter this queue: they
 * already arrive perspective-corrected (design doc, Fase 7B Bagian 4).
 */
const [straightenQueue, setStraightenQueue] = useState<number[]>([])
const [isStraightening, setIsStraightening] = useState(false)
```

- [ ] **Step 3: Reset the queue everywhere a pending-pages session is reset**

Modify `exitSplit`:

```ts
/** Leaves split mode and forgets everything it was holding. */
const exitSplit = () => {
  setSplitting(false)
  setSplitCuts([])
  setSplitName('')
  setSplitSaved(0)
  setSplitProgress(null)
  // Not split state, but grouped here for the same reason the four lines
  // above are one function instead of four separate calls scattered at each
  // call site: every place that resets a pending-pages session already calls
  // this one function, so a queue left over from an import abandoned
  // mid-Straighten cannot resurface against a completely different scan.
  setStraightenQueue([])
}
```

Modify `handleStartScan` — call `exitSplit()` before setting fresh pages (order does not matter here since nothing else in this function touches `straightenQueue`, but keeping the same shape as the share-import branch below avoids the class of bug called out in Global Constraints):

```ts
const handleStartScan = async () => {
  const pages = await runScanner()
  if (!pages) return
  exitSplit()
  setPendingPages(pages)
  setCurrentPage(0)
  setReviewPreview(null)
}
```

- [ ] **Step 4: Enqueue new import pages in the `onSharedFilesReceived` effect**

Replace the effect body:

```ts
useEffect(() => {
  return onSharedFilesReceived(({ images, skippedCount }) => {
    if (images.length > 0) {
      if (pendingPagesRef.current) {
        // Mid-review already: same as handleAddPages -- append only. The new
        // pages' indices sit after every page already in the list.
        const startIndex = pendingPagesRef.current.length
        setPendingPages((existing) => [...(existing ?? []), ...images])
        setStraightenQueue((queue) => [...queue, ...images.map((_, i) => startIndex + i)])
      } else {
        // Nothing in progress: same as handleStartScan -- a fresh review
        // session. exitSplit() is called *first*, not last: it clears
        // straightenQueue too (see its own comment), and calling it after
        // setStraightenQueue below would silently wipe the queue this branch
        // is trying to fill — React applies same-tick setState calls for one
        // variable in the order they were made, and exitSplit's own call
        // would be the last word on straightenQueue if it ran second.
        exitSplit()
        setPendingPages(images)
        setStraightenQueue(images.map((_, i) => i))
        setCurrentPage(0)
        setReviewPreview(null)
      }
    }

    if (skippedCount > 0) {
      setToast(
        images.length > 0
          ? 'Sebagian file tidak bisa diimpor.'
          : 'Tidak ada file yang bisa diimpor.',
      )
    }
  })
}, [])
```

- [ ] **Step 5: Add the revoke helper**

Add near the top of the file, outside the `App` component (module scope), after the imports:

```ts
/**
 * Frees the in-memory pages Luruskan produced during this pending-pages
 * session (StraightenScreen swaps a straightened page's URI for
 * `URL.createObjectURL(warped)` — see `handleStraightenApply` below). A page
 * the user chose Lewati for was never replaced, so this is a no-op for it.
 */
function revokeStraightenedUris(uris: string[]): void {
  for (const uri of uris) {
    if (uri.startsWith('blob:')) URL.revokeObjectURL(uri)
  }
}
```

- [ ] **Step 6: Add the straighten handlers**

Add next to `handleRemovePage`:

```ts
const handleStraightenApply = async (quad: Quad) => {
  const index = straightenQueue[0]
  if (index === undefined || !pendingPages) return

  setIsStraightening(true)
  try {
    const response = await fetch(pendingPages[index])
    if (!response.ok) throw new Error(`Gagal membaca halaman (HTTP ${response.status}).`)
    const warped = await warpImage(await response.blob(), quad)
    const objectUrl = URL.createObjectURL(warped)

    setPendingPages((existing) => {
      if (!existing) return existing
      const next = [...existing]
      next[index] = objectUrl
      return next
    })
    setStraightenQueue((queue) => queue.slice(1))
  } catch (error) {
    setToast(error instanceof Error ? error.message : 'Gagal meluruskan halaman.')
  } finally {
    setIsStraightening(false)
  }
}

const handleStraightenSkip = () => {
  setStraightenQueue((queue) => queue.slice(1))
}
```

- [ ] **Step 7: Revoke on Save and on Cancel**

In `handleSaveDocument`, revoke right after the save succeeds (before clearing `pendingPages`):

```ts
const handleSaveDocument = async () => {
  if (!pendingPages) return
  setIsSaving(true)
  try {
    await saveScanDocument(pendingPages)
    await refreshDocuments()
    revokeStraightenedUris(pendingPages)
    setPendingPages(null)
    exitSplit()
    setTab('documents')
    setToast('Dokumen tersimpan.')
    void maybeShowInterstitial('scan-saved', tier)
  } catch (error) {
    setToast(error instanceof Error ? error.message : 'Gagal menyimpan dokumen.')
  } finally {
    setIsSaving(false)
  }
}
```

Find the `ReviewScreen`'s `onCancel` prop (inside the render block, `onCancel={() => { setPendingPages(null); exitSplit() }}`) and revoke there too:

```tsx
onCancel={() => {
  revokeStraightenedUris(pendingPages)
  setPendingPages(null)
  exitSplit()
}}
```

**Accepted gap, documented rather than handled:** `handleSplitSave`'s partial-failure branch (`setPendingPages(result.remaining.flat())`) replaces `pendingPages` with a different, smaller array without revoking whatever `blob:` URIs among the *successfully saved* pages just fell out of it. Splitting only happens after every page has already left the straighten queue, so this is a rare path (a split save that partially fails, on a session that also happened to straighten something) leaking a handful of already-encoded JPEGs for the rest of the app session — bounded, not repeating, and not worth the branch-by-branch diffing it would take to close precisely. Add this as a one-line comment directly above the `setPendingPages(result.remaining.flat())` call in `handleSplitSave`:

```ts
// Not revoked: any blob: URIs among the pages that succeeded and dropped out
// of `remaining` leak until the app is closed. Rare (split + a straightened
// page + a partial failure, all at once) and bounded — see App.tsx's
// revokeStraightenedUris for the paths that do handle this.
setPendingPages(result.remaining.flat())
```

- [ ] **Step 8: Render `StraightenScreen` ahead of everything else in the pending-pages block**

Find `if (pendingPages) {` and add a new first branch, before the existing `if (splitting) {`:

```tsx
if (pendingPages) {
  if (straightenQueue.length > 0) {
    const index = straightenQueue[0]
    return (
      <div className="app">
        <StraightenScreen
          pageUri={pendingPages[index]}
          pageNumber={index + 1}
          pageCount={pendingPages.length}
          isBusy={isStraightening}
          onApply={(quad) => void handleStraightenApply(quad)}
          onSkip={handleStraightenSkip}
          onCancelAll={() => {
            revokeStraightenedUris(pendingPages)
            setPendingPages(null)
            exitSplit()
          }}
        />
        {toast && <p className="toast">{toast}</p>}
      </div>
    )
  }

  if (splitting) {
    // ... existing code, unchanged ...
```

Everything from the existing `if (splitting) {` line onward stays exactly as it is — this task only adds the new branch ahead of it.

- [ ] **Step 9: Typecheck + lint**

Run: `npm run build && npm run lint`
Expected: both pass.

- [ ] **Step 10: Manual smoke check (App.tsx has no test file — see Global Constraints)**

Run: `npm run dev`, open the app in a browser, and confirm:
- A normal scan (or, on web, whatever `scanDocument()` falls back to) still reaches `ReviewScreen` directly — `straightenQueue` stays empty for scanner pages.
- Nothing crashes when `pendingPages` is `null` and the app is on another tab (the new state doesn't leak into unrelated renders).

Full device verification (share sheet import, actual straightening) is out of reach on desktop `npm run dev` and belongs to the device-test checklist Task 10 adds to `TASKS.md` — this step is only a sanity check that the wiring itself does not break the existing scan flow.

- [ ] **Step 11: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): sambungkan StraightenScreen ke jalur impor

straightenQueue melacak halaman impor yang belum dikonfirmasi tanpa
mengubah tipe pendingPages -- halaman yang diluruskan diganti object
URL hasilnya di array yang sama. pendingPages tetap string[]; tidak ada
tipe PendingPage baru.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Verifikasi menyeluruh & dokumentasi

**Files:**
- Modify: `TASKS.md`

**Interfaces:** none — closing task.

- [ ] **Step 1: Full verification**

Run in order:

```bash
npm run test:node
npm run test:browser
npm run build
npm run lint
```

Expected: every command exits clean. Note the final node/browser test counts (starting point was 764 node + 135 browser = 899).

- [ ] **Step 2: Update `TASKS.md`**

In the `### 7B — Auto-deskew & auto-crop presisi (menyusul)` section, replace:

```markdown
- [ ] Deteksi tepi & koreksi perspektif untuk gambar yang **bukan** dari pemindai
  (share sheet, halaman PDF pihak ketiga)
- [ ] Belum di-brainstorm; spec sendiri saat 7A selesai
```

with:

```markdown
- [x] Spec ditulis & disetujui Boss Ali 31 Agustus 2026:
  `docs/superpowers/specs/2026-08-31-fase7b-auto-deskew-design.md`. Plan:
  `docs/superpowers/plans/2026-08-31-fase7b-auto-deskew.md`.
- [x] **Alat luruskan manual — selesai.** Kuadrilateral 4-sudut bebas
  (`QuadOverlay`), koreksi perspektif lewat homografi pemetaan-balik
  (`perspective.ts` + `imageEditor.warpImage()`). Bukan tahap baru di rantai
  turunan — `straightenPage()` sejajar `cropPage`/`rotatePage`, menulis ke
  `edited` lewat `editPage()` yang sudah ada. Tidak ada `schemaVersion` baru.
- [x] Layar `StraightenScreen` menyela jalur impor (share sheet & rasterisasi
  PDF) sebelum `ReviewScreen` — satu halaman per satu, selalu menunggu
  konfirmasi (Luruskan/Lewati), tidak pernah auto-terap. Halaman scanner
  ML Kit tidak pernah masuk layar ini.
- [x] Tombol **Luruskan** permanen di editor, sejajar Potong/Putar — bisa
  dipakai ulang kapan saja lewat "Reset ke asli", sama seperti crop/rotate.
- [x] Semua tier, tanpa gerbang tier di mana pun di jalur ini.
- [x] **Tidak ada deteksi tepi otomatis di v1** — sudut awal selalu persegi
  inset 5%, bukan hasil analisis piksel. Fast-follow tercatat sebagai
  known gap, sama pola dengan noise-reduction di Fase 7A: seam-nya cuma
  mengganti titik asal sudut default, tidak menyentuh warpImage/
  straightenPage/data model apa pun.
- [x] Test bertambah <ISI ANGKA SEBENARNYA DARI STEP 1> (total <ISI ANGKA>).
```

Replace the literal `<ISI ANGKA SEBENARNYA DARI STEP 1>` placeholders with the real counts from Step 1 before committing — these are not meant to ship as placeholders; they are filled in as part of this task, same as every other task in this plan being expected to leave no "TODO" behind.

Add a new **"Belum diverifikasi di device fisik"** subsection right after, following the exact pattern every other phase in `TASKS.md` uses:

```markdown
**Belum diverifikasi di device fisik** (butuh Boss Ali):

- [ ] Impor foto miring dari galeri/aplikasi lain lewat share sheet →
  `StraightenScreen` muncul otomatis sebelum layar Tinjau, dengan sudut awal
  persegi inset — geser sudut ke tepi kertas sungguhan, tekan **Luruskan**,
  hasilnya tampak lurus di layar Tinjau berikutnya
- [ ] Impor PDF pihak ketiga (bukan buatan ScannApp sendiri) lewat share sheet
  → tiap halamannya juga melalui `StraightenScreen`
- [ ] Tekan **Lewati** untuk halaman yang sudah lurus → halaman masuk ke
  Tinjau apa adanya, tanpa terpotong
- [ ] Scan biasa lewat kamera pemindai (bukan impor) → **tidak pernah**
  masuk `StraightenScreen`, langsung ke Tinjau seperti sebelumnya
- [ ] Share baru datang saat sudah berada di layar Tinjau (sesi campuran) →
  hanya halaman baru itu yang memicu `StraightenScreen`, bukan yang sudah
  ada di daftar
- [ ] Tombol kembali (chevron) di `StraightenScreen` membatalkan **seluruh**
  impor yang sedang berjalan, bukan cuma halaman itu
- [ ] Tombol **Luruskan** permanen di editor (sejajar Potong/Putar) pada
  dokumen yang sudah tersimpan — bekerja dan bisa dibatalkan lewat **Asli**
- [ ] Waktu nyata meluruskan satu halaman 12 MP di HP dibanding proyeksi
  Task 3 (bench `warpBench.browser.test.ts`) — isi angkanya di sini setelah
  diuji
```

- [ ] **Step 3: Commit**

```bash
git add TASKS.md
git commit -m "docs(tasks): tandai kemampuan luruskan Fase 7B selesai di kode

Alat manual (tanpa deteksi otomatis, sesuai keputusan brainstorm 31
Agustus 2026) selesai: QuadOverlay, warpImage, straightenPage,
StraightenScreen, tombol editor permanen. Deteksi tepi otomatis
tercatat sebagai known gap fast-follow. Menunggu uji device fisik.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Catatan untuk eksekutor

- **Task 3 adalah gerbang keputusan, bukan gerbang lolos/gagal otomatis.** Baca console output-nya sungguhan; jangan lanjut ke Task 4 kalau angkanya jelas berat tanpa melapor ke Boss Ali dulu — persis seperti Fase 7A Bagian 8.
- **Task 1 memuat aljabar yang sudah diverifikasi tangan** (lihat komentar di setiap test "hand-derived") sebelum ditulis ke plan ini — kalau `unitSquareToQuad` gagal di test manapun, curigai salah ketik saat menyalin rumus, bukan rumusnya sendiri.
- **Jangan tergoda menambah deteksi tepi otomatis "sambil lewat"** di task manapun — itu keluar dari cakupan yang disetujui Boss Ali (spec Bagian 2), dan seam-nya sudah sengaja disiapkan supaya bisa menyusul tanpa membongkar apa pun yang dibangun di sini.
- **`pendingPages` tetap `string[]` di seluruh plan ini** — godaan untuk "merapikan" jadi `PendingPage[]` beranotasi sudah dipertimbangkan dan ditolak saat menulis plan (lihat spec vs. desain akhir): `straightenQueue: number[]` terpisah lebih kecil dampaknya dan tidak menyentuh `ReviewScreen`/`SplitScanScreen`/`PageViewerScreen`/`saveScanDocument` sama sekali.
