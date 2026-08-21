import { formatBytes } from '../lib/formatBytes'

interface QuotaBarProps {
  usedBytes: number
  quotaBytes: number
}

/**
 * The bar is clamped at full but the numbers are not: a Pro reward can end and
 * drop someone's quota below what they already store. Existing files are never
 * deleted for that, so the honest reading is "over quota, cannot add more".
 */
export function QuotaBar({ usedBytes, quotaBytes }: QuotaBarProps) {
  const ratio = quotaBytes > 0 ? usedBytes / quotaBytes : 0
  const isFull = ratio >= 1

  return (
    <section className="card quota">
      <div className="quota__head">
        <span className="quota__label">Penyimpanan cloud</span>
        <span className="quota__value">
          {formatBytes(usedBytes)} dari {formatBytes(quotaBytes)}
        </span>
      </div>
      <div className="quota__track">
        <div
          className={`quota__fill${isFull ? ' quota__fill--full' : ''}`}
          style={{ width: `${Math.min(100, Math.max(ratio * 100, usedBytes > 0 ? 3 : 0))}%` }}
        />
      </div>
      {isFull && (
        <p className="quota__warning">
          Kuota penuh. Hapus cadangan lama atau naik ke Pro untuk ruang lebih besar.
        </p>
      )}
    </section>
  )
}
