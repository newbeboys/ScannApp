import { describe, expect, it } from 'vitest'
import {
  daysUntilDeletion,
  deletionBannerText,
  deletionDueAt,
  GRACE_PERIOD_DAYS,
} from './accountDeletion'

const NOW = new Date('2026-09-05T12:00:00.000Z')
const DAY = 86_400_000

/** An ISO timestamp `days` days before NOW. */
function requestedDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString()
}

describe('deletionDueAt', () => {
  it('falls 7 days after the request', () => {
    expect(GRACE_PERIOD_DAYS).toBe(7)
    expect(deletionDueAt('2026-09-05T12:00:00.000Z')?.toISOString()).toBe(
      '2026-09-12T12:00:00.000Z',
    )
  })

  it('is null when nothing is pending', () => {
    expect(deletionDueAt(null)).toBeNull()
    expect(deletionDueAt(undefined)).toBeNull()
    expect(deletionDueAt('')).toBeNull()
  })

  it('is null for a timestamp it cannot read', () => {
    // A cached profile written by an older build, or a corrupted value —
    // either way the banner must stay away rather than show "NaN hari".
    expect(deletionDueAt('besok pagi')).toBeNull()
  })
})

describe('daysUntilDeletion', () => {
  it('reads a request made this instant as the full grace period', () => {
    expect(daysUntilDeletion(requestedDaysAgo(0), NOW)).toBe(7)
  })

  it('counts down as the days pass', () => {
    expect(daysUntilDeletion(requestedDaysAgo(1), NOW)).toBe(6)
    expect(daysUntilDeletion(requestedDaysAgo(6), NOW)).toBe(1)
  })

  it('rounds a part day up, so the last hours still read as 1 hari', () => {
    const requestedAt = new Date(NOW.getTime() - (7 * DAY - 3600_000)).toISOString()

    expect(daysUntilDeletion(requestedAt, NOW)).toBe(1)
  })

  it('floors at zero once the grace period has run out', () => {
    // The nightly job may not have fired yet; a negative count would render as
    // "dalam -3 hari" and read like a bug to the user.
    expect(daysUntilDeletion(requestedDaysAgo(7), NOW)).toBe(0)
    expect(daysUntilDeletion(requestedDaysAgo(30), NOW)).toBe(0)
  })

  it('is null when no deletion is pending', () => {
    expect(daysUntilDeletion(null, NOW)).toBeNull()
  })
})

describe('deletionBannerText', () => {
  it('says nothing at all when no deletion is pending', () => {
    expect(deletionBannerText(null, NOW)).toBeNull()
  })

  it('counts plural days', () => {
    expect(deletionBannerText(requestedDaysAgo(0), NOW)).toBe(
      'Akun ini akan dihapus permanen dalam 7 hari.',
    )
  })

  it('says besok rather than "dalam 1 hari"', () => {
    expect(deletionBannerText(requestedDaysAgo(6), NOW)).toBe('Akun ini akan dihapus permanen besok.')
  })

  it('says hari ini once the grace period is spent', () => {
    expect(deletionBannerText(requestedDaysAgo(7), NOW)).toBe(
      'Akun ini akan dihapus permanen hari ini.',
    )
  })
})
