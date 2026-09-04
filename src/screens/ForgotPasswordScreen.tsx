import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { ChevronLeftIcon } from '../components/Icons'

/**
 * Enough to catch a typo before it costs a round trip; Supabase stays the
 * authority on whether the address actually exists.
 */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface ForgotPasswordScreenProps {
  onBack: () => void
  /** Hands the address to the verify step, which needs it for verifyOtp. */
  onCodeSent: (email: string) => void
}

export function ForgotPasswordScreen({ onBack, onCodeSent }: ForgotPasswordScreenProps) {
  const { sendPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsBusy(true)

    const address = email.trim()

    if (!LOOKS_LIKE_EMAIL.test(address)) {
      setError('Format email tidak valid.')
      setIsBusy(false)
      return
    }

    try {
      await sendPasswordReset(address)
      onCodeSent(address)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Terjadi kesalahan.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="auth">
      <button type="button" className="auth__back" onClick={onBack} aria-label="Kembali">
        <ChevronLeftIcon size={22} />
      </button>

      <h1 className="auth__title">Lupa password</h1>
      <p className="auth__lede">
        Masukkan email akun kamu. Kami kirim kode verifikasi 6 digit ke email itu.
      </p>

      {/* noValidate: the browser's own bubble speaks the device's language,
          and this screen's messages are specified in Indonesian. */}
      <form className="auth__form" onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span className="field__label">Email</span>
          <input
            className="field__input"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            placeholder="nama@email.com"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        {error && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="button button--primary" disabled={isBusy}>
          {isBusy ? 'Mengirim…' : 'Kirim kode'}
        </button>
      </form>
    </div>
  )
}
