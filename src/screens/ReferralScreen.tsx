import { Share } from '@capacitor/share'
import { useEffect, useState } from 'react'
import { ChevronLeftIcon, GiftIcon } from '../components/Icons'
import { fetchReferralProgress, type ReferralProgress } from '../lib/referralApi'

interface ReferralScreenProps {
  referralCode: string | null
  onBack: () => void
  onError: (message: string) => void
  /** Overridable for tests -- defaults to the real Edge Function-backed fetch. */
  fetchProgress?: () => Promise<ReferralProgress>
  /** Overridable for tests -- defaults to the real native share sheet. */
  shareCode?: (options: { title: string; text: string }) => Promise<void>
}

export function ReferralScreen({
  referralCode,
  onBack,
  onError,
  fetchProgress = fetchReferralProgress,
  shareCode = Share.share,
}: ReferralScreenProps) {
  const [progress, setProgress] = useState<ReferralProgress | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchProgress()
      .then((result) => {
        if (!cancelled) setProgress(result)
      })
      .catch(() => {
        if (!cancelled) onError('Gagal memuat progres referral.')
      })
    return () => {
      cancelled = true
    }
  }, [fetchProgress, onError])

  const handleShare = async () => {
    if (!referralCode) return
    try {
      await shareCode({
        title: 'Ajak teman pakai ScannApp',
        text: `Pakai kode referral ${referralCode} saat daftar di ScannApp -- kita berdua dapat hari Pro gratis! Masukkan kode ini di form Daftar.`,
      })
    } catch {
      // User cancelled the share sheet -- not an error worth surfacing.
    }
  }

  const activatedCount = progress?.activatedCount ?? 0

  return (
    <div className="screen screen--flow">
      <header className="flow-header">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Kembali">
          <ChevronLeftIcon size={20} />
        </button>
        <div className="flow-header__titles">
          <h1>Ajak Teman</h1>
          <p>Bagikan kodemu, dapat hari Pro gratis</p>
        </div>
      </header>

      <section className="card referral-code-card">
        <span className="referral-code-card__label">Kode referral kamu</span>
        <span className="referral-code-card__value">{referralCode ?? '—'}</span>
        <button
          type="button"
          className="button button--primary referral-code-card__share"
          onClick={handleShare}
          disabled={!referralCode}
        >
          <GiftIcon size={18} />
          <span>Bagikan kode</span>
        </button>
      </section>

      <h2 className="section-label">Progres</h2>

      <section className="card">
        <div className="card__row">
          <span className="card__row-label">Teman yang sudah aktif</span>
          <span className="card__row-value">{activatedCount} orang</span>
        </div>
      </section>

      <section className="card referral-milestones">
        {(progress?.milestones ?? []).map((milestone) => {
          const reached = activatedCount >= milestone.count
          const ratio = milestone.count > 0 ? activatedCount / milestone.count : 0

          return (
            <div
              key={milestone.count}
              className={`referral-milestone${reached ? ' referral-milestone--reached' : ''}`}
            >
              <div className="referral-milestone__track">
                <div
                  className="referral-milestone__fill"
                  style={{ width: `${Math.min(100, ratio * 100)}%` }}
                />
              </div>
              <span className="referral-milestone__label">
                {milestone.count} orang &rarr; {milestone.proDays} hari Pro
                {reached && ' · Tercapai'}
              </span>
            </div>
          )
        })}
      </section>
    </div>
  )
}
