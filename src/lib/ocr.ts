import { Script, TextRecognition } from '@capacitor-mlkit/text-recognition'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { readJpegSize } from './jpegSize'
import { normalizePageText, type PageText } from './ocrLayout'
import { annotationSource, getScanDocument, readPageBlob, savePageText } from './scanStorage'
import type { ScanPage } from './scanIndexMigration'
import type { Tier } from './tier'

export interface OcrProgress {
  done: number
  total: number
}

export interface OcrOutcome {
  /** Pages read on this run. */
  recognized: number
  /** Pages that already had text and were left alone. */
  skipped: number
  /** Pages the engine could not read. The document keeps whatever it had. */
  failed: number
}

export interface RecognizeOptions {
  /** Re-reads pages that already have text, instead of leaving them alone. */
  force?: boolean
  onProgress?: (progress: OcrProgress) => void
}

/**
 * Reads one page with ML Kit and returns its words in page fractions.
 *
 * The source is `annotationSource` — the page *without* its ink but *with* its
 * filter. Both halves matter: pen strokes and signatures over the words come
 * back as nonsense characters, while Hitam-Putih and Magic Color exist
 * precisely to make text easier to read.
 *
 * The engine is handed a `file://` URI rather than bytes: its Android side
 * calls `InputImage.fromFilePath`, so the file it already has on disk is the
 * cheapest thing to give it. The bytes are read here only for the header — the
 * pixel size the boxes have to be divided by.
 */
async function recognizePage(page: ScanPage): Promise<PageText> {
  const source = annotationSource(page)

  const blob = await readPageBlob(source)
  const size = readJpegSize(new Uint8Array(await blob.arrayBuffer()))
  if (!size) throw new Error('Ukuran halaman tidak terbaca.')

  const { uri } = await Filesystem.getUri({ path: source, directory: Directory.Data })
  const result = await TextRecognition.processImage({ path: uri, script: Script.Latin })

  return normalizePageText(result, size)
}

/**
 * Reads every page of a document that does not already have text.
 *
 * Saves after each page rather than once at the end, unlike
 * `applyDocumentFilter`. Filtering twenty pages is seconds of work; reading
 * them is minutes, and a user who leaves half way through must not come back
 * to nothing. Because a stored page is then skipped on the next run, the same
 * button doubles as "continue" and as "fix the page I just cropped".
 *
 * A page the engine chokes on is counted and stepped over. Nineteen good pages
 * are worth more than a clean failure, and the caller is told the number so it
 * can say so rather than claiming a full run.
 */
export async function recognizeDocument(
  docId: string,
  tier: Tier,
  options: RecognizeOptions = {},
): Promise<OcrOutcome> {
  // Enforced here, not in the screen: a hidden button is a suggestion. Unlike
  // the gates that were pulled out of this library in August, this one is
  // meant to stay — OCR is the engine Pro sells, not access to a document the
  // user already owns.
  if (tier !== 'pro') {
    throw new Error('Kenali teks hanya tersedia untuk akun Pro.')
  }

  const doc = await getScanDocument(docId)
  if (!doc) throw new Error('Dokumen tidak ditemukan.')

  const total = doc.pages.length
  const outcome: OcrOutcome = { recognized: 0, skipped: 0, failed: 0 }
  options.onProgress?.({ done: 0, total })

  for (let index = 0; index < total; index++) {
    const page = doc.pages[index]

    if (page.text && !options.force) {
      outcome.skipped++
    } else {
      try {
        await savePageText(docId, index, await recognizePage(page))
        outcome.recognized++
      } catch {
        // Deliberately swallowed: the page keeps whatever text it had, and the
        // count is what the caller reports. Re-running picks it up again.
        outcome.failed++
      }
    }

    options.onProgress?.({ done: index + 1, total })
  }

  return outcome
}
