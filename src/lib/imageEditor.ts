import { HIGHLIGHTER_ALPHA, strokeWidth, type Mark } from './annotations'
import { applyFilter } from './filters'
import { readJpegSize } from './jpegSize'
import type { DocumentFilter } from './scanIndexMigration'
import { BASIC_COMPRESSION, type CompressOptions } from './exportLimits'

/** Crop area expressed as fractions of the source image (0..1), so it survives resizing. */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export type Rotation = 90 | 180 | 270

const JPEG = 'image/jpeg'

/**
 * Quality for the files this module derives from a page — the filter render and
 * the ink render.
 *
 * Higher than an ordinary edit because these are what the export and the cloud
 * backup are built from, and JPEG artefacts around thresholded text compound
 * badly through a second encode. Lower than the 0.95 it used to be: the file
 * that comes out has to be base64-encoded, carried across the Capacitor bridge
 * and written by Java, then read and decoded again to put it back on screen, so
 * its size is paid for four times over on a phone. Measured in Chromium on a
 * 3000x4200 scan-like page: 5.76 MB at 0.95 against 3.96 MB at 0.90 — 31% fewer
 * bytes for a difference that does not survive being printed. Saving an
 * annotated 12 MP page was the slowest thing in the editor (dilaporkan dari HP,
 * 25 Agustus 2026).
 *
 * Technical, not a business number — see CLAUDE.md Bagian 6 on the compression
 * presets; free to retune without asking.
 */
const DERIVED_QUALITY = 0.9

/**
 * How much of a file to read when only its header is wanted.
 *
 * The frame header sits within the first few hundred bytes of an ordinary JPEG,
 * but a page carrying a large EXIF thumbnail can push it further back; 64 KB
 * clears every scan this app produces while still being a slice, not a read.
 */
const HEADER_BYTES = 65_536

/**
 * `from-image` makes the browser apply EXIF orientation while decoding, so
 * every downstream canvas operation works on an already-upright bitmap.
 */
async function decode(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: 'from-image' })
}

function draw(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas tidak tersedia di perangkat ini.')
  ctx.imageSmoothingQuality = 'high'
  return [canvas, ctx]
}

function toBlob(
  canvas: HTMLCanvasElement,
  quality: number,
  mimeType: string = JPEG,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Gagal mengubah gambar.'))),
      mimeType,
      // Ignored by the PNG encoder, which is lossless — harmless to pass.
      quality,
    )
  })
}

export async function rotateImage(blob: Blob, degrees: Rotation): Promise<Blob> {
  const bitmap = await decode(blob)
  const swapsAxes = degrees === 90 || degrees === 270
  const [canvas, ctx] = draw(
    swapsAxes ? bitmap.height : bitmap.width,
    swapsAxes ? bitmap.width : bitmap.height,
  )

  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  bitmap.close()

  return toBlob(canvas, 0.92)
}

export async function cropImage(blob: Blob, rect: CropRect): Promise<Blob> {
  const bitmap = await decode(blob)

  const sx = clamp(rect.x, 0, 1) * bitmap.width
  const sy = clamp(rect.y, 0, 1) * bitmap.height
  const sWidth = clamp(rect.width, 0.01, 1 - clamp(rect.x, 0, 1)) * bitmap.width
  const sHeight = clamp(rect.height, 0.01, 1 - clamp(rect.y, 0, 1)) * bitmap.height

  const [canvas, ctx] = draw(sWidth, sHeight)
  ctx.drawImage(bitmap, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  return toBlob(canvas, 0.92)
}

/**
 * Caps the long edge and re-encodes the page for export.
 *
 * Basic always arrives here with the standard preset; Pro can arrive with any
 * of the four levels (`COMPRESSION_PRESETS`). `mimeType` picks the encoder —
 * PNG exports run this same resize and then encode losslessly.
 */
export async function compressImage(
  blob: Blob,
  options: CompressOptions = BASIC_COMPRESSION,
): Promise<Blob> {
  return toBlob(await scaledCanvas(blob, options.maxEdgePx), options.quality, options.mimeType)
}

/**
 * Both encodings of one page from a single decode.
 *
 * The export sheet needs a JPEG figure and a PNG figure side by side. Calling
 * `compressImage` twice decodes and redraws the page twice for pixels that are
 * identical either way — about 270ms of waste per estimate on a 12MP scan in
 * desktop Chromium, and a good deal more on a phone (diukur 24 Agustus 2026).
 */
export async function compressImagePair(
  blob: Blob,
  options: CompressOptions,
): Promise<{ jpeg: Blob; png: Blob }> {
  const canvas = await scaledCanvas(blob, options.maxEdgePx)

  return {
    jpeg: await toBlob(canvas, options.quality, JPEG),
    png: await toBlob(canvas, options.quality, 'image/png'),
  }
}

/**
 * Decodes a page, asking the decoder to shrink it on the way out where it can.
 *
 * `createImageBitmap` can resize during decode, which is far cheaper than
 * decoding a 12 MP scan in full and throwing three quarters of it away on a
 * canvas a moment later — that full decode is the bulk of what an export spends
 * per page, and a ten-document batch pays it ten times (dilaporkan dari HP,
 * 25 Agustus 2026).
 *
 * Only *one* dimension is ever requested, and the aspect ratio is left to the
 * browser. Passing both would silently distort a page tagged with an EXIF
 * rotation: `imageOrientation: 'from-image'` swaps its axes while the size read
 * from the header does not, so the two would disagree about which number is the
 * width. With one dimension the worst that rotation can do is cap the short edge
 * instead of the long one — the result is still smaller than the original, still
 * correctly shaped, and `scaledCanvas` finishes the job from there.
 */
async function decodeCapped(blob: Blob, maxEdgePx: number): Promise<ImageBitmap> {
  let stored: { width: number; height: number } | null = null
  try {
    stored = readJpegSize(new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer()))
  } catch {
    // Unreadable header — a PNG, or a slice that failed. Plain decode below.
  }

  if (!stored || Math.max(stored.width, stored.height) <= maxEdgePx) return decode(blob)

  try {
    return await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      resizeQuality: 'high',
      ...(stored.width >= stored.height
        ? { resizeWidth: maxEdgePx }
        : { resizeHeight: maxEdgePx }),
    })
  } catch {
    // Older WebViews ignore or reject the resize options rather than falling
    // back themselves. A full decode is slower, not wrong.
    return decode(blob)
  }
}

/**
 * Decodes a page and redraws it no larger than `maxEdgePx` on its long side.
 *
 * The scale below is still computed from the bitmap that came back, not from
 * the size asked for: `decodeCapped` is allowed to hand back something larger
 * than the cap when EXIF rotation got in the way, and this is what finishes it.
 */
async function scaledCanvas(blob: Blob, maxEdgePx: number): Promise<HTMLCanvasElement> {
  const bitmap = await decodeCapped(blob, maxEdgePx)
  const longEdge = Math.max(bitmap.width, bitmap.height)
  const scale = longEdge > maxEdgePx ? maxEdgePx / longEdge : 1

  const [canvas, ctx] = draw(bitmap.width * scale, bitmap.height * scale)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  return canvas
}

/**
 * Renders one of the document filters onto a page.
 *
 * Only the canvas work lives here — the pixel maths is in `filters.ts`, kept
 * free of the DOM so it can be tested against known pixels under Node.
 *
 * Encoded at a higher quality than an ordinary edit — see `DERIVED_QUALITY`.
 */
export async function filterImage(blob: Blob, filter: DocumentFilter): Promise<Blob> {
  const bitmap = await decode(blob)
  const [canvas, ctx] = draw(bitmap.width, bitmap.height)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  applyFilter(filter, image.data, canvas.width, canvas.height)
  ctx.putImageData(image, 0, 0)

  return toBlob(canvas, DERIVED_QUALITY)
}

/**
 * Draws the user's ink and signatures onto a page.
 *
 * Marks are stored as data, not baked into the page (design doc Bagian 2.1),
 * so this runs again from scratch every time the page underneath is re-derived
 * — after a crop, after a filter change. Nothing here reads the previous
 * render, which is what keeps ink from compounding.
 *
 * Signature bitmaps are handed in already decoded, keyed by the path the mark
 * refers to: the same signature is usually stamped on several pages, and this
 * module has no way to read a file.
 *
 * Encoded at the same quality as `filterImage`, and for the same reason: this
 * file is what the export and the cloud backup are built from — see
 * `DERIVED_QUALITY`.
 */
export async function renderMarks(
  blob: Blob,
  marks: Mark[],
  signatures: Map<string, ImageBitmap>,
): Promise<Blob> {
  const bitmap = await decode(blob)
  const [canvas, ctx] = draw(bitmap.width, bitmap.height)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  // Widths are fractions of the long edge, so a stroke keeps its weight
  // whether the page is portrait or landscape.
  const longEdge = Math.max(canvas.width, canvas.height)

  for (const mark of marks) {
    if (mark.kind === 'signature') {
      const signature = signatures.get(mark.source)
      if (!signature) continue
      ctx.drawImage(
        signature,
        mark.x * canvas.width,
        mark.y * canvas.height,
        mark.width * canvas.width,
        mark.height * canvas.height,
      )
      continue
    }

    ctx.save()
    ctx.strokeStyle = mark.color
    ctx.lineWidth = Math.max(1, strokeWidth(mark) * longEdge)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (mark.tool === 'highlighter') {
      // `multiply` rather than plain alpha: overlapping passes of a real
      // highlighter darken the ink, they do not paint over it, and text under
      // a plain translucent layer washes out instead of showing through.
      ctx.globalAlpha = HIGHLIGHTER_ALPHA
      ctx.globalCompositeOperation = 'multiply'
    }

    ctx.beginPath()
    ctx.moveTo(mark.points[0] * canvas.width, mark.points[1] * canvas.height)
    for (let i = 2; i < mark.points.length; i += 2) {
      ctx.lineTo(mark.points[i] * canvas.width, mark.points[i + 1] * canvas.height)
    }
    ctx.stroke()
    ctx.restore()
  }

  return toBlob(canvas, DERIVED_QUALITY)
}

/** Natural pixel size of an image, used by the crop overlay to keep its aspect ratio honest. */
export async function getImageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await decode(blob)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
