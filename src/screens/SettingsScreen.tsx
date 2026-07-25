import { ScanIcon, TrashIcon } from '../components/Icons'
import { THEMES, THEME_ORDER } from '../theme/themes'
import { useTheme } from '../theme/useTheme'

interface SettingsScreenProps {
  documentCount: number
  onDeleteAll: () => void
}

export function SettingsScreen({ documentCount, onDeleteAll }: SettingsScreenProps) {
  const { themeId, setThemeId, theme } = useTheme()

  return (
    <div className="screen">
      <header className="app-header">
        <div className="app-header__badge">
          <ScanIcon size={22} />
        </div>
        <div className="app-header__titles">
          <h1>ScannApp</h1>
          <p>Kelola paket &amp; preferensi</p>
        </div>
        <span className="app-header__tier">Basic</span>
      </header>

      <section className="card plan-card">
        <div className="plan-card__badge">B</div>
        <div>
          <h2>Paket Basic</h2>
          <p>Gratis · maks 20 halaman per dokumen</p>
        </div>
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

      <p className="app-version">ScannApp · Fase 1</p>
    </div>
  )
}
