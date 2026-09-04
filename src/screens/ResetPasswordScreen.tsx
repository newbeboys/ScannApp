import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { ChevronLeftIcon, EyeIcon, EyeOffIcon } from '../components/Icons'

/** Seconds before "Kirim ulang kode" becomes available again. */
const RESEND_COOLDOWN = 60

/** Supabase rejects anything shorter; checked here so the user is told sooner. */
const MIN_PASSWORD = 6

interface ResetPasswordScreenProps {
  /** The address the code went to; verifyOtp needs it alongside the code. */
  email: string
  /** Back to the sign-in screen — abandons the reset. */
  onBack: () => void
  /**
   * The reset finished. App keeps this screen up for as long as it is routing
   * a recovery, so it needs telling to stop; the session is already valid, so
   * clearing that route is what lets the user through to Beranda.
   */
  onDone: () => void
}

export function ResetPasswordScreen({ email, onBack, onDone }: ResetPasswordScreenProps) {
  const { recoveryPending, verifyRecoveryOtp, completeRecovery, cancelRecovery, sendPasswordReset } =
    useAuth()

  /*
    Which half of the flow is showing. Seeded from recoveryPending rather than
    always starting at 'otp': when the app was closed after the code was
    accepted but before the password was saved, it reopens straight here, and
    that code is already spent. Asking for it again would be unanswerable.
  */
  const [stage, setStage] = useState<'otp' | 'password'>(recoveryPending ? 'password' : 'otp')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(
    // Only meaningful to someone who just came from the email step.
    recoveryPending ? null : 'Kode verifikasi telah dikirim ke email Anda.',
  )
  const [isBusy, setIsBusy] = useState(false)
  const [cooldown, setCooldown] = useState(() => (recoveryPending ? 0 : RESEND_COOLDOWN))

  /*
    One interval for the life of the screen, reading the count through a ref, so
    that resending can restart the countdown without tearing the timer down and
    rebuilding it on every tick.
  */
  const cooldownRef = useRef(cooldown)
  cooldownRef.current = cooldown

  useEffect(() => {
    const timer = setInterval(() => {
      if (cooldownRef.current > 0) setCooldown((seconds) => seconds - 1)
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  const failWith = (caught: unknown) => {
    setError(caught instanceof Error ? caught.message : 'Terjadi kesalahan.')
  }

  const handleVerify = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setNotice(null)

    if (otp.length !== 6) {
      setError('Kode verifikasi harus 6 digit.')
      return
    }

    setIsBusy(true)
    try {
      await verifyRecoveryOtp(email, otp)
      setStage('password')
    } catch (caught) {
      failWith(caught)
    } finally {
      setIsBusy(false)
    }
  }

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD) {
      setError(`Password minimal ${MIN_PASSWORD} karakter.`)
      return
    }
    if (password !== confirmation) {
      setError('Konfirmasi password tidak sama.')
      return
    }

    setIsBusy(true)
    try {
      await completeRecovery(password)
      // recoveryPending has dropped and the session the code opened stays —
      // which is just a signed-in user. Releasing the route hands them the tabs.
      onDone()
    } catch (caught) {
      failWith(caught)
    } finally {
      setIsBusy(false)
    }
  }

  const handleResend = async () => {
    setError(null)
    setNotice(null)
    setIsBusy(true)

    try {
      await sendPasswordReset(email)
      // The old code stops working the moment a new one is issued, so clearing
      // the field keeps a half-typed one from being submitted against it.
      setOtp('')
      setCooldown(RESEND_COOLDOWN)
      setNotice('Kode baru sudah dikirim. Cek email kamu.')
    } catch (caught) {
      failWith(caught)
    } finally {
      setIsBusy(false)
    }
  }

  /*
    Leaving mid-reset has to drop the recovery session, not just change screen:
    the code already bought a real session, and walking away from it while it is
    still live is exactly how someone ends up inside the app holding the
    password they came here to replace.
  */
  const handleBack = async () => {
    if (stage === 'password') await cancelRecovery()
    onBack()
  }

  return (
    <div className="auth">
      <button type="button" className="auth__back" onClick={handleBack} aria-label="Kembali">
        <ChevronLeftIcon size={22} />
      </button>

      <h1 className="auth__title">{stage === 'otp' ? 'Masukkan kode' : 'Buat password baru'}</h1>
      <p className="auth__lede">
        {stage === 'otp' ? (
          <>
            Kode 6 digit dikirim ke <strong>{email}</strong>. Masukkan kodenya untuk melanjutkan.
          </>
        ) : (
          'Kode kamu sudah terverifikasi. Sekarang pilih password baru untuk akun ini.'
        )}
      </p>

      {stage === 'otp' ? (
        /* noValidate throughout: the browser's own bubbles speak whatever
           language the device is set to, and these messages are specified in
           Indonesian. Native validation also fires first, which would leave the
           checks in handleVerify/handleSave unreachable. */
        <form className="auth__form" onSubmit={handleVerify} noValidate>
          <label className="field">
            <span className="field__label">Kode verifikasi</span>
            <input
              className="field__input field__input--otp"
              type="text"
              // Brings up the number pad, and lets Android fill the code
              // straight from the notification.
              inputMode="numeric"
              autoComplete="one-time-code"
              // Deliberately no maxLength: it truncates the raw text before the
              // handler below can strip separators out of it, so a pasted
              // "123 456" would arrive as "123 45" and quietly lose a digit.
              // The slice in onChange caps the length after cleaning instead.
              placeholder="123456"
              required
              value={otp}
              // Filtered rather than merely validated: a pasted code often
              // carries spaces, and the number pad is not the only way in.
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>

          {notice && <p className="auth__notice">{notice}</p>}
          {error && (
            <p className="auth__error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="button button--primary" disabled={isBusy}>
            {isBusy ? 'Memeriksa…' : 'Verifikasi kode'}
          </button>

          <button
            type="button"
            className="auth__resend"
            onClick={handleResend}
            disabled={isBusy || cooldown > 0}
          >
            {cooldown > 0 ? `Kirim ulang kode dalam ${cooldown} detik` : 'Kirim ulang kode'}
          </button>
        </form>
      ) : (
        <form className="auth__form" onSubmit={handleSave} noValidate>
          <label className="field">
            <span className="field__label">Password baru</span>
            <span className="field__wrap">
              <input
                className="field__input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Minimal 6 karakter"
                // The reveal button shares this <label>, so without an explicit
                // name its own aria-label would bleed into this input's.
                aria-label="Password baru"
                required
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

          <label className="field">
            <span className="field__label">Ulangi password baru</span>
            <input
              className="field__input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Ketik ulang password"
              aria-label="Ulangi password baru"
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>

          {error && (
            <p className="auth__error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="button button--primary" disabled={isBusy}>
            {isBusy ? 'Menyimpan…' : 'Simpan password baru'}
          </button>
        </form>
      )}
    </div>
  )
}
