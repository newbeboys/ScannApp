import { describe, expect, it } from 'vitest'
import { readJpegSize } from './jpegSize'

/** Two bytes, big-endian, the way every JPEG length and dimension is written. */
function be16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff]
}

/** A segment: marker, its own length, then `payload`. */
function segment(marker: number, payload: number[]): number[] {
  return [0xff, marker, ...be16(payload.length + 2), ...payload]
}

/** The five bytes a frame header carries after its length: precision, h, w. */
function frame(width: number, height: number): number[] {
  return [8, ...be16(height), ...be16(width), 3]
}

function jpeg(...parts: number[][]): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...parts.flat()])
}

describe('readJpegSize', () => {
  it('reads the size out of a baseline frame header', () => {
    expect(readJpegSize(jpeg(segment(0xc0, frame(3000, 4200))))).toEqual({
      width: 3000,
      height: 4200,
    })
  })

  /** Phone cameras write progressive JPEGs; SOF2 has the same header layout. */
  it('reads a progressive frame header too', () => {
    expect(readJpegSize(jpeg(segment(0xc2, frame(4000, 3000))))).toEqual({
      width: 4000,
      height: 3000,
    })
  })

  it('skips the segments in front of the frame header', () => {
    const bytes = jpeg(
      segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]), // JFIF
      segment(0xe1, new Array(600).fill(0x20)), // a big EXIF block
      segment(0xdb, new Array(65).fill(1)), // quantisation table
      segment(0xc0, frame(1024, 768)),
    )

    expect(readJpegSize(bytes)).toEqual({ width: 1024, height: 768 })
  })

  /**
   * C4, C8 and CC sit inside the SOF range but are not frame headers. Reading a
   * size out of a Huffman table would hand back whatever those bytes happen to
   * be — a plausible-looking number that is simply wrong.
   */
  it('does not mistake a Huffman table for a frame header', () => {
    const bytes = jpeg(
      segment(0xc4, [0, 1, 2, 3, 4, 5, 6, 7]),
      segment(0xcc, [9, 9, 9, 9, 9, 9, 9]),
      segment(0xc1, frame(640, 480)),
    )

    expect(readJpegSize(bytes)).toEqual({ width: 640, height: 480 })
  })

  it('tolerates the fill bytes a marker may be padded with', () => {
    const bytes = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xff,
      0xff,
      ...segment(0xc0, frame(200, 100)).slice(1),
    ])

    expect(readJpegSize(bytes)).toEqual({ width: 200, height: 100 })
  })

  it('gives up at the start of scan rather than reading image data as a header', () => {
    expect(readJpegSize(jpeg(segment(0xda, [1, 2, 3]), segment(0xc0, frame(800, 600))))).toBeNull()
  })

  it('returns null for something that is not a JPEG', () => {
    // PNG magic.
    expect(readJpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBeNull()
  })

  it('returns null for a header that was cut off mid-segment', () => {
    expect(readJpegSize(jpeg(segment(0xc0, frame(3000, 4200)).slice(0, 6)))).toBeNull()
  })

  /** A length under two would send the scan backwards and loop forever. */
  it('returns null rather than looping on a malformed length', () => {
    expect(readJpegSize(jpeg([0xff, 0xe0, 0x00, 0x00, 1, 2, 3]))).toBeNull()
  })

  it('returns null for a frame header claiming zero pixels', () => {
    expect(readJpegSize(jpeg(segment(0xc0, frame(0, 400))))).toBeNull()
  })
})
