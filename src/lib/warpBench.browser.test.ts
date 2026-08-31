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
