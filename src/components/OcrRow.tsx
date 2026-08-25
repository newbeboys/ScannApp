import { TextIcon } from './Icons'
import type { OcrProgress } from '../lib/ocr'
import type { Tier } from '../lib/tier'

interface OcrRowProps {
  tier: Tier
  /** Pages that already carry recognised text. */
  recognized: number
  total: number
  /** Set while a run is in flight, which is also what locks the button. */
  progress: OcrProgress | null
  onRecognize: () => void
  onUpgrade: () => void
}

/**
 * One row that both reports what has been read and offers to read the rest.
 *
 * The three resting states are the three things that actually happen: nothing
 * read yet, part read — after leaving mid-run or cropping a page, which throws
 * that page's text away — and all read. Rounding the middle state to either
 * end would leave the user with no way to tell why a page came out of the
 * export without its words.
 */
export function OcrRow({
  tier,
  recognized,
  total,
  progress,
  onRecognize,
  onUpgrade,
}: OcrRowProps) {
  const isPro = tier === 'pro'
  const running = progress !== null
  const complete = recognized >= total && total > 0
  const partial = recognized > 0 && !complete

  const note = running
    ? `Membaca halaman ${progress.done} dari ${progress.total}…`
    : complete
      ? `Teks dikenali · ${total} halaman`
      : partial
        ? `${recognized} dari ${total} halaman dikenali`
        : 'Bisa dicari & disalin setelah dikenali'

  const label = complete ? 'Kenali Ulang' : partial ? 'Kenali Sisanya' : 'Kenali Teks'

  return (
    <section className="card ocr-row">
      <span className="ocr-row__icon">
        <TextIcon size={18} />
      </span>
      <div className="ocr-row__body">
        <p className="ocr-row__title">Teks Dokumen</p>
        <p className="ocr-row__note">{note}</p>
      </div>
      <button
        type="button"
        className="button ocr-row__action"
        // Basic is sent to the paywall rather than being given a dead button:
        // the row is here to say the feature exists, and a tap that does
        // nothing says the app is broken instead.
        onClick={isPro ? onRecognize : onUpgrade}
        disabled={running}
      >
        <span>{label}</span>
        {!isPro && <span className="pro-badge">Pro</span>}
      </button>
    </section>
  )
}
