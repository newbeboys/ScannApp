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
  const bitmap = await decode(blob)
  const longEdge = Math.max(bitmap.width, bitmap.height)
  const scale = longEdge > options.maxEdgePx ? options.maxEdgePx / longEdge : 1

  const [canvas, ctx] = draw(bitmap.width * scale, bitmap.height * scale)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  return toBlob(canvas, options.quality, options.mimeType)
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
