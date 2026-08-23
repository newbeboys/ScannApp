import { describe, expect, it } from 'vitest'
import { applyFilter, luminance, whitePoint } from './filters'

/** Builds an RGBA buffer from a list of [r,g,b] triples. */
function pixels(...rgb: [number, number, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(rgb.length * 4)
  rgb.forEach(([r, g, b], i) => {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  })
  return data
}

/** The pixel at `index` as [r,g,b]. */
function at(data: Uint8ClampedArray, index: number): [number, number, number] {
  return [data[index * 4], data[index * 4 + 1], data[index * 4 + 2]]
}

/** A grey page with a darker patch in the middle — a stand-in for ink on paper. */
function page(width: number, height: number, paper: number, ink: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const middle = x > width / 3 && x < (width * 2) / 3 && y > height / 3 && y < (height * 2) / 3
      const value = middle ? ink : paper
      const i = (y * width + x) * 4
      data[i] = value
      data[i + 1] = value
      data[i + 2] = value
      data[i + 3] = 255
    }
  }
  return data
}

describe('luminance', () => {
  it('weighs green more heavily than blue, like the human eye', () => {
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(0, 0, 255))
  })

  it('returns the same value for a grey pixel', () => {
    expect(Math.round(luminance(128, 128, 128))).toBe(128)
  })
})

describe('whitePoint', () => {
  /**
   * Why a percentile rather than the maximum: one blown-out highlight — a
   * reflection off a staple, a window caught in frame — would otherwise define
   * "white" for the whole page and leave the actual paper looking grey.
   */
  it('ignores one glare spot far brighter than the paper around it', () => {
    const data = pixels(
      ...(Array.from({ length: 99 }, () => [200, 200, 200]) as [number, number, number][]),
      [255, 255, 255],
    )

    expect(whitePoint(data)).toBeLessThan(255)
  })

  it('never returns zero, so nothing downstream divides by it', () => {
    expect(whitePoint(pixels([0, 0, 0], [0, 0, 0]))).toBeGreaterThan(0)
  })
})

describe('applyFilter — magic', () => {
  it('lifts grey paper up to white', () => {
    const data = pixels(...(Array.from({ length: 20 }, () => [190, 190, 190]) as [number, number, number][]))
    applyFilter('magic', data, 20, 1)

    expect(at(data, 0)[0]).toBeGreaterThan(240)
  })

  it('keeps colour rather than turning it grey', () => {
    const data = pixels([200, 120, 120], [200, 200, 200])
    applyFilter('magic', data, 2, 1)

    const [r, g] = at(data, 0)
    expect(r).toBeGreaterThan(g)
  })
})

describe('applyFilter — bright', () => {
  it('lifts dark shadows', () => {
    const data = pixels([40, 40, 40])
    applyFilter('bright', data, 1, 1)

    expect(at(data, 0)[0]).toBeGreaterThan(40)
  })

  /** A gamma curve, not a flat add: what is already white cannot go any higher. */
  it('leaves white as white, without clipping past it', () => {
    const data = pixels([255, 255, 255])
    applyFilter('bright', data, 1, 1)

    expect(at(data, 0)).toEqual([255, 255, 255])
  })

  it('never reverses the light-to-dark order', () => {
    const data = pixels([30, 30, 30], [150, 150, 150])
    applyFilter('bright', data, 2, 1)

    expect(at(data, 0)[0]).toBeLessThan(at(data, 1)[0])
  })
})

describe('applyFilter — grayscale', () => {
  it('equalises the three channels', () => {
    const data = pixels([200, 100, 50])
    applyFilter('grayscale', data, 1, 1)

    const [r, g, b] = at(data, 0)
    expect(r).toBe(g)
    expect(g).toBe(b)
  })

  it('keeps gradation rather than forcing pure black or white', () => {
    const data = pixels([60, 60, 60], [200, 200, 200])
    applyFilter('grayscale', data, 2, 1)

    expect(at(data, 0)[0]).toBeGreaterThan(0)
    expect(at(data, 1)[0]).toBeLessThan(255)
  })
})

describe('applyFilter — ink-saver', () => {
  it('forces the background to clean white so a printer lays down no ink there', () => {
    const data = page(20, 20, 205, 40)
    applyFilter('ink-saver', data, 20, 20)

    // The corner pixel is background.
    expect(at(data, 0)).toEqual([255, 255, 255])
  })

  it('thins the ink without erasing it entirely', () => {
    const data = page(20, 20, 205, 40)
    applyFilter('ink-saver', data, 20, 20)

    const middle = 10 * 20 + 10
    const value = at(data, middle)[0]
    expect(value).toBeGreaterThan(0)
    expect(value).toBeLessThan(200)
  })
})

describe('applyFilter — bw', () => {
  it('produces only black or white', () => {
    const data = page(24, 24, 200, 60)
    applyFilter('bw', data, 24, 24)

    for (let i = 0; i < 24 * 24; i++) {
      expect([0, 255]).toContain(at(data, i)[0])
    }
  })

  it('turns ink black and paper white', () => {
    const data = page(24, 24, 210, 50)
    applyFilter('bw', data, 24, 24)

    expect(at(data, 0)[0]).toBe(255)
    expect(at(data, 12 * 24 + 12)[0]).toBe(0)
  })

  /**
   * Why the threshold is local rather than global. This page is lit unevenly —
   * bright on one side, shadowed on the other — so the paper on the dark side
   * is darker than the ink on the bright side. No single global cut-off can
   * serve both; that mismatch is exactly what turns a photographed document
   * into a black smear under uneven light.
   */
  it('does not blacken the shadowed side of the page', () => {
    const width = 40
    const height = 20
    const data = new Uint8ClampedArray(width * height * 4)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const lit = x < width / 2
        const paper = lit ? 230 : 90
        const ink = lit ? 150 : 25
        // One vertical ink stroke on each side.
        const isInk = x === 10 || x === 30
        const value = isInk ? ink : paper

        const i = (y * width + x) * 4
        data[i] = value
        data[i + 1] = value
        data[i + 2] = value
        data[i + 3] = 255
      }
    }

    applyFilter('bw', data, width, height)

    const pixelAt = (x: number, y: number) => at(data, y * width + x)[0]

    // Paper stays white on both sides, including the shadowed one.
    expect(pixelAt(2, 10)).toBe(255)
    expect(pixelAt(38, 10)).toBe(255)
    // Ink stays black on both sides.
    expect(pixelAt(10, 10)).toBe(0)
    expect(pixelAt(30, 10)).toBe(0)
  })

  it('leaves a blank page clean, without speckling', () => {
    const data = page(24, 24, 235, 235)
    applyFilter('bw', data, 24, 24)

    for (let i = 0; i < 24 * 24; i++) {
      expect(at(data, i)[0]).toBe(255)
    }
  })
})

describe('applyFilter — every filter', () => {
  it('never touches the alpha channel', () => {
    for (const filter of ['magic', 'bright', 'grayscale', 'bw', 'ink-saver'] as const) {
      const data = page(8, 8, 200, 60)
      applyFilter(filter, data, 8, 8)

      for (let i = 3; i < data.length; i += 4) {
        expect(data[i]).toBe(255)
      }
    }
  })
})
