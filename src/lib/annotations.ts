import type { CropRect, Rotation } from './imageEditor'

/**
 * What a user has drawn on top of a page.
 *
 * Kept as data rather than burned into the page image, because the page image
 * underneath is itself derived: change the filter and it is rendered again
 * from scratch. Ink baked into it would be filtered along with the paper — a
 * blue signature crushed to black by Hitam-Putih — and would vanish the moment
 * the filter changed. See the design doc, Bagian 2.1.
 *
 * Every coordinate is a fraction of the page (0..1), never a screen pixel: a
 * stroke is drawn over a ~340px preview and rendered onto a 3000px page.
 */
export interface InkStroke {
  kind: 'ink'
  tool: InkTool
  color: string
  /** Stroke width as a fraction of the page's long edge. */
  width: number
  /** Flat `[x0, y0, x1, y1, …]`, which halves the JSON of an array of pairs. */
  points: number[]
}

export interface SignatureStamp {
  kind: 'signature'
  /** Directory.Data-relative path of the transparent PNG. */
  source: string
  x: number
  y: number
  width: number
  height: number
}

export type Mark = InkStroke | SignatureStamp

export type InkTool = 'pen' | 'highlighter'

/**
 * The four ink colours, every one of them already used elsewhere in the app —
 * CLAUDE.md 9.2 rules out introducing new ones.
 */
export const INK_COLORS = [
  { id: 'black', label: 'Hitam', value: '#1b2740' },
  { id: 'blue', label: 'Biru', value: '#2563eb' },
  { id: 'red', label: 'Merah', value: '#e5484d' },
  { id: 'yellow', label: 'Kuning', value: '#f5c443' },
] as const

export type InkColorId = (typeof INK_COLORS)[number]['id']

/** Three nib sizes, as fractions of the page's long edge. */
export const INK_WIDTHS = {
  thin: 0.0025,
  medium: 0.0045,
  thick: 0.009,
} as const

export type InkWidth = keyof typeof INK_WIDTHS

/** A highlighter is drawn far wider than a pen at the same nominal size. */
export const HIGHLIGHTER_WIDTH_FACTOR = 5
/** …and translucent, so the text underneath still reads. */
export const HIGHLIGHTER_ALPHA = 0.38

/** How much of the page a freshly dropped signature covers, along its width. */
export const SIGNATURE_DEFAULT_WIDTH = 0.34

/** How wide this stroke actually draws, before the page's long edge scales it. */
export function strokeWidth(stroke: InkStroke): number {
  return stroke.tool === 'highlighter' ? stroke.width * HIGHLIGHTER_WIDTH_FACTOR : stroke.width
}

/**
 * Drops anything a stored index should not be trusted to contain.
 *
 * The index is a JSON file on the user's device; a half-written entry or a
 * document restored from an older build must not be able to crash the editor.
 * Anything that does not survive this is simply not a mark.
 */
export function sanitizeMarks(raw: unknown): Mark[] {
  if (!Array.isArray(raw)) return []

  const marks: Mark[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const mark = entry as Partial<InkStroke> & Partial<SignatureStamp>

    if (mark.kind === 'ink') {
      if (mark.tool !== 'pen' && mark.tool !== 'highlighter') continue
      if (typeof mark.color !== 'string' || typeof mark.width !== 'number') continue
      if (!Array.isArray(mark.points) || mark.points.length < 4) continue
      // An odd length means a point lost half of itself; the trailing x would
      // otherwise be read as a y and bend the whole stroke.
      if (mark.points.length % 2 !== 0) continue
      if (!mark.points.every((value) => typeof value === 'number' && Number.isFinite(value))) {
        continue
      }
      marks.push({
        kind: 'ink',
        tool: mark.tool,
        color: mark.color,
        width: mark.width,
        points: mark.points,
      })
      continue
    }

    if (mark.kind === 'signature') {
      if (typeof mark.source !== 'string' || mark.source === '') continue
      const box = [mark.x, mark.y, mark.width, mark.height]
      if (!box.every((value) => typeof value === 'number' && Number.isFinite(value))) continue
      if (mark.width! <= 0 || mark.height! <= 0) continue
      marks.push({
        kind: 'signature',
        source: mark.source,
        x: mark.x!,
        y: mark.y!,
        width: mark.width!,
        height: mark.height!,
      })
    }
  }

  return marks
}

/**
 * Moves marks with the page when it is cropped.
 *
 * Normalised coordinates float relative to the page's *content*, so a crop
 * slides the ink across the paper unless it is remapped. A mark that ends up
 * entirely outside the kept area is dropped — it was on the part the user just
 * cut away.
 *
 * Stroke width is scaled by the crop too. A crop to half the width renders the
 * remaining half at the same output size, so a line that stayed at its old
 * fraction would come back half as thick as the user drew it.
 */
export function remapMarksForCrop(marks: Mark[], rect: CropRect): Mark[] {
  const width = Math.max(rect.width, 1e-6)
  const height = Math.max(rect.height, 1e-6)
  // The long edge is what stroke widths are expressed against, and a crop can
  // change which edge that is. Using the average of the two scales keeps a
  // stroke's weight steady through a crop that changes the page's shape.
  const widthScale = (1 / width + 1 / height) / 2

  const remapped: Mark[] = []
  for (const mark of marks) {
    if (mark.kind === 'signature') {
      const box = {
        x: (mark.x - rect.x) / width,
        y: (mark.y - rect.y) / height,
        width: mark.width / width,
        height: mark.height / height,
      }
      if (box.x + box.width <= 0 || box.x >= 1 || box.y + box.height <= 0 || box.y >= 1) continue
      remapped.push({ ...mark, ...box })
      continue
    }

    const points: number[] = []
    for (let i = 0; i < mark.points.length; i += 2) {
      points.push((mark.points[i] - rect.x) / width, (mark.points[i + 1] - rect.y) / height)
    }
    if (!touchesPage(points)) continue
    remapped.push({ ...mark, points, width: mark.width * widthScale })
  }

  return remapped
}

/** Turns marks with the page. Sizes are untouched; a rotation changes nothing about scale. */
export function remapMarksForRotation(marks: Mark[], degrees: Rotation): Mark[] {
  return marks.map((mark) => {
    if (mark.kind === 'signature') {
      // The box has to be rotated as a box: its top-left corner after a
      // quarter turn is the corner that used to be somewhere else entirely,
      // and width and height swap on the quarter turns.
      const swaps = degrees === 90 || degrees === 270
      const size = swaps
        ? { width: mark.height, height: mark.width }
        : { width: mark.width, height: mark.height }
      const corner = rotatePoint(
        degrees === 90
          ? { x: mark.x, y: mark.y + mark.height }
          : degrees === 180
            ? { x: mark.x + mark.width, y: mark.y + mark.height }
            : { x: mark.x + mark.width, y: mark.y },
        degrees,
      )
      return { ...mark, x: corner.x, y: corner.y, ...size }
    }

    const points: number[] = []
    for (let i = 0; i < mark.points.length; i += 2) {
      const turned = rotatePoint({ x: mark.points[i], y: mark.points[i + 1] }, degrees)
      points.push(turned.x, turned.y)
    }
    return { ...mark, points }
  })
}

/** Clockwise rotation of a normalised point inside the unit square. */
function rotatePoint(point: { x: number; y: number }, degrees: Rotation): { x: number; y: number } {
  if (degrees === 90) return { x: 1 - point.y, y: point.x }
  if (degrees === 180) return { x: 1 - point.x, y: 1 - point.y }
  return { x: point.y, y: 1 - point.x }
}

/** True when any part of a stroke still falls on the page. */
function touchesPage(points: number[]): boolean {
  for (let i = 0; i < points.length; i += 2) {
    if (points[i] >= 0 && points[i] <= 1 && points[i + 1] >= 0 && points[i + 1] <= 1) return true
  }
  return false
}

/**
 * Thins out a freshly drawn stroke.
 *
 * A finger dragged across the screen fires a pointer event per frame, so a
 * single flourish arrives as hundreds of points a fraction of a millimetre
 * apart. They land in the index — a JSON file rewritten on every storage
 * operation — and every one of them is redrawn each time the page is
 * re-rendered. Points closer together than `minGap` add nothing a person can
 * see. The first and last are always kept, so a stroke never loses its ends.
 */
export function simplifyStroke(points: number[], minGap = 0.004): number[] {
  if (points.length <= 4) return points

  const kept = [points[0], points[1]]
  for (let i = 2; i < points.length - 2; i += 2) {
    const dx = points[i] - kept[kept.length - 2]
    const dy = points[i + 1] - kept[kept.length - 1]
    if (Math.hypot(dx, dy) >= minGap) kept.push(points[i], points[i + 1])
  }
  kept.push(points[points.length - 2], points[points.length - 1])

  return kept
}

/**
 * Which signature stamp is under a point, latest first.
 *
 * Later stamps are drawn over earlier ones, so the one on top is the one the
 * finger is aiming at. Returns -1 when the point is on bare paper.
 */
export function signatureAt(marks: Mark[], x: number, y: number): number {
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i]
    if (mark.kind !== 'signature') continue
    if (x >= mark.x && x <= mark.x + mark.width && y >= mark.y && y <= mark.y + mark.height) {
      return i
    }
  }
  return -1
}

/** Slides a stamp, never letting it leave the page entirely. */
export function moveSignature(
  mark: SignatureStamp,
  dx: number,
  dy: number,
): SignatureStamp {
  return {
    ...mark,
    x: clampToPage(mark.x + dx, mark.width),
    y: clampToPage(mark.y + dy, mark.height),
  }
}

/**
 * Resizes a stamp from its top-left corner, keeping its proportions.
 *
 * Driven by the width alone: dragging the handle diagonally would otherwise
 * stretch the signature into whatever shape the finger happened to trace, and
 * a stretched signature is a forged-looking one.
 */
export function resizeSignature(mark: SignatureStamp, width: number): SignatureStamp {
  const aspect = mark.width / mark.height
  // Floor last, so a stamp sitting near the right edge cannot be squeezed
  // below the minimum: the page limit is a ceiling, not an override.
  const next = Math.max(MIN_SIGNATURE_WIDTH, Math.min(width, 1 - mark.x))

  // The height is *never* clamped. Capping it at the bottom edge would flatten
  // the signature, and the next resize would read the flattened box back as
  // its aspect ratio and keep it that way — a stamp that gets permanently
  // squashed by being dragged near the foot of the page.
  return { ...mark, width: next, height: next / aspect }
}

/** Below this a signature is a smudge, and its resize handle is unhittable. */
export const MIN_SIGNATURE_WIDTH = 0.08

function clampToPage(value: number, size: number): number {
  // Half of the stamp may hang off the edge — signing across a margin is
  // normal — but never so far that nothing is left to grab hold of.
  return Math.min(1 - size / 2, Math.max(-size / 2, value))
}

/**
 * Where a signature should land when it is first dropped on a page.
 *
 * Bottom right, above the margin — where a signature goes on paper — and
 * scaled from the signature's own aspect ratio so it is never squashed.
 */
export function defaultSignatureBox(
  aspectRatio: number,
  pageAspectRatio: number,
): { x: number; y: number; width: number; height: number } {
  const width = SIGNATURE_DEFAULT_WIDTH
  // `aspectRatio` is width/height in pixels; converting it to a fraction of
  // the page height means dividing through by the page's own aspect ratio.
  const height = (width / aspectRatio) * pageAspectRatio

  return {
    x: 1 - width - 0.08,
    y: Math.max(0.02, 1 - height - 0.1),
    width,
    height,
  }
}
