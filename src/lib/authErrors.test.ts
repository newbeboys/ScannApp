import { describe, expect, it } from 'vitest'
import { translateAuthError } from './authErrors'

describe('translateAuthError', () => {
  it('turns the most common sign-in failure into plain Indonesian', () => {
    expect(translateAuthError({ message: 'Invalid login credentials' })).toBe(
      'Email atau password salah.',
    )
  })

  it('explains an unconfirmed email instead of leaving the user stuck', () => {
    const message = translateAuthError({ message: 'Email not confirmed' })

    expect(message).toContain('email')
    expect(message).toContain('verifikasi')
  })

  it('names the real problem when the email is already taken', () => {
    expect(translateAuthError({ message: 'User already registered' })).toContain('sudah terdaftar')
  })

  it('states the password rule when the password is too short', () => {
    const message = translateAuthError({ message: 'Password should be at least 6 characters' })

    expect(message).toContain('6 karakter')
  })

  it('tells the user to wait when Supabase rate-limits the email', () => {
    const message = translateAuthError({
      message: 'For security purposes, you can only request this after 51 seconds',
    })

    expect(message).toContain('tunggu')
  })

  it('matches case-insensitively, since Supabase wording is not stable', () => {
    expect(translateAuthError({ message: 'INVALID LOGIN CREDENTIALS' })).toBe(
      'Email atau password salah.',
    )
  })

  it('reports a connection problem for network failures', () => {
    const message = translateAuthError({ message: 'Failed to fetch' })

    expect(message).toContain('koneksi')
  })

  it('falls back to a generic Indonesian message for anything unknown', () => {
    const message = translateAuthError({ message: 'some brand new supabase error' })

    expect(message).toBe('Terjadi kesalahan. Coba lagi sebentar lagi.')
  })

  it('handles a missing error object without throwing', () => {
    expect(translateAuthError(null)).toBe('Terjadi kesalahan. Coba lagi sebentar lagi.')
  })
})

describe('translateAuthError — kode OTP pemulihan', () => {
  it('covers every wording Supabase uses for a wrong or stale code', () => {
    for (const raw of [
      'Token has expired or is invalid',
      'Invalid token',
      'Email link is invalid or has expired',
    ]) {
      expect(translateAuthError({ message: raw })).toContain('Kode verifikasi')
    }
  })

  it('recognises the otp_expired error code, not just its prose form', () => {
    expect(translateAuthError({ message: 'otp_expired' })).toContain('kedaluwarsa')
  })

  it('still reads the email address as invalid, not as a bad code', () => {
    expect(translateAuthError({ message: 'Unable to validate email address' })).toBe(
      'Format email tidak valid.',
    )
  })

  it('explains a reused password instead of falling back to the generic message', () => {
    expect(
      translateAuthError({ message: 'New password should be different from the old password.' }),
    ).toContain('berbeda dari password lama')
  })

  it('tells the user to start over when the recovery session is gone', () => {
    expect(translateAuthError({ message: 'Auth session missing!' })).toContain('Lupa password')
  })

  it('keeps the resend rate limit distinct from a bad code', () => {
    expect(translateAuthError({ message: 'Email rate limit exceeded' })).toContain('Terlalu sering')
  })
})
