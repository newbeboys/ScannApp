import type { ImageSize } from './jpegSize'

/**
 * The shape ML Kit hands back, declared here rather than imported.
 *
 * Keeps this module free of the Capacitor plugin, which has no web
 * implementation and would drag a native dependency into the node test suite
 * for what is only arithmetic.
 */
export interface RecognizedBox {
  left: number
  top: number
  right: number
  bottom: number
}

export interface RecognizedElement {
  text: string
  boundingBox?: RecognizedBox
}

export interface RecognizedLine {
  text: string
  elements: RecognizedElement[]
}

export interface RecognizedBlock {
  text: string
  lines: RecognizedLine[]
}

export interface RecognizedText {
  blocks: RecognizedBlock[]
}

/**
 * One recognised word and where it sits, as a fraction of the page (0..1).
 *
 * Never a pixel coordinate: an export shrinks the page to the longest edge of
 * the chosen compression level (1600px at Kecil, 4000px at Maksimal), so pixel
 * boxes would slide off every word the moment the level changed. Same reason
 * `Mark` is normalised — see the annotate design doc, Bagian 2.1.
 */
export interface OcrWord {
  text: string
  x: number
  y: number
  w: number
  h: number
}

export interface OcrLine {
  text: string
  words: OcrWord[]
}

export interface OcrBlock {
  text: string
  lines: OcrLine[]
}

export interface PageText {
  blocks: OcrBlock[]
}

/** Keeps a value inside `[0, max]`, so a box that overhangs the paper stops at its edge. */
function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max)
}

/**
 * Converts one word's pixel box into page fractions, or nothing at all.
 *
 * Returns nothing when the box is missing, unreadable, or has collapsed to no
 * area. A word without a box still has its text — it survives inside its
 * line, which is what DOCX reads; only the invisible PDF layer loses it.
 */
function normalizeWord(element: RecognizedElement, size: ImageSize): OcrWord | null {
  const box = element.boundingBox
  if (!box) return null

  const edges = [box.left, box.top, box.right, box.bottom]
  if (!edges.every((edge) => typeof edge === 'number' && Number.isFinite(edge))) return null

  const left = clamp(box.left, size.width)
  const top = clamp(box.top, size.height)
  const right = clamp(box.right, size.width)
  const bottom = clamp(box.bottom, size.height)
  if (right <= left || bottom <= top) return null

  return {
    text: element.text,
    x: left / size.width,
    y: top / size.height,
    w: (right - left) / size.width,
    h: (bottom - top) / size.height,
  }
}

/**
 * Converts ML Kit's pixel boxes into page fractions.
 *
 * Blocks and lines are kept or dropped by their *text*, not by whether their
 * words carried usable boxes: DOCX reads the text and the PDF layer reads the
 * boxes, so losing the boxes must not also lose the words.
 */
export function normalizePageText(raw: RecognizedText, size: ImageSize): PageText {
  // A page whose size could not be read would divide every coordinate by zero
  // and hand back infinities, which pdf-lib would then try to draw.
  if (!(size.width > 0) || !(size.height > 0)) return { blocks: [] }

  const blocks: OcrBlock[] = []
  for (const block of raw.blocks) {
    const lines: OcrLine[] = []
    for (const line of block.lines) {
      if (line.text.trim() === '') continue
      lines.push({
        text: line.text,
        words: line.elements.flatMap((element) => normalizeWord(element, size) ?? []),
      })
    }

    if (lines.length === 0) continue
    blocks.push({ text: block.text, lines })
  }

  return { blocks }
}

/**
 * The characters WinAnsi encodes above ASCII but below Latin-1.
 *
 * CP1252 fills the C1 control range with printable glyphs, and those glyphs
 * are ordinary Unicode characters elsewhere — the euro sign, the curly quotes
 * and dashes OCR produces constantly. Listing them by code point rather than
 * by their CP1252 byte keeps the check on the string we actually hold.
 */
const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
])

function isWinAnsi(point: number): boolean {
  // Printable ASCII, then Latin-1 proper. Everything below 0x20 is a C0
  // control and 0x7f..0x9f are C1 controls: none of them are glyphs, and a
  // newline inside a word would break the text positioning it sits in.
  if (point >= 0x20 && point <= 0x7e) return true
  if (point >= 0xa0 && point <= 0xff) return true
  return WIN_ANSI_EXTRAS.has(point)
}

/**
 * Strips whatever `StandardFonts.Helvetica` cannot encode.
 *
 * Not politeness — `drawText` *throws* on an unsupported character, so one
 * stray glyph from OCR would take down the export of a whole twenty-page
 * document. The invisible layer is worth exactly nothing next to that, so the
 * character goes and the export lives.
 *
 * No font is embedded to widen this: Helvetica is present in every PDF reader,
 * all of Indonesian fits inside WinAnsi, and embedding one would add hundreds
 * of kilobytes to every file for text nobody can see.
 */
export function sanitizeForWinAnsi(text: string): string {
  let safe = ''
  for (const character of text) {
    const point = character.codePointAt(0)
    if (point !== undefined && isWinAnsi(point)) safe += character
  }
  return safe
}

function isFraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Rebuilds a stored layout, keeping only what is well formed.
 *
 * The same posture as `sanitizeMarks`: the file on disk is ours, but a
 * half-written or hand-edited one must not be able to reach pdf-lib. A NaN
 * coordinate is written into the PDF as the literal `NaN`, which no reader can
 * parse — one corrupt word would make the whole export unopenable.
 */
export function sanitizePageText(raw: unknown): PageText {
  const parsed = raw as Partial<PageText> | null | undefined
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.blocks)) return { blocks: [] }

  const blocks: OcrBlock[] = []
  for (const block of parsed.blocks) {
    if (!block || typeof block.text !== 'string' || !Array.isArray(block.lines)) continue

    const lines: OcrLine[] = []
    for (const line of block.lines) {
      if (!line || typeof line.text !== 'string' || !Array.isArray(line.words)) continue

      const words: OcrWord[] = []
      for (const word of line.words) {
        if (!word || typeof word.text !== 'string') continue
        if (!isFraction(word.x) || !isFraction(word.y)) continue
        if (!isFraction(word.w) || !isFraction(word.h)) continue
        words.push({ text: word.text, x: word.x, y: word.y, w: word.w, h: word.h })
      }

      lines.push({ text: line.text, words })
    }

    if (lines.length === 0) continue
    blocks.push({ text: block.text, lines })
  }

  return { blocks }
}
