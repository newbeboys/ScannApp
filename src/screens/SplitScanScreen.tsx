import { ChevronLeftIcon } from '../components/Icons'
import { PageImage } from '../components/PageImage'
import { everyNCuts, planSplit, splitTitles, toggleCut } from '../lib/scanSplit'

interface SplitScanScreenProps {
  /** Scanner URIs, exactly as ReviewScreen has them — hence `raw` below. */
  pages: string[]
  cuts: number[]
  name: string
  /**
   * How many documents this split session already saved — the same value the
   * save is given, so the numbers previewed here are the numbers that land.
   */
  startAt: number
  isBusy: boolean
  /** `{ done, total }` while a save is running, else null. */
  progress: { done: number; total: number } | null
  onCutsChange: (cuts: number[]) => void
  onNameChange: (name: string) => void
  onBack: () => void
  /** Groups of scanner URIs, in screen order. */
  onSave: (groups: string[][]) => void
}

/**
 * A screen of its own rather than markers inside the review strip.
 *
 * That strip is horizontal and already full at five pages; thirty pages with
 * separators between them would turn it into a long corridor that has to be
 * dragged just to see how many documents there are.
 *
 * Controlled on purpose: `cuts` and `name` live in App. After a save that only
 * half succeeded, App has to swap the page list *and* rebuild the cuts around
 * what is left — impossible from outside if the cuts lived here, short of
 * remounting the screen and losing the name the user typed.
 */
export function SplitScanScreen({
  pages,
  cuts,
  name,
  startAt,
  isBusy,
  progress,
  onCutsChange,
  onNameChange,
  onBack,
  onSave,
}: SplitScanScreenProps) {
  const groups = planSplit(pages.length, cuts)
  const titles = splitTitles(name, groups.length, startAt)
  // Which group each page belongs to, so a header can be drawn where one starts.
  const groupOfPage = new Map<number, number>()
  groups.forEach((group, groupIndex) => {
    for (const pageIndex of group) groupOfPage.set(pageIndex, groupIndex)
  })

  return (
    <div className="screen screen--flow">
      <header className="flow-header">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Kembali">
          <ChevronLeftIcon size={20} />
        </button>
        <div className="flow-header__titles">
          <h1>Pisah Hasil Pindai</h1>
          <p>
            {pages.length} halaman → {groups.length} dokumen
          </p>
        </div>
      </header>

      <label className="split-name">
        <span>Nama</span>
        <input
          type="text"
          value={name}
          placeholder="Kosongkan untuk nama bawaan"
          onChange={(event) => onNameChange(event.target.value)}
          disabled={isBusy}
        />
      </label>

      {/*
        Patterns and hand-adjustment are not separate modes: a pattern only
        fills the cuts, and every one of them can still be moved afterwards.
      */}
      <div className="split-patterns">
        <button
          type="button"
          className="split-chip"
          onClick={() => onCutsChange(everyNCuts(pages.length, 1))}
          disabled={isBusy}
        >
          Tiap 1 halaman
        </button>
        <button
          type="button"
          className="split-chip"
          onClick={() => onCutsChange(everyNCuts(pages.length, 2))}
          disabled={isBusy}
        >
          Tiap 2 halaman
        </button>
        <button
          type="button"
          className="split-chip"
          onClick={() => onCutsChange([])}
          disabled={isBusy}
        >
          Bersihkan pemisah
        </button>
      </div>

      <ol className="split-list">
        {pages.map((page, index) => {
          const groupIndex = groupOfPage.get(index) ?? 0
          const isCut = cuts.includes(index)
          const startsGroup = groups[groupIndex]?.[0] === index

          return (
            <li key={page} className="split-item">
              {index > 0 && (
                <button
                  type="button"
                  className={`split-cut${isCut ? ' split-cut--on' : ''}`}
                  onClick={() => onCutsChange(toggleCut(cuts, index))}
                  disabled={isBusy}
                  aria-pressed={isCut}
                  aria-label={
                    isCut
                      ? `Gabungkan halaman ${index} dan ${index + 1}`
                      : `Pisah antara halaman ${index} dan ${index + 1}`
                  }
                >
                  <span>{isCut ? 'Dokumen baru mulai di sini' : 'Pisah di sini'}</span>
                </button>
              )}

              {startsGroup && (
                <p className="split-group__title">
                  {/*
                    Counted from `startAt` like the titles are, so the two
                    halves of this line cannot disagree after a partial save.
                  */}
                  {titles[groupIndex]
                    ? `Dokumen ${startAt + groupIndex + 1} — ${titles[groupIndex]}`
                    : `Dokumen ${startAt + groupIndex + 1}`}
                </p>
              )}

              <div className="split-page">
                <PageImage source={page} raw alt={`Halaman ${index + 1}`} />
                <span className="split-page__number">{index + 1}</span>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="flow-footer">
        {progress && (
          <p className="split-progress">
            Menyimpan… {progress.done} dari {progress.total}
          </p>
        )}
        <button
          type="button"
          className="button button--primary"
          disabled={isBusy}
          onClick={() => onSave(groups.map((group) => group.map((index) => pages[index])))}
        >
          {isBusy ? 'Menyimpan…' : `Simpan ${groups.length} Dokumen`}
        </button>
      </div>
    </div>
  )
}
