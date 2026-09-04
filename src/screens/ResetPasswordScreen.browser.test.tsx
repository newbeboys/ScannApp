import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-react'
import { AuthContext, type AuthContextValue } from '../auth/authContext'
import { ResetPasswordScreen } from './ResetPasswordScreen'

/*
  render() scopes its queries to document.body rather than to its own mount
  container, so a previous test's DOM still answers them — and this screen
  renders the same labels in every test, which turns that into an ambiguous
  match rather than a wrong one. Tear each render down before the next.
*/
afterEach(cleanup)

function stub(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'signed-out',
    userId: null,
    email: null,
    profile: null,
    tier: 'basic',
    tierResolved: true,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    sendPasswordReset: vi.fn().mockResolvedValue(undefined),
    recoveryPending: false,
    verifyRecoveryOtp: vi.fn().mockResolvedValue(undefined),
    completeRecovery: vi.fn().mockResolvedValue(undefined),
    cancelRecovery: vi.fn().mockResolvedValue(undefined),
    refreshProfile: vi.fn(),
    ...overrides,
  }
}

async function renderScreen(auth: AuthContextValue, props: Partial<{ onDone: () => void; onBack: () => void }> = {}) {
  return await render(
    <AuthContext.Provider value={auth}>
      <ResetPasswordScreen
        email="user@example.com"
        onBack={props.onBack ?? (() => {})}
        onDone={props.onDone ?? (() => {})}
      />
    </AuthContext.Provider>,
  )
}

describe('ResetPasswordScreen — verifikasi kode', () => {
  it('keeps the password fields hidden until the code is accepted', async () => {
    const screen = await renderScreen(stub())

    await expect.element(screen.getByLabelText('Kode verifikasi')).toBeVisible()
    await expect.element(screen.getByLabelText('Password baru', { exact: true })).not.toBeInTheDocument()
  })

  it('confirms the code was sent', async () => {
    const screen = await renderScreen(stub())

    await expect
      .element(screen.getByText('Kode verifikasi telah dikirim ke email Anda.'))
      .toBeVisible()
  })

  it('strips anything that is not a digit, and stops at six', async () => {
    const screen = await renderScreen(stub())
    const field = screen.getByLabelText('Kode verifikasi')

    await field.fill('12a3 45678')

    await expect.element(field).toHaveValue('123456')
  })

  it('verifies with the address it was given, not one the user retypes', async () => {
    const auth = stub()
    const screen = await renderScreen(auth)

    await screen.getByLabelText('Kode verifikasi').fill('123456')
    await screen.getByRole('button', { name: 'Verifikasi kode' }).click()

    expect(auth.verifyRecoveryOtp).toHaveBeenCalledWith('user@example.com', '123456')
  })

  it('refuses a short code without spending a network call on it', async () => {
    const auth = stub()
    const screen = await renderScreen(auth)

    await screen.getByLabelText('Kode verifikasi').fill('123')
    await screen.getByRole('button', { name: 'Verifikasi kode' }).click()

    await expect.element(screen.getByRole('alert')).toHaveTextContent('6 digit')
    expect(auth.verifyRecoveryOtp).not.toHaveBeenCalled()
  })

  it('shows the rejection in Indonesian and stays on the code step', async () => {
    const auth = stub({
      verifyRecoveryOtp: vi
        .fn()
        .mockRejectedValue(new Error('Kode verifikasi salah atau sudah kedaluwarsa.')),
    })
    const screen = await renderScreen(auth)

    await screen.getByLabelText('Kode verifikasi').fill('000000')
    await screen.getByRole('button', { name: 'Verifikasi kode' }).click()

    await expect.element(screen.getByRole('alert')).toHaveTextContent('kedaluwarsa')
    await expect.element(screen.getByLabelText('Password baru', { exact: true })).not.toBeInTheDocument()
  })

  it('reveals the password fields once the code is accepted', async () => {
    const screen = await renderScreen(stub())

    await screen.getByLabelText('Kode verifikasi').fill('123456')
    await screen.getByRole('button', { name: 'Verifikasi kode' }).click()

    await expect.element(screen.getByLabelText('Password baru', { exact: true })).toBeVisible()
    await expect.element(screen.getByLabelText('Ulangi password baru')).toBeVisible()
  })
})

describe('ResetPasswordScreen — kirim ulang kode', () => {
  it('holds the resend button for a cooldown instead of offering it at once', async () => {
    const screen = await renderScreen(stub())

    // Wording carries the remaining seconds, so match on the stable part.
    const resend = screen.getByRole('button', { name: /Kirim ulang kode dalam/ })
    await expect.element(resend).toBeDisabled()
  })

  it('offers resending immediately when the code was already spent', async () => {
    // Reopened mid-reset: the cooldown belongs to a send this run never made.
    const screen = await renderScreen(stub({ recoveryPending: true }))

    await expect.element(screen.getByLabelText('Password baru', { exact: true })).toBeVisible()
  })
})

describe('ResetPasswordScreen — password baru', () => {
  async function reachPasswordStage(auth: AuthContextValue, props = {}) {
    const screen = await renderScreen(auth, props)
    await screen.getByLabelText('Kode verifikasi').fill('123456')
    await screen.getByRole('button', { name: 'Verifikasi kode' }).click()
    await expect.element(screen.getByLabelText('Password baru', { exact: true })).toBeVisible()
    return screen
  }

  it('saves the new password and lets the app move on', async () => {
    const auth = stub()
    const onDone = vi.fn()
    const screen = await reachPasswordStage(auth, { onDone })

    await screen.getByLabelText('Password baru', { exact: true }).fill('rahasia123')
    await screen.getByLabelText('Ulangi password baru').fill('rahasia123')
    await screen.getByRole('button', { name: 'Simpan password baru' }).click()

    expect(auth.completeRecovery).toHaveBeenCalledWith('rahasia123')
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('rejects a password under six characters before calling Supabase', async () => {
    const auth = stub()
    const screen = await reachPasswordStage(auth)

    await screen.getByLabelText('Password baru', { exact: true }).fill('abc')
    await screen.getByLabelText('Ulangi password baru').fill('abc')
    await screen.getByRole('button', { name: 'Simpan password baru' }).click()

    await expect.element(screen.getByRole('alert')).toHaveTextContent('minimal 6 karakter')
    expect(auth.completeRecovery).not.toHaveBeenCalled()
  })

  it('catches a mistyped confirmation rather than saving the wrong password', async () => {
    const auth = stub()
    const screen = await reachPasswordStage(auth)

    await screen.getByLabelText('Password baru', { exact: true }).fill('rahasia123')
    await screen.getByLabelText('Ulangi password baru').fill('rahasia124')
    await screen.getByRole('button', { name: 'Simpan password baru' }).click()

    await expect.element(screen.getByRole('alert')).toHaveTextContent('tidak sama')
    expect(auth.completeRecovery).not.toHaveBeenCalled()
  })

  it('keeps the user on this screen when saving fails', async () => {
    const auth = stub({
      completeRecovery: vi.fn().mockRejectedValue(new Error('Tidak ada koneksi internet.')),
    })
    const onDone = vi.fn()
    const screen = await reachPasswordStage(auth, { onDone })

    await screen.getByLabelText('Password baru', { exact: true }).fill('rahasia123')
    await screen.getByLabelText('Ulangi password baru').fill('rahasia123')
    await screen.getByRole('button', { name: 'Simpan password baru' }).click()

    await expect.element(screen.getByRole('alert')).toHaveTextContent('koneksi')
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('ResetPasswordScreen — reset yang belum selesai', () => {
  /*
    The edge case this screen exists for. verifyOtp hands back a real session,
    so an app closed between the code and the new password reopens signed in —
    and must come back here, not to Beranda, with the code no longer asked for
    because it is already spent.
  */
  it('reopens straight at the password step, never asking for a spent code', async () => {
    const screen = await renderScreen(stub({ recoveryPending: true, status: 'signed-in' }))

    await expect.element(screen.getByLabelText('Password baru', { exact: true })).toBeVisible()
    await expect.element(screen.getByLabelText('Kode verifikasi')).not.toBeInTheDocument()
  })

  it('signs out when the user backs out, so no live recovery session is left', async () => {
    const auth = stub({ recoveryPending: true, status: 'signed-in' })
    const onBack = vi.fn()
    const screen = await renderScreen(auth, { onBack })

    await screen.getByRole('button', { name: 'Kembali' }).click()

    await vi.waitFor(() => expect(auth.cancelRecovery).toHaveBeenCalled())
    expect(onBack).toHaveBeenCalled()
  })

  it('leaves the session alone when backing out before the code is spent', async () => {
    const auth = stub()
    const onBack = vi.fn()
    const screen = await renderScreen(auth, { onBack })

    await screen.getByRole('button', { name: 'Kembali' }).click()

    await vi.waitFor(() => expect(onBack).toHaveBeenCalled())
    expect(auth.cancelRecovery).not.toHaveBeenCalled()
  })
})
