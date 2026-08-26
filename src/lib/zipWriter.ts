/**
 * A minimal ZIP writer, enough for the OPC container a .docx is.
 *
 * Every entry is STORE — no compression. A text-only Word document is tens of
 * kilobytes, so deflate would save less than the cost of pulling in a zip
 * library (the `docx` package brings jszip) or hand-writing a deflate encoder,
 * and stored entries are fully valid OPC: Word opens them.
 *
 * Deliberately unsupported, because nothing here needs it: zip64 (entries are
 * kilobytes), data descriptors (sizes are known before writing), directory
 * entries, and non-ASCII names.
 */

export interface ZipEntry {
  /** Forward-slash path inside the archive. ASCII only. */
  name: string
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * MS-DOS date and time, which is what a ZIP header carries.
 *
 * Two-second resolution and a 1980 epoch, both inherited from the format.
 * A date before 1980 cannot be represented and is clamped rather than wrapped
 * into a nonsense year.
 *
 * Read in UTC, not local time. The format carries no zone of its own, so a
 * local reading would stamp the same document differently depending on where
 * the phone is — which undoes the reason the timestamp comes from the document
 * instead of the clock, and can land a different day here than the ISO string
 * that goes into `dcterms:created`.
 */
function dosDateTime(when: Date): { date: number; time: number } {
  const year = Math.max(when.getUTCFullYear() - 1980, 0)
  return {
    date: (year << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate(),
    time: (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1),
  }
}

/** Grows into a plain byte array; every field a ZIP has is little-endian. */
class ByteWriter {
  private bytes: number[] = []

  get length(): number {
    return this.bytes.length
  }

  u16(value: number): void {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff)
  }

  u32(value: number): void {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
  }

  raw(values: Uint8Array): void {
    for (const value of values) this.bytes.push(value)
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}

function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    // Anything above ASCII would need the UTF-8 name flag and a matching
    // encoding; nothing this writer packages has such a name, so refusing is
    // honest where writing mojibake would not be.
    if (code > 0x7f) throw new Error(`Nama berkas di dalam arsip harus ASCII: ${text}`)
    bytes[index] = code
  }
  return bytes
}

/**
 * Packs entries into a ZIP archive.
 *
 * `modified` comes from the document rather than the clock, which is what
 * makes the output deterministic: the same document packed twice produces the
 * same bytes, so everything downstream can be compared exactly.
 */
export function buildZip(entries: readonly ZipEntry[], modified: Date): Uint8Array {
  const { date, time } = dosDateTime(modified)
  const out = new ByteWriter()
  const placed: { name: Uint8Array; crc: number; size: number; offset: number }[] = []

  for (const entry of entries) {
    const name = asciiBytes(entry.name)
    const crc = crc32(entry.data)
    placed.push({ name, crc, size: entry.data.length, offset: out.length })

    out.u32(0x04034b50)
    out.u16(20) // version needed: 2.0, which is what STORE requires
    out.u16(0) // no flags: no encryption, no data descriptor, no UTF-8 names
    out.u16(0) // method 0 = stored
    out.u16(time)
    out.u16(date)
    out.u32(crc)
    out.u32(entry.data.length) // compressed size — the same, since nothing is compressed
    out.u32(entry.data.length)
    out.u16(name.length)
    out.u16(0) // no extra field
    out.raw(name)
    out.raw(entry.data)
  }

  const centralStart = out.length
  for (const entry of placed) {
    out.u32(0x02014b50)
    out.u16(20) // version made by
    out.u16(20) // version needed
    out.u16(0)
    out.u16(0)
    out.u16(time)
    out.u16(date)
    out.u32(entry.crc)
    out.u32(entry.size)
    out.u32(entry.size)
    out.u16(entry.name.length)
    out.u16(0) // extra field
    out.u16(0) // comment
    out.u16(0) // disk number
    out.u16(0) // internal attributes
    out.u32(0) // external attributes
    out.u32(entry.offset)
    out.raw(entry.name)
  }

  // Taken before the record below is written, or the record's own bytes would
  // be counted as part of the directory they describe.
  const centralSize = out.length - centralStart

  out.u32(0x06054b50)
  out.u16(0) // this disk
  out.u16(0) // disk with the central directory
  out.u16(placed.length)
  out.u16(placed.length)
  out.u32(centralSize)
  out.u32(centralStart)
  out.u16(0) // no archive comment

  return out.toUint8Array()
}
