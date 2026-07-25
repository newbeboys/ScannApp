export type ThemeId = 'snow' | 'ocean' | 'sunset' | 'lime'

export interface Theme {
  id: ThemeId
  label: string
  accent: string
  /** Swatch gradient shown in the theme picker. */
  swatch: [string, string]
  background: string
  light: boolean
}

export const THEMES: Record<ThemeId, Theme> = {
  snow: {
    id: 'snow',
    label: 'Putih',
    accent: '#3457e8',
    swatch: ['#ffffff', '#3457e8'],
    background: 'radial-gradient(135% 100% at 50% 0%, #ffffff 0%, #eef2fb 52%, #d8e2f4 100%)',
    light: true,
  },
  ocean: {
    id: 'ocean',
    label: 'Samudra',
    accent: '#2f6bff',
    swatch: ['#2f6bff', '#38bdf8'],
    background: 'radial-gradient(135% 100% at 50% 0%, #13294a 0%, #0d1a2e 55%, #070d18 100%)',
    light: false,
  },
  sunset: {
    id: 'sunset',
    label: 'Senja',
    accent: '#ff5a20',
    swatch: ['#ff5a20', '#ffb020'],
    background: 'radial-gradient(135% 100% at 50% 0%, #341c12 0%, #21140d 55%, #120b07 100%)',
    light: false,
  },
  lime: {
    id: 'lime',
    label: 'Lime',
    accent: '#5CB270',
    swatch: ['#F4F269', '#5CB270'],
    background: 'radial-gradient(135% 100% at 50% 0%, #223a22 0%, #142314 55%, #0a130b 100%)',
    light: false,
  },
}

export const THEME_ORDER: ThemeId[] = ['snow', 'ocean', 'sunset', 'lime']

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** Maps a theme to the CSS custom properties consumed across the stylesheets. */
export function themeCssVars(theme: Theme): Record<string, string> {
  return {
    '--acc': theme.accent,
    '--acc-soft': rgba(theme.accent, 0.15),
    '--acc-edge': rgba(theme.accent, 0.6),
    '--bg': theme.background,
    '--fg': theme.light ? '#1b2740' : '#eef1f6',
    '--fg-dim': theme.light ? '#5c6a86' : '#79818f',
    '--surface': theme.light ? '#ffffff' : 'rgba(255, 255, 255, 0.05)',
    '--chip': theme.light ? 'rgba(20, 34, 70, 0.06)' : 'rgba(255, 255, 255, 0.07)',
    '--chip-border': theme.light ? 'rgba(20, 34, 70, 0.14)' : 'rgba(255, 255, 255, 0.18)',
    '--shadow': theme.light
      ? '0 10px 30px rgba(20, 34, 70, 0.10)'
      : '0 10px 30px rgba(0, 0, 0, 0.45)',
  }
}
