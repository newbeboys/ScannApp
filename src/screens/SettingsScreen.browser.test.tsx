import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { AuthContext, type AuthContextValue } from '../auth/authContext'
import { ThemeProvider } from '../theme/ThemeProvider'
import { SettingsScreen } from './SettingsScreen'

const AUTH_STUB: AuthContextValue = {
  status: 'signed-in',
  userId: 'user-1',
  email: 'ali@example.com',
  profile: null,
  tier: 'basic',
  tierResolved: true,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  sendPasswordReset: vi.fn(),
  refreshProfile: vi.fn(),
}

async function renderSettings(overrides: Partial<Parameters<typeof SettingsScreen>[0]> = {}) {
  return await render(
    <AuthContext.Provider value={AUTH_STUB}>
      <ThemeProvider>
        <SettingsScreen
          documentCount={0}
          usedBytes={0}
          quotaBytes={104_857_600}
          onDeleteAll={() => {}}
          onSignOut={() => {}}
          onOpenBackups={() => {}}
          onOpenReferral={() => {}}
          onUpgrade={() => {}}
          showCrashTest={false}
          onTriggerCrash={() => {}}
          {...overrides}
        />
      </ThemeProvider>
    </AuthContext.Provider>,
  )
}

/**
 * Fase 8.5b: the crash-test row must be invisible unless the native side has
 * confirmed a debug build (BuildConfig.DEBUG via DebugBuildPlugin) — never
 * optimistic while that check is still in flight, and never present at all
 * in the release build CI ships to Play Store.
 */
describe('SettingsScreen — Crashlytics debug row', () => {
  it('is absent by default — a release build, or a check still in flight', async () => {
    const screen = await renderSettings({ showCrashTest: false })

    await expect
      .element(screen.getByRole('button', { name: 'Picu Crash Uji Coba' }))
      .not.toBeInTheDocument()
    expect(screen.container.textContent).not.toContain('Debug')
  })

  it('appears once the native side confirms a debug build', async () => {
    const screen = await renderSettings({ showCrashTest: true })

    await expect
      .element(screen.getByRole('button', { name: 'Picu Crash Uji Coba' }))
      .toBeVisible()
  })

  it('calls the trigger only when tapped, never on its own', async () => {
    const onTriggerCrash = vi.fn()
    const screen = await renderSettings({ showCrashTest: true, onTriggerCrash })

    expect(onTriggerCrash).not.toHaveBeenCalled()

    await screen.getByRole('button', { name: 'Picu Crash Uji Coba' }).click()

    expect(onTriggerCrash).toHaveBeenCalledTimes(1)
  })
})
