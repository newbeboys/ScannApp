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
