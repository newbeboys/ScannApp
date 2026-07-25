import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ThemeContext } from './themeContext'
import { THEMES, themeCssVars, type ThemeId } from './themes'

const STORAGE_KEY = 'scannapp.theme'

function readStoredTheme(): ThemeId {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored && stored in THEMES ? (stored as ThemeId) : 'snow'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>(readStoredTheme)

  const setThemeId = useCallback((id: ThemeId) => {
    setThemeIdState(id)
    localStorage.setItem(STORAGE_KEY, id)
  }, [])

  const theme = THEMES[themeId]

  useEffect(() => {
    const root = document.documentElement
    for (const [name, value] of Object.entries(themeCssVars(theme))) {
      root.style.setProperty(name, value)
    }
    root.dataset.themeLight = String(theme.light)
  }, [theme])

  const value = useMemo(() => ({ theme, themeId, setThemeId }), [theme, themeId, setThemeId])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
