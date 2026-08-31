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
