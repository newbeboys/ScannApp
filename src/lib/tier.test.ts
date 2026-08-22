import { describe, expect, it } from 'vitest'
import { proDaysRemaining, resolveTier, type Profile } from './tier'

const NOW = new Date('2026-07-26T12:00:00Z')

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'user-1',
    displayName: 'Ali',
    tier: 'basic',
    tierExpiresAt: null,
    proPlan: null,
    referralCode: 'ABC23456',
    ...overrides,
  }
}

describe('resolveTier', () => {
  it('falls back to basic when there is no profile yet', () => {
    expect(resolveTier(null, NOW)).toBe('basic')
  })

  it('keeps a basic profile on basic', () => {
    expect(resolveTier(profile(), NOW)).toBe('basic')
  })

  it('grants pro while the subscription is still running', () => {
    const p = profile({
      tier: 'pro',
      proPlan: 'monthly',
      tierExpiresAt: '2026-08-26T12:00:00Z',
    })

    expect(resolveTier(p, NOW)).toBe('pro')
  })

  it('drops an expired pro back to basic even if the daily job has not run', () => {
    const p = profile({
      tier: 'pro',
      proPlan: 'yearly',
      tierExpiresAt: '2026-07-25T12:00:00Z',
    })

    expect(resolveTier(p, NOW)).toBe('basic')
  })

  /**
   * Boss Ali's rule: every Pro is time-limited (1 month or 1 year), so a Pro
   * row with no end date is corrupt data — never a lifetime grant.
   */
  it('treats pro without an end date as basic', () => {
    expect(resolveTier(profile({ tier: 'pro', tierExpiresAt: null }), NOW)).toBe('basic')
  })

  it('treats an unparseable end date as basic', () => {
    const p = profile({ tier: 'pro', tierExpiresAt: 'bukan-tanggal' })

    expect(resolveTier(p, NOW)).toBe('basic')
  })
})

describe('proDaysRemaining', () => {
  it('is null for basic users', () => {
    expect(proDaysRemaining(profile(), NOW)).toBeNull()
  })

  it('is null when there is no profile', () => {
    expect(proDaysRemaining(null, NOW)).toBeNull()
  })

  it('rounds a partial day up, so the last day still reads as 1', () => {
    const p = profile({
      tier: 'pro',
      proPlan: 'referral',
      tierExpiresAt: '2026-07-26T20:00:00Z',
    })

    expect(proDaysRemaining(p, NOW)).toBe(1)
  })

  it('counts whole days for a fresh yearly plan', () => {
    const p = profile({
      tier: 'pro',
      proPlan: 'yearly',
      tierExpiresAt: '2026-08-05T12:00:00Z',
    })

    expect(proDaysRemaining(p, NOW)).toBe(10)
  })

  it('is null once the subscription has lapsed', () => {
    const p = profile({
      tier: 'pro',
      proPlan: 'monthly',
      tierExpiresAt: '2026-07-01T12:00:00Z',
    })

    expect(proDaysRemaining(p, NOW)).toBeNull()
  })
})
