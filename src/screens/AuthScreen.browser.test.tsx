import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { AuthContext, type AuthContextValue } from '../auth/authContext'
import { AuthScreen } from './AuthScreen'

const signUp = vi.fn().mockResolvedValue({ signedIn: true })
const signIn = vi.fn().mockResolvedValue(undefined)

const AUTH_STUB: AuthContextValue = {
  status: 'signed-out',
  userId: null,
  email: null,
  profile: null,
  tier: 'basic',
  tierResolved: true,
  signIn,
  signUp,
  signOut: vi.fn(),
  sendPasswordReset: vi.fn(),
  recoveryPending: false,
  verifyRecoveryOtp: vi.fn(),
  completeRecovery: vi.fn(),
  cancelRecovery: vi.fn(),
  refreshProfile: vi.fn(),
}

async function renderAuth(mode: 'signin' | 'signup' = 'signup') {
  return await render(
    <AuthContext.Provider value={AUTH_STUB}>
      <AuthScreen mode={mode} onModeChange={() => {}} onBack={() => {}} onForgotPassword={() => {}} />
    </AuthContext.Provider>,
  )
}

describe('AuthScreen — kode referral', () => {
  it('shows the referral code field only in signup mode', async () => {
    const signup = await renderAuth('signup')
    await expect.element(signup.getByLabelText('Kode referral (opsional)')).toBeVisible()
    // render() scopes queries to document.body, not to its own mount container
    // (see useScrollLock.browser.test.tsx / DocumentsScreen.browser.test.tsx for
    // the same pattern), so the signup instance must be unmounted before the
    // signin instance renders — otherwise its leftover DOM would still match.
    await signup.unmount()

    const signin = await renderAuth('signin')
    await expect.element(signin.getByLabelText('Kode referral (opsional)')).not.toBeInTheDocument()
  })

  it('sends the trimmed, uppercased code to signUp', async () => {
    const screen = await renderAuth('signup')

    await screen.getByLabelText('Email').fill('user@example.com')
    await screen.getByLabelText('Password', { exact: true }).fill('secret6')
    await screen.getByLabelText('Kode referral (opsional)').fill('  k7m2n9pq  ')
    await screen.getByRole('button', { name: 'Buat akun' }).click()

    expect(signUp).toHaveBeenCalledWith('user@example.com', 'secret6', '', 'K7M2N9PQ')
  })

  it('sends undefined when no code is entered', async () => {
    const screen = await renderAuth('signup')

    await screen.getByLabelText('Email').fill('user2@example.com')
    await screen.getByLabelText('Password', { exact: true }).fill('secret6')
    await screen.getByRole('button', { name: 'Buat akun' }).click()

    expect(signUp).toHaveBeenCalledWith('user2@example.com', 'secret6', '', undefined)
  })
})
