import { useAuth } from '../auth/useAuth'
import { AppLogo } from '../components/AppLogo'
import { ChevronRightIcon, CloudIcon, GiftIcon, LogoutIcon, TrashIcon } from '../components/Icons'
import { QuotaBar } from '../components/QuotaBar'
import { GRACE_PERIOD_DAYS } from '../lib/accountDeletion'
import { proDaysRemaining, tierLabel } from '../lib/tier'
import { THEMES, THEME_ORDER } from '../theme/themes'
import { useTheme } from '../theme/useTheme'

interface SettingsScreenProps {
  documentCount: number
  usedBytes: number
  quotaBytes: number
  onDeleteAll: () => void
  onSignOut: () => void
  onOpenBackups: () => void
  onOpenReferral: () => void
  onUpgrade: () => void
  onDeleteAccount: () => void
}

export function SettingsScreen({
  documentCount,
  usedBytes,
  quotaBytes,
  onDeleteAll,
  onSignOut,
  onOpenBackups,
  onOpenReferral,
  onUpgrade,
  onDeleteAccount,
}: SettingsScreenProps) {
  const { themeId, setThemeId, theme } = useTheme()
  const { email, profile, tier } = useAuth()

  const name = profile?.displayName?.trim() || email?.split('@')[0] || 'Pengguna'
  const daysLeft = proDaysRemaining(profile)

  return (
    <div className="screen">
      <header className="app-header">
        <div className="app-header__badge">
          <AppLogo />
        </div>
        <div className="app-header__titles">
          <h1>ScannApp</h1>
          <p>Kelola paket &amp; preferensi</p>
        </div>
        <span className="app-header__tier">{tier === 'pro' ? 'Pro' : 'Basic'}</span>
      </header>

      <section className="card account-card">
        <div className="account-card__avatar">{name.charAt(0).toUpperCase()}</div>
        <div className="account-card__body">
          <p className="account-card__name">{name}</p>
          {email && <p className="account-card__email">{email}</p>}
          <span
            className={`account-card__tier${tier === 'pro' ? ' account-card__tier--pro' : ''}`}
          >
            {tierLabel(profile)}
            {daysLeft !== null && (
              <span className="account-card__remaining">· sisa {daysLeft} hari</span>
            )}
          </span>
        </div>
      </section>

      {tier === 'basic' && (
        <section className="card">
          <button type="button" className="card__row card__row--button" onClick={onUpgrade}>
            <span className="card__row-label upgrade-row">Naik ke Pro</span>
            <ChevronRightIcon size={18} />
          </button>
        </section>
      )}

      <h2 className="section-label">Cloud</h2>

      <QuotaBar usedBytes={usedBytes} quotaBytes={quotaBytes} />

      <section className="card">
        <button type="button" className="card__row card__row--button" onClick={onOpenBackups}>
          <span className="card__row-label">
            <CloudIcon size={17} className="card__row-icon" />
            Cadangan di cloud
          </span>
          <ChevronRightIcon size={18} />
        </button>
      </section>

      <section className="card">
        <button type="button" className="card__row card__row--button" onClick={onOpenReferral}>
          <span className="card__row-label">
            <GiftIcon size={17} className="card__row-icon" />
            Ajak Teman
          </span>
          <ChevronRightIcon size={18} />
        </button>
      </section>

      <h2 className="section-label">Preferensi</h2>

      <section className="card">
        <div className="card__row">
          <span className="card__row-label">Tema warna</span>
          <span className="card__row-value">{theme.label}</span>
        </div>
        <div className="theme-picker">
          {THEME_ORDER.map((id) => {
            const option = THEMES[id]
            return (
              <button
                key={id}
                type="button"
                className={`theme-swatch${themeId === id ? ' theme-swatch--active' : ''}`}
                style={{
                  background: `linear-gradient(135deg, ${option.swatch[0]} 0 50%, ${option.swatch[1]} 50% 100%)`,
                }}
                onClick={() => setThemeId(id)}
                aria-label={`Tema ${option.label}`}
                aria-pressed={themeId === id}
              />
            )
          })}
        </div>
      </section>

      <section className="card">
        <button
          type="button"
          className="card__row card__row--button"
          onClick={onDeleteAll}
          disabled={documentCount === 0}
        >
          <span className="card__row-label">Hapus semua dokumen</span>
          <TrashIcon size={18} className="danger-icon" />
        </button>
      </section>

      <section className="card">
        <button type="button" className="card__row card__row--button" onClick={onSignOut}>
          <span className="card__row-label">Keluar</span>
          <LogoutIcon size={18} />
        </button>
      </section>

      {/*
        Kept apart from "Keluar" and from "Hapus semua dokumen" on purpose.
        Sitting in the same card as sign-out would put the one irreversible
        action in this screen a thumb's width from the one people tap most.
      */}
      <h2 className="section-label">Akun</h2>

      <section className="card">
        <button
          type="button"
          className="card__row card__row--button"
          onClick={onDeleteAccount}
        >
          <span className="card__row-label danger-label">Hapus akun</span>
          <TrashIcon size={18} className="danger-icon" />
        </button>
      </section>

      <p className="settings-note">
        Menghapus akun juga menghapus semua cadangan di cloud. Ada masa tunggu{' '}
        {GRACE_PERIOD_DAYS} hari sebelum penghapusan permanen.
      </p>

      <p className="app-version">ScannApp · Fase 5</p>
    </div>
  )
}
