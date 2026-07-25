import type { PDFFont, PDFPage } from 'pdf-lib'
import { rgb } from 'pdf-lib'

/**
 * The ScannApp mark, lifted from public/favicon.svg (viewBox 0 0 48 46).
 * Kept as a vector path rather than a raster asset so the watermark stays
 * crisp at any zoom and adds no image files to the repo.
 */
const LOGO_PATH =
  'M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z'

const LOGO_VIEWBOX = { width: 48, height: 46 }
const BRAND = '#863bff'

export const WATERMARK = {
  logoHeight: 11,
  fontSize: 9,
  opacity: 0.45,
  margin: 20,
  gap: 4,
} as const

function brandColor() {
  const n = Number.parseInt(BRAND.slice(1), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/**
 * Draws the small "logo + ScannApp" mark in the bottom-right corner.
 *
 * Basic tier only — see `shouldWatermark()` in exportLimits.ts. pdf-lib
 * anchors an SVG path at its top-left and grows downward, which is why the
 * y anchor sits one logo-height above the bottom margin.
 */
export function drawWatermark(page: PDFPage, font: PDFFont): void {
  const { width } = page.getSize()
  const scale = WATERMARK.logoHeight / LOGO_VIEWBOX.height
  const logoWidth = LOGO_VIEWBOX.width * scale
  const label = 'ScannApp'
  const textWidth = font.widthOfTextAtSize(label, WATERMARK.fontSize)

  const blockWidth = logoWidth + WATERMARK.gap + textWidth
  const left = width - WATERMARK.margin - blockWidth

  page.drawSvgPath(LOGO_PATH, {
    x: left,
    y: WATERMARK.margin + WATERMARK.logoHeight,
    scale,
    color: brandColor(),
    opacity: WATERMARK.opacity,
  })

  page.drawText(label, {
    x: left + logoWidth + WATERMARK.gap,
    y: WATERMARK.margin + 2,
    size: WATERMARK.fontSize,
    font,
    color: brandColor(),
    opacity: WATERMARK.opacity,
  })
}
