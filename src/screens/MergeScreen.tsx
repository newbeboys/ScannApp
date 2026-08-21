import { useState } from 'react'
import { CheckIcon, ChevronLeftIcon, MergeIcon } from '../components/Icons'
import { PageImage } from '../components/PageImage'
import { planMerge } from '../lib/documentMerge'
import { resolvePage, type LocalScanDocument } from '../lib/scanStorage'
import type { Tier } from '../lib/tier'

interface MergeScreenProps {
  documents: LocalScanDocument[]
  tier: Tier
  isBusy: boolean
  onCancel: () => void
  onMerge: (ids: string[]) => void
  onUpgrade: () => void
}

export function MergeScreen({
  documents,
  tier,
  isBusy,
  onCancel,
  onMerge,
  onUpgrade,
}: MergeScreenProps) {
  // Selection order is meaningful: it becomes the page order of the result.
  const [selected, setSelected] = useState<string[]>([])

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    )
  }

  const chosen = selected
    .map((id) => documents.find((doc) => doc.id === id))
    .filter((doc): doc is LocalScanDocument => doc !== undefined)

  const plan = planMerge(chosen, tier)
  const canMerge = chosen.length >= 2 && plan.check.allowed && !isBusy

  return (
    <div className="screen screen--flow">
      <header className="flow-header">
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Kembali">
          <ChevronLeftIcon size={20} />
        </button>
        <div className="flow-header__titles">
          <h1>Gabungkan Dokumen</h1>
          <p>Urutan pilih menentukan urutan halaman</p>
        </div>
      </header>

      <div className={`merge-meter${plan.check.allowed ? '' : ' merge-meter--over'}`}>
        <strong>
          {plan.pageCount}
          {plan.check.limit !== null ? ` / ${plan.check.limit}` : ''} halaman
        </strong>
        <span>
          {plan.check.limit === null
            ? 'Pro — tanpa batas halaman'
            : plan.check.allowed
              ? `${chosen.length} dokumen dipilih`
              : 'Melebihi batas Basic'}
        </span>
      </div>

      {!plan.check.allowed && (
        <p className="merge-warning">
          {plan.check.reason} Kurangi pilihan, atau{' '}
          <button type="button" className="link-button" onClick={onUpgrade}>
            naik ke Pro
          </button>{' '}
          untuk gabungan tanpa batas.
        </p>
      )}

      <ul className="doc-list">
        {documents.map((doc) => {
          const order = selected.indexOf(doc.id)
          return (
            <li key={doc.id} className="doc-row">
              <button
                type="button"
                className="doc-row__open"
                onClick={() => toggle(doc.id)}
                aria-pressed={order >= 0}
              >
                <span className={`merge-check${order >= 0 ? ' merge-check--on' : ''}`}>
                  {order >= 0 ? order + 1 : <CheckIcon size={14} />}
                </span>
                <div className="doc-row__preview">
                  <PageImage source={resolvePage(doc.pages[0])} alt={doc.title} />
                </div>
                <div className="doc-row__meta">
                  <h3>{doc.title}</h3>
                  <p>{doc.pageCount} halaman</p>
                </div>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="flow-footer">
        <button
          type="button"
          className="button button--primary"
          onClick={() => onMerge(selected)}
          disabled={!canMerge}
        >
          <MergeIcon size={17} />
          <span>
            {isBusy
              ? 'Menggabungkan…'
              : chosen.length < 2
                ? 'Pilih minimal 2 dokumen'
                : `Gabungkan ${chosen.length} Dokumen`}
          </span>
        </button>
      </div>
    </div>
  )
}
