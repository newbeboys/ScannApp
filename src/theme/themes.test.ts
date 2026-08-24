import { describe, expect, it } from 'vitest'
import { THEMES, THEME_ORDER, themeCssVars } from './themes'

describe('themeCssVars', () => {
  it('covers every theme in the picker', () => {
    for (const id of THEME_ORDER) {
      expect(THEMES[id]).toBeDefined()
    }
  })

  /**
   * `--surface` is deliberately translucent on the dark themes: a card only has
   * to sit on the page, and letting the background tint it is what makes the
   * four themes feel different.
   *
   * A bottom sheet is not a card. It covers live content, and its own backdrop
   * is translucent too, so a 5% white sheet let the document behind it read
   * straight through the text — reported from the device on 24 Agustus 2026.
   * `--surface-solid` is the opaque ground modals stand on.
   */
  it('gives every theme a fully opaque surface for modals', () => {
    for (const id of THEME_ORDER) {
      const solid = themeCssVars(THEMES[id])['--surface-solid']

      expect(solid, `tema ${id}`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('keeps the translucent card surface as it was', () => {
    expect(themeCssVars(THEMES.snow)['--surface']).toBe('#ffffff')
    expect(themeCssVars(THEMES.ocean)['--surface']).toBe('rgba(255, 255, 255, 0.05)')
  })

  it('leaves the light theme opaque in both, since white is already solid', () => {
    const snow = themeCssVars(THEMES.snow)

    expect(snow['--surface-solid']).toBe('#ffffff')
  })

  /** The Pro/upgrade colours are brand, not theme — they must not appear here. */
  it('never overrides the Pro brand colours', () => {
    for (const id of THEME_ORDER) {
      const vars = themeCssVars(THEMES[id])

      expect(vars['--upgrade']).toBeUndefined()
      expect(vars['--pro-gold']).toBeUndefined()
    }
  })
})
