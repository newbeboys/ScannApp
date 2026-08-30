export interface ImageSize {
  width: number
  height: number
}

/**
 * Markers that carry a frame header, and therefore the image's size.
 *
 * SOF0..SOF15 minus the three that share the range but mean something else:
 * C4 is the Huffman table, C8 is reserved, CC is the arithmetic coding table.
 * Reading a size out of any of those would be reading the wrong bytes.
 */
function isFrameHeader(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

/**
 * Reads a JPEG's pixel size out of its header, without decoding it.
 *
 * Exists so an export can ask the *decoder* to shrink the page on its way out
 * of the file rather than decoding a 12 MP scan in full and throwing three
 * quarters of it away on a canvas immediately afterwards — see `scaledCanvas`.
 * Knowing the size in advance is the whole precondition for that, and the
 * header is a few hundred bytes against the several megabytes of the image.
 *
 * Returns null for anything it cannot read with certainty — a PNG, a truncated
 * file, a marker layout it does not recognise. The caller falls back to a plain
 * decode, so being unsure is cheap and being wrong would not be.
 *
 * EXIF orientation is deliberately *not* read here. The size returned is the
 * size as stored, which is not always the size as displayed: a page tagged
 * "rotate 90" decodes with its axes swapped. `scaledCanvas` handles that by
 * only ever asking for one dimension and re-checking the result.
 */
export function readJpegSize(bytes: Uint8Array): ImageSize | null {
  // SOI. Anything else is not a JPEG at all.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  let at = 2
  while (at + 3 < bytes.length) {
    // Segments may be padded with any number of 0xff bytes before the marker.
    if (bytes[at] !== 0xff) return null
    while (at < bytes.length && bytes[at] === 0xff) at++
    if (at >= bytes.length) return null

    const marker = bytes[at++]

    // Standalone markers: no length, nothing to skip. RST0..RST7, plus SOI/TEM.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0xd8 || marker === 0x01) continue
    // Start of scan, or end of image: the header is over and no size was found.
    if (marker === 0xda || marker === 0xd9) return null

    if (at + 1 >= bytes.length) return null
    const length = (bytes[at] << 8) | bytes[at + 1]
    // A segment's length includes its own two bytes, so anything under two is
    // a malformed file that would send this loop backwards.
    if (length < 2) return null

    if (isFrameHeader(marker)) {
      // [length 2][precision 1][height 2][width 2]
      if (at + 6 >= bytes.length) return null
      const height = (bytes[at + 3] << 8) | bytes[at + 4]
      const width = (bytes[at + 5] << 8) | bytes[at + 6]
      return width > 0 && height > 0 ? { width, height } : null
    }

    at += length
  }

  return null
}
