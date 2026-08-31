import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { ChevronLeftIcon, EyeIcon, EyeOffIcon } from '../components/Icons'

export type AuthMode = 'signin' | 'signup'

interface AuthScreenProps {
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
  onBack: () => void
  onForgotPassword: () => void
}

const COPY = {
  signin: {
    title: 'Masuk',
    lede: 'Lanjutkan memindai dari tempat kamu berhenti.',
    submit: 'Masuk',
    busy: 'Sedang masuk…',
  },
  signup: {
    title: 'Buat akun',
    lede: 'Satu akun untuk backup, paket Pro, dan referral.',
    submit: 'Buat akun',
    busy: 'Sedang membuat akun…',
  },
} as const

export function AuthScreen({ mode, onModeChange, onBack, onForgotPassword }: AuthScreenProps) {
  const { signIn, signUp } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [referredByCode, setReferredByCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)

  const copy = COPY[mode]

  const switchMode = (next: AuthMode) => {
    setError(null)
    setReferredByCode('')
    onModeChange(next)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsBusy(true)

    try {
      if (mode === 'signin') {
        await signIn(email, password)
      } else {
        const { signedIn } = await signUp(
          email,
          password,
          displayName,
          referredByCode.trim() ? referredByCode.trim().toUpperCase() : undefined,
        )
        // Nothing more to do when a session came back — App swaps the screen.
        if (!signedIn) setAwaitingConfirmation(true)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Terjadi kesalahan.')
    } finally {
      setIsBusy(false)
    }
  }

  if (awaitingConfirmation) {
    return (
      <div className="auth">
        <div className="auth__confirm">
          <h1 className="auth__title">Cek email kamu</h1>
          <p className="auth__lede">
            Kami mengirim tautan verifikasi ke <strong>{email}</strong>. Buka tautan itu, lalu
            kembali ke sini untuk masuk.
          </p>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              setAwaitingConfirmation(false)
              setPassword('')
              switchMode('signin')
            }}
          >
            Kembali ke halaman masuk
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth">
      <button type="button" className="auth__back" onClick={onBack} aria-label="Kembali">
        <ChevronLeftIcon size={22} />
      </button>

      <h1 className="auth__title">{copy.title}</h1>
      <p className="auth__lede">{copy.lede}</p>

      <div className="auth__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signin'}
          className={`auth__tab${mode === 'signin' ? ' auth__tab--active' : ''}`}
          onClick={() => switchMode('signin')}
        >
          Masuk
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          className={`auth__tab${mode === 'signup' ? ' auth__tab--active' : ''}`}
          onClick={() => switchMode('signup')}
        >
          Daftar
        </button>
      </div>

      <form className="auth__form" onSubmit={handleSubmit}>
        {mode === 'signup' && (
          <label className="field">
            <span className="field__label">Nama</span>
            <input
              className="field__input"
              type="text"
              autoComplete="name"
              placeholder="Nama kamu"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        )}

        {mode === 'signup' && (
          <label className="field">
            <span className="field__label">Kode referral (opsional)</span>
            <input
              className="field__input"
              type="text"
              autoCapitalize="characters"
              placeholder="Contoh: K7M2N9PQ"
              value={referredByCode}
              onChange={(event) => setReferredByCode(event.target.value)}
            />
          </label>
        )}

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

        <label className="field">
          <span className="field__label">Password</span>
          <span className="field__wrap">
            <input
              className="field__input"
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder={mode === 'signup' ? 'Minimal 6 karakter' : '••••••••'}
              // The reveal button below shares this <label>, and its own aria-label
              // ("Tampilkan/Sembunyikan password") would otherwise bleed into this
              // input's computed accessible name. An explicit aria-label overrides
              // that so the name stays exactly "Password".
              aria-label="Password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="field__reveal"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
            >
              {showPassword ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
            </button>
          </span>
        </label>

        {mode === 'signin' && (
          <button type="button" className="auth__forgot" onClick={onForgotPassword}>
            Lupa password?
          </button>
        )}

        {error && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="button button--primary" disabled={isBusy}>
          {isBusy ? copy.busy : copy.submit}
        </button>
      </form>
    </div>
  )
}
