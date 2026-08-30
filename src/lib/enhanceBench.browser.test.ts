import { describe, expect, it } from 'vitest'
import { correctLighting, ENHANCED_EDGE, estimateLightGrid, WORK_EDGE } from './enhance'
import { enhancePage } from './imageEditor'

/**
 * Not a test of behaviour — a measurement, and a gate.
 *
 * Perbaiki Pencahayaan decodes, corrects and re-encodes every page, and Pro has
 * no page limit. Before any progress UI was designed, the brainstorm on 29
 * Agustus 2026 asked for the real number first: measure one 12 MP page in
 * Chromium, multiply by four for a mid-range phone (the baseline device is a
 * Xiaomi T15 flagship — if it feels slow there, mid-range is far worse), and if
 * twenty pages project past about 30 seconds the design changes rather than the
 * UI absorbing it.
 *
 * It did project past it — 35 seconds with the correction loop already
 * optimised — and the design duly changed: the render is now capped at
 * `ENHANCED_EDGE` (Boss Ali, 30 Agustus 2026). What is timed below is therefore
 * a 12 MP page *arriving* and a 4.3 MP page coming back, which is the shape
 * every real page has now.
 *
 * The breakdown still matters as much as the total: the decode is a fixed cost
 * of the page the user actually has, while the estimate and the correction are
 * the parts that scale with the cap.
 *
 * The numbers only reach the terminal with the console forwarded, which the
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

/**
 * Median of several runs, because one is not a measurement.
 *
 * Successive calls on the same page vary by 40% on an idle desktop — GC, the
 * decoder's own caches, whatever else the machine is doing. The gate is read
 * off the median; the spread is printed so a wild run is visible rather than
 * averaged away.
 */
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
const projection = (time: number) => Math.round((time * 4 * 20) / 1000)

describe('enhancePage cost on a 12 MP page', () => {
  it('measures the whole call and each stage inside it', async () => {
    const page = await bigScan(3000, 4000)

    expect(await enhancePage(page)).not.toBeNull()
    const totals = await timeRuns(4, () => enhancePage(page))
    const total = median(totals)

    // The same stages again, timed one by one. The decode asks for the cap the
    // way `decodeCapped` does — one dimension only, aspect left to the browser.
    const t0 = performance.now()
    const bitmap = await createImageBitmap(page, {
      imageOrientation: 'from-image',
      resizeQuality: 'low',
      resizeHeight: ENHANCED_EDGE,
    })
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
    // is a fixed cost of writing the page back to a canvas, and counting it as
    // part of the maths made the loop look more expensive than it is.
    const t3 = performance.now()
    ctx.putImageData(image, 0, 0)
    const putMs = performance.now() - t3

    const t4 = performance.now()
    await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.9))
    const encodeMs = performance.now() - t4

    console.log(
      `[bench] enhancePage 3000x4000 -> ${canvas.width}x${canvas.height} — ` +
        `total ${ms(totals)} median ${Math.round(total)}ms ` +
        `(decode+getImageData ${Math.round(decodeMs)}ms, estimate ${Math.round(estimateMs)}ms, ` +
        `correct ${Math.round(correctMs)}ms, putImageData ${Math.round(putMs)}ms, ` +
        `encode ${Math.round(encodeMs)}ms) — ` +
        `proyeksi 20 halaman di mid-range: ${projection(total)} detik`,
    )

    // Loose ceiling only, so a hang fails instead of stalling CI. The real gate
    // is the projection above, read by a human.
    expect(total).toBeLessThan(30_000)
  })

  /**
   * What is left of the spread now that the output size is fixed.
   *
   * Every page comes back at the cap, so the only thing these three still differ
   * in is how large the file that arrives is — that is, how much the decode
   * costs. A phone camera page and a page already compressed by an earlier
   * export both land in this range.
   */
  it('measures how much the incoming page size still costs', async () => {
    for (const [long, short] of [
      [4000, 3000],
      [3200, 2400],
      [2400, 1800],
    ]) {
      const page = await bigScan(short, long)

      expect(await enhancePage(page)).not.toBeNull()
      const times = await timeRuns(3, () => enhancePage(page))

      console.log(
        `[bench] enhancePage ${short}x${long} — ${ms(times)} median ${Math.round(median(times))}ms — ` +
          `proyeksi 20 halaman di mid-range: ${projection(median(times))} detik`,
      )
    }
  })
})
