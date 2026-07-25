import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { ChevronLeftIcon } from '../components/Icons'

interface ForgotPasswordScreenProps {
  onBack: () => void
}

export function ForgotPasswordScreen({ onBack }: ForgotPasswordScreenProps) {
  const { sendPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [isSent, setIsSent] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsBusy(true)

    try {
      await sendPasswordReset(email)
      setIsSent(true)
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

      <h1 className="auth__title">Atur ulang password</h1>

      {isSent ? (
        <>
          <p className="auth__lede">
            Tautan pengaturan ulang dikirim ke <strong>{email}</strong>. Buka tautan itu untuk
            memilih password baru.
          </p>
          <button type="button" className="button button--primary" onClick={onBack}>
            Kembali ke halaman masuk
          </button>
        </>
      ) : (
        <>
          <p className="auth__lede">
            Masukkan email akun kamu. Kami kirim tautan untuk memilih password baru.
          </p>

          <form className="auth__form" onSubmit={handleSubmit}>
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
              {isBusy ? 'Mengirim…' : 'Kirim tautan'}
            </button>
          </form>
        </>
      )}
    </div>
  )
}
