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
  /** Pages read on this run that actually yielded words. */
  recognized: number
  /** Pages that already had text and were left alone. */
  skipped: number
  /**
   * Pages the engine read but found nothing on — a photo, a blank sheet.
   *
   * Not a failure: the machine worked, the paper was empty. Counted separately
   * so the screen can say which of the two happened.
   */
  empty: number
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
  const outcome: OcrOutcome = { recognized: 0, skipped: 0, empty: 0, failed: 0 }
  options.onProgress?.({ done: 0, total })

  for (let index = 0; index < total; index++) {
    const page = doc.pages[index]

    if (page.text && !options.force) {
      outcome.skipped++
    } else {
      try {
        const text = await recognizePage(page)
        if (text.blocks.length === 0) {
          /*
            Nothing found, so nothing is stored — and `page.text` stays unset.
            That matters beyond tidiness: `page.text` being present is the only
            thing the detail screen and `canExportDocx` look at, while the
            export itself checks for actual blocks. Writing an empty layout
            makes those two disagree, and the user is told "Teks dikenali"
            right before Word refuses with "belum ada teks yang dikenali".
          */
          outcome.empty++
        } else {
          await savePageText(docId, index, text)
          outcome.recognized++
        }
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

/**
 * The one line the screen shows once a read is over.
 *
 * `empty` has to reach the user here, not only in the counts: a page the engine
 * read and found nothing on leaves `page.text` unset, so `canExportDocx` stays
 * false. Reporting that run as a plain success brings back the exact
 * contradiction the split between `recognized` and `empty` removed — the screen
 * says the text is ready, and Word then refuses with "belum ada teks yang
 * dikenali".
 *
 * Pages that already had text count as pages with text: what the user is asking
 * after pressing the button is how much of the document can be read now, not
 * how much of it this particular run touched.
 */
export function describeOcrOutcome(outcome: OcrOutcome): string {
  const problems: string[] = []
  if (outcome.empty > 0) problems.push(`${outcome.empty} halaman tanpa teks`)
  if (outcome.failed > 0) problems.push(`${outcome.failed} gagal dibaca`)
  if (problems.length === 0) return 'Teks dokumen sudah dikenali.'

  const withText = outcome.recognized + outcome.skipped
  if (withText === 0) return `Tidak ada teks yang dikenali: ${problems.join(', ')}.`
  return `Teks dikenali di ${withText} halaman, ${problems.join(', ')}.`
}
