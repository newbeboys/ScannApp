import { HIGHLIGHTER_ALPHA, strokeWidth, type Mark } from './annotations'
import { applyFilter } from './filters'
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

/** Decodes a page and redraws it no larger than `maxEdgePx` on its long side. */
async function scaledCanvas(blob: Blob, maxEdgePx: number): Promise<HTMLCanvasElement> {
  const bitmap = await decode(blob)
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
 * Encoded at a higher quality than an ordinary edit: a filtered page is what
 * the export and the backup are built from, and JPEG artefacts around
 * thresholded text compound badly through a second encode.
 */
export async function filterImage(blob: Blob, filter: DocumentFilter): Promise<Blob> {
  const bitmap = await decode(blob)
  const [canvas, ctx] = draw(bitmap.width, bitmap.height)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  applyFilter(filter, image.data, canvas.width, canvas.height)
  ctx.putImageData(image, 0, 0)

  return toBlob(canvas, 0.95)
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
 * file is what the export and the cloud backup are built from.
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

  return toBlob(canvas, 0.95)
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
