import { DocumentIcon, HomeIcon, SettingsIcon } from './Icons'

export type TabId = 'home' | 'documents' | 'settings'

const TABS = [
  { id: 'home' as const, label: 'Home', Icon: HomeIcon },
  { id: 'documents' as const, label: 'Dokumen', Icon: DocumentIcon },
  { id: 'settings' as const, label: 'Pengaturan', Icon: SettingsIcon },
]

interface BottomNavProps {
  active: TabId
  onChange: (tab: TabId) => void
}

export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav className="bottom-nav">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={`bottom-nav__item${active === id ? ' bottom-nav__item--active' : ''}`}
          onClick={() => onChange(id)}
          aria-current={active === id ? 'page' : undefined}
        >
          <Icon size={22} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
