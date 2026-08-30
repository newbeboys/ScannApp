import { describe, expect, it } from 'vitest'
import { buildZip } from './zipWriter'

/**
 * CRC-32 computed bit by bit, without a lookup table.
 *
 * Deliberately a different implementation from the one under test: a table
 * copied from the same source as the production one would agree with it even
 * if both were wrong.
 */
function crc32Slow(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

const u16 = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8)
const u32 = (bytes: Uint8Array, at: number) =>
  (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0

const ascii = (text: string) => new TextEncoder().encode(text)

/** Where the end-of-central-directory record starts. No comment, so it is the last 22 bytes. */
const eocdAt = (zip: Uint8Array) => zip.length - 22

const MODIFIED = new Date('2026-08-25T14:30:24.000Z')

const entries = [
  { name: '[Content_Types].xml', data: ascii('<Types/>') },
  { name: 'word/document.xml', data: ascii('<document>Halo</document>') },
]

describe('buildZip', () => {
  it('opens with a local file header', () => {
    const zip = buildZip(entries, MODIFIED)

    expect(Array.from(zip.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  it('closes with an end-of-central-directory record naming every entry', () => {
    const zip = buildZip(entries, MODIFIED)
    const eocd = eocdAt(zip)

    expect(u32(zip, eocd)).toBe(0x06054b50)
    expect(u16(zip, eocd + 8)).toBe(2)
    expect(u16(zip, eocd + 10)).toBe(2)
  })

  /**
   * STORE, not deflate. A text-only DOCX is tens of kilobytes, so compressing
   * it would save less than the cost of a dependency or a hand-written
   * deflate — and stored entries are fully valid OPC.
   */
  it('stores each entry uncompressed, byte for byte', () => {
    const zip = buildZip(entries, MODIFIED)

    expect(u16(zip, 8)).toBe(0)
    expect(u32(zip, 18)).toBe(u32(zip, 22))

    const body = new TextDecoder().decode(zip)
    expect(body).toContain('<document>Halo</document>')
  })

  /**
   * The one field a reader will actually reject the file over. Checked against
   * an independent implementation rather than a golden number, so a wrong
   * table in production cannot be baked into the expectation.
   */
  it('writes a CRC-32 that matches the bytes it stored', () => {
    const zip = buildZip([entries[0]], MODIFIED)

    expect(u32(zip, 14)).toBe(crc32Slow(entries[0].data))
  })

  it('points every central directory record at a real local header', () => {
    const zip = buildZip(entries, MODIFIED)
    const eocd = eocdAt(zip)
    let at = u32(zip, eocd + 16)

    for (let index = 0; index < 2; index++) {
      expect(u32(zip, at)).toBe(0x02014b50)
      const localAt = u32(zip, at + 42)
      expect(u32(zip, localAt)).toBe(0x04034b50)
      at += 46 + u16(zip, at + 28) + u16(zip, at + 30) + u16(zip, at + 32)
    }

    // The walk must land exactly on the record it started before.
    expect(at).toBe(eocd)
  })

  it('records the size of the central directory it wrote', () => {
    const zip = buildZip(entries, MODIFIED)
    const eocd = eocdAt(zip)

    expect(u32(zip, eocd + 16) + u32(zip, eocd + 12)).toBe(eocd)
  })

  /**
   * Taking the timestamp from the document rather than the clock is what makes
   * the output comparable at all — otherwise every build of the same document
   * differs and nothing downstream can be tested byte for byte.
   */
  it('produces identical bytes for identical input', () => {
    expect(buildZip(entries, MODIFIED)).toEqual(buildZip(entries, MODIFIED))
  })

  /**
   * The fields are spelled out as the literal UTC parts of MODIFIED rather than
   * read back with `getMonth`/`getHours`, which would mirror whatever the code
   * does and agree with it on any machine. Written out, a local-time reading
   * fails everywhere except UTC — and that is the bug worth catching, since it
   * would make the same document stamp differently on a phone in Jakarta.
   */
  it('writes the given time in UTC, not the time of the build', () => {
    const zip = buildZip(entries, MODIFIED)
    const date = u16(zip, 12)
    const time = u16(zip, 10)

    // DOS date: year since 1980 in the top 7 bits, then month, then day.
    expect(date >> 9).toBe(2026 - 1980)
    expect((date >> 5) & 0xf).toBe(8)
    expect(date & 0x1f).toBe(25)
    // DOS time: hour, minute, then seconds halved — 14:30:24 UTC.
    expect(time >> 11).toBe(14)
    expect((time >> 5) & 0x3f).toBe(30)
    expect(time & 0x1f).toBe(12)
  })

  it('refuses a name it cannot store as plain bytes', () => {
    expect(() => buildZip([{ name: 'word/dokumén.xml', data: ascii('x') }], MODIFIED)).toThrow()
  })
})
