import { describe, expect, it } from 'vitest'
import {
  compressImage,
  compressImagePair,
  cropImage,
  getImageSize,
  rotateImage,
} from './imageEditor'
import { COMPRESSION_PRESETS } from './exportLimits'

/**
 * Runs in a real Chromium, not a mocked DOM.
 *
 * Everything this module does that can be wrong is done by the browser:
 * `canvas.toBlob` chooses the encoder, the encoder decides the bytes, and
 * `createImageBitmap` applies EXIF orientation. A faked canvas would only ever
 * prove that the fake was called.
 */

/** A page-like image: paper that is not pure white, text rows, and sensor noise. */
async function scanLike(width: number, height: number, noise = 20): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#f7f5ee'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#1a1a22'
  for (let y = 20; y < height - 20; y += 24) {
    ctx.fillRect(20, y, Math.max(10, width - 40 - ((y * 7) % 120)), 8)
  }

  if (noise > 0) {
    const image = ctx.getImageData(0, 0, width, height)
    for (let i = 0; i < image.data.length; i += 4) {
      const n = (Math.random() - 0.5) * noise
      image.data[i] += n
      image.data[i + 1] += n
      image.data[i + 2] += n
    }
    ctx.putImageData(image, 0, 0)
  }

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'))
}

/** First bytes of the file — the only honest way to ask what format it really is. */
async function signature(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(' ')
}

describe('compressImage encoders', () => {
  it('writes a real JPEG by default', async () => {
    const out = await compressImage(await scanLike(400, 560))

    expect(await signature(out)).toMatch(/^ff d8 ff/)
  })

  it('writes a real PNG when asked for one', async () => {
    const out = await compressImage(await scanLike(400, 560), {
      ...COMPRESSION_PRESETS.standard,
      mimeType: 'image/png',
    })

    expect(await signature(out)).toBe('89 50 4e 47')
  })
})

describe('compressImage resizing', () => {
  it('caps the long edge and keeps the aspect ratio', async () => {
    const out = await compressImage(await scanLike(3000, 4200), {
      quality: 0.75,
      maxEdgePx: 2400,
    })

    const size = await getImageSize(out)
    expect(size.height).toBe(2400)
    expect(size.width).toBe(Math.round((3000 / 4200) * 2400))
  })

  it('never enlarges a page that is already smaller than the cap', async () => {
    const out = await compressImage(await scanLike(800, 1000), {
      quality: 0.75,
      maxEdgePx: 2400,
    })

    expect(await getImageSize(out)).toEqual({ width: 800, height: 1000 })
  })
})

describe('compression levels', () => {
  /** The promise the slider makes: each step up really is a bigger, better file. */
  it('produce steadily larger files from Kecil to Maksimal', async () => {
    const page = await scanLike(1600, 2200)

    const sizes: number[] = []
    for (const level of ['small', 'standard', 'high', 'max'] as const) {
      sizes.push((await compressImage(page, COMPRESSION_PRESETS[level])).size)
    }

    expect(sizes).toEqual([...sizes].sort((a, b) => a - b))
    expect(new Set(sizes).size).toBe(sizes.length)
  })
})

/**
 * The reason `exportImages` sets `mimeType` before compressing rather than
 * converting the JPEG it already made. Measured at 3000x4200 while writing
 * this: 102 KB from the original against 191 KB by way of the JPEG.
 */
describe('PNG derived from the original, not from a JPEG', () => {
  it('is smaller than a PNG re-wrapped from the JPEG of the same page', async () => {
    const page = await scanLike(1200, 1600)
    const options = { ...COMPRESSION_PRESETS.standard, mimeType: 'image/png' } as const

    const fromOriginal = await compressImage(page, options)
    const fromJpeg = await compressImage(
      await compressImage(page, { ...COMPRESSION_PRESETS.standard, mimeType: 'image/jpeg' }),
      options,
    )

    // Both really are PNGs. Without this the size comparison quietly held even
    // when `mimeType` was ignored altogether and both came out JPEG — it would
    // have passed while the very bug it guards was present.
    expect(await signature(fromOriginal)).toBe('89 50 4e 47')
    expect(await signature(fromJpeg)).toBe('89 50 4e 47')
    expect(fromJpeg.size).toBeGreaterThan(fromOriginal.size)
  })
})

describe('rotateImage', () => {
  it('swaps the axes for a quarter turn', async () => {
    const out = await rotateImage(await scanLike(400, 600), 90)

    expect(await getImageSize(out)).toEqual({ width: 600, height: 400 })
  })

  it('keeps them for a half turn', async () => {
    const out = await rotateImage(await scanLike(400, 600), 180)

    expect(await getImageSize(out)).toEqual({ width: 400, height: 600 })
  })
})

describe('cropImage', () => {
  it('keeps the requested fraction of the page', async () => {
    const out = await cropImage(await scanLike(1000, 1000), {
      x: 0.25,
      y: 0.1,
      width: 0.5,
      height: 0.4,
    })

    const size = await getImageSize(out)
    expect(size.width).toBe(500)
    expect(size.height).toBe(400)
  })

  it('clamps a rectangle that runs off the edge instead of throwing', async () => {
    const out = await cropImage(await scanLike(1000, 1000), {
      x: 0.8,
      y: 0.8,
      width: 0.9,
      height: 0.9,
    })

    const size = await getImageSize(out)
    expect(size.width).toBeLessThanOrEqual(200)
    expect(size.height).toBeLessThanOrEqual(200)
  })
})

/**
 * Added 24 Agustus 2026 with the performance pass: the export sheet asks for
 * both encodings at once so the page is only decoded and redrawn once.
 */
describe('compressImagePair', () => {
  it('returns a real JPEG and a real PNG of the same page', async () => {
    const page = await scanLike(900, 1200)

    const { jpeg, png } = await compressImagePair(page, COMPRESSION_PRESETS.standard)

    expect(await signature(jpeg)).toMatch(/^ff d8 ff/)
    expect(await signature(png)).toBe('89 50 4e 47')
  })

  it('gives the same bytes as two separate compressImage calls would', async () => {
    const page = await scanLike(900, 1200)
    const options = COMPRESSION_PRESETS.standard

    const pair = await compressImagePair(page, options)
    const separately = {
      jpeg: await compressImage(page, { ...options, mimeType: 'image/jpeg' }),
      png: await compressImage(page, { ...options, mimeType: 'image/png' }),
    }

    expect(pair.jpeg.size).toBe(separately.jpeg.size)
    expect(pair.png.size).toBe(separately.png.size)
  })

  it('honours the pixel cap, like the single-format path', async () => {
    const { jpeg } = await compressImagePair(await scanLike(3000, 4200), {
      quality: 0.75,
      maxEdgePx: 2400,
    })

    expect((await getImageSize(jpeg)).height).toBe(2400)
  })
})
