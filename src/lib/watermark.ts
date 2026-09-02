import type { PDFFont, PDFPage } from 'pdf-lib'
import { LineCapStyle, rgb } from 'pdf-lib'

/**
 * The ScannApp mark, lifted from src/assets/logo.svg (viewBox 0 0 24 24).
 * Kept as two vector paths rather than a raster asset so the watermark stays
 * crisp at any zoom and adds no image files to the repo -- same reasoning as
 * the mark this replaced.
 *
 * The source SVG draws two layers with two different colors, which is why
 * this is two paths/two drawSvgPath calls instead of one:
 * - PRIMARY_PATH: the black scanner outline, stroked (fill: none in the
 *   source).
 * - SECONDARY_PATH: the teal "paper" bar, filled.
 *
 * SECONDARY_PATH is not the source's `d` attribute verbatim. The source
 * applies `transform="translate(26 2) rotate(90)"` to that path, and
 * pdf-lib's drawSvgPath has no transform support of its own -- it only takes
 * a bare path plus one x/y/scale/rotate for the whole call. Rather than
 * fight pdf-lib's rotate (applied post-flip, in PDF space, and easy to get
 * backwards), the transform was applied by hand to every anchor point before
 * writing this constant: a pure 90 degree rotation about the origin maps
 * (x, y) -> (-y, x), then the translate adds (26, 2) --
 * f(x, y) = (-y + 26, x + 2). Applying f to the source's absolute anchor
 * points (9,5) (15,5) (16,6) (16,22) (15,23) (8,23) (8,6) (9,5) yields the
 * points below; the degenerate `a0,0,0,0,1,0,0` in the source (a zero-radius
 * arc, i.e. a zero-length no-op) is dropped rather than transformed, since it
 * never moved the pen in the first place. Arc flags are unchanged from the
 * source: a pure rotation has no reflection, so large-arc/sweep are
 * preserved.
 */
const PRIMARY_PATH = 'M17,14H15M3,10,20,4M4,18H20a1,1,0,0,0,1-1V11a1,1,0,0,0-1-1H3v7A1,1,0,0,0,4,18Z'
const SECONDARY_PATH = 'M21,11 L21,17 A1,1,0,0,1,20,18 L4,18 A1,1,0,0,1,3,17 L3,11 L20,10 A1,1,0,0,1,21,11 Z'

/** Stroke width the source draws PRIMARY_PATH at, in the path's own units (viewBox 0-24). */
const PRIMARY_STROKE_WIDTH = 2

const LOGO_VIEWBOX = { width: 24, height: 24 }
const PRIMARY_COLOR = rgb(0, 0, 0)
/** rgb(44, 169, 188) from the source SVG's `secondary` path style, kept as-is (Boss Ali, 2 September 2026). */
const SECONDARY_COLOR = rgb(44 / 255, 169 / 255, 188 / 255)

export const WATERMARK = {
  logoHeight: 11,
  fontSize: 9,
  opacity: 0.45,
  margin: 20,
  gap: 4,
} as const

/**
 * Draws the small "logo + ScannApp" mark in the bottom-right corner.
 *
 * Basic tier only — see `shouldWatermark()` in exportLimits.ts. pdf-lib
 * anchors an SVG path at its top-left and grows downward, which is why the
 * y anchor sits one logo-height above the bottom margin. Both paths share
 * this same anchor and scale, since SECONDARY_PATH's own transform was
 * already baked into its coordinates (see the comment above it) — nothing
 * needs to shift between the two drawSvgPath calls.
 */
export function drawWatermark(page: PDFPage, font: PDFFont): void {
  const { width } = page.getSize()
  const scale = WATERMARK.logoHeight / LOGO_VIEWBOX.height
  const logoWidth = LOGO_VIEWBOX.width * scale
  const label = 'ScannApp'
  const textWidth = font.widthOfTextAtSize(label, WATERMARK.fontSize)

  const blockWidth = logoWidth + WATERMARK.gap + textWidth
  const left = width - WATERMARK.margin - blockWidth
  const bottom = WATERMARK.margin + WATERMARK.logoHeight

  page.drawSvgPath(SECONDARY_PATH, {
    x: left,
    y: bottom,
    scale,
    color: SECONDARY_COLOR,
    opacity: WATERMARK.opacity,
  })

  page.drawSvgPath(PRIMARY_PATH, {
    x: left,
    y: bottom,
    scale,
    borderColor: PRIMARY_COLOR,
    borderWidth: PRIMARY_STROKE_WIDTH,
    borderLineCap: LineCapStyle.Round,
    borderOpacity: WATERMARK.opacity,
  })

  page.drawText(label, {
    x: left + logoWidth + WATERMARK.gap,
    y: WATERMARK.margin + 2,
    size: WATERMARK.fontSize,
    font,
    color: PRIMARY_COLOR,
    opacity: WATERMARK.opacity,
  })
}
