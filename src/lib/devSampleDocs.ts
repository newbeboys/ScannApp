import { saveScanDocument } from './scanStorage'

/**
 * Dev-only helper. The ML Kit scanner is an Android native plugin, so
 * `npm run dev` has no way to produce documents — which would make the
 * whole editor/export flow untestable in the browser. This draws
 * believable "scanned pages" on a canvas and feeds them through the exact
 * same save path a real scan uses, so nothing about the storage layer is
 * faked.
 *
 * Guarded by `import.meta.env.DEV` at the call site; never ships in the APK.
 */

const PAGE_WIDTH = 1240
const PAGE_HEIGHT = 1754 // A4 at ~150dpi

function drawTextLine(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height = 14,
): void {
  ctx.fillRect(x, y, width, height)
}

function renderPage(title: string, pageNumber: number, totalPages: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = PAGE_WIDTH
  canvas.height = PAGE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas tidak tersedia.')

  // Slightly off-white, like a real scan rather than a screenshot.
  ctx.fillStyle = '#f7f6f3'
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)

  const margin = 120
  const contentWidth = PAGE_WIDTH - margin * 2

  ctx.fillStyle = '#1c1b22'
  ctx.font = 'bold 52px sans-serif'
  ctx.fillText(title, margin, margin + 60)

  ctx.fillStyle = '#863bff'
  ctx.fillRect(margin, margin + 90, 180, 8)

  // Body text, faked as bars of varying width so it reads as a document.
  ctx.fillStyle = '#3a3945'
  let y = margin + 170
  const seed = pageNumber * 37
  for (let i = 0; i < 26; i++) {
    const pseudoRandom = ((seed + i * 53) % 40) / 100
    const width = contentWidth * (0.55 + pseudoRandom)
    drawTextLine(ctx, margin, y, Math.min(width, contentWidth))
    y += 44
    if (i === 9 || i === 18) y += 30 // paragraph breaks
  }

  ctx.fillStyle = '#8a8895'
  ctx.font = '30px sans-serif'
  ctx.fillText(`Halaman ${pageNumber} dari ${totalPages}`, margin, PAGE_HEIGHT - margin)

  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Gagal membuat contoh.'))),
      'image/jpeg',
      0.92,
    )
  })
}

const SAMPLES: { title: string; pages: number }[] = [
  { title: 'Surat Perjanjian Kerja', pages: 3 },
  { title: 'Invoice Pembelian', pages: 2 },
]

/**
 * Creates the sample documents. Object URLs are used because
 * `saveScanDocument` fetches its inputs exactly like real scanner URIs.
 */
export async function seedSampleDocuments(): Promise<number> {
  let created = 0

  for (const sample of SAMPLES) {
    const urls: string[] = []
    try {
      for (let page = 1; page <= sample.pages; page++) {
        const blob = await canvasToBlob(renderPage(sample.title, page, sample.pages))
        urls.push(URL.createObjectURL(blob))
      }
      await saveScanDocument(urls, sample.title)
      created++
    } finally {
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }

  return created
}
