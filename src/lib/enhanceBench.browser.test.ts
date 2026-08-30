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
 *
 * The number only reaches the terminal with the console forwarded, which the
 * default reporter swallows for a passing test:
 *
 *   npx vitest run --project browser enhanceBench --reporter=verbose --silent=false
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
    const correctMs = performance.now() - t2

    // Timed apart from the correction it used to be lumped in with: putImageData
    // is a fixed cost of writing 12 MP back to a canvas, and counting it as part
    // of the maths made the loop look more expensive than it is.
    const t3 = performance.now()
    ctx.putImageData(image, 0, 0)
    const putMs = performance.now() - t3

    const t4 = performance.now()
    await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.9))
    const encodeMs = performance.now() - t4

    console.log(
      `[bench] enhancePage 3000x4000 — total ${Math.round(total)}ms ` +
        `(decode+getImageData ${Math.round(decodeMs)}ms, estimate ${Math.round(estimateMs)}ms, ` +
        `correct ${Math.round(correctMs)}ms, putImageData ${Math.round(putMs)}ms, ` +
        `encode ${Math.round(encodeMs)}ms) — ` +
        `proyeksi 20 halaman di mid-range: ${Math.round((total * 4 * 20) / 1000)} detik`,
    )

    // Loose ceiling only, so a hang fails instead of stalling CI. The real gate
    // is the projection above, read by a human.
    expect(total).toBeLessThan(30_000)
  })
})
