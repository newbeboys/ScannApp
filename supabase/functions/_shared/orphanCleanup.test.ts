import { describe, expect, it } from 'vitest'
import {
  ORPHAN_MIN_AGE_MS,
  planCleanup,
  resolveDryRun,
  verifyCronSecret,
} from './orphanCleanup.ts'
import type { ListedR2Object } from './r2ListParser.ts'

const NOW = new Date('2026-09-01T03:00:00.000Z')

function object(key: string, ageMs: number, size = 1000): ListedR2Object {
  return { key, size, lastModified: new Date(NOW.getTime() - ageMs) }
}

const DAY = 24 * 60 * 60 * 1000

describe('planCleanup', () => {
  it('never flags a referenced key, however old', () => {
    const listed = [object('users/a/1.pdf', 10 * DAY)]
    const plan = planCleanup(listed, new Set(['users/a/1.pdf']), NOW, false)

    expect(plan.candidates).toEqual([])
  })

  it('does not flag an unreferenced object younger than the 24h margin', () => {
    const listed = [object('users/a/1.pdf', DAY - 1000)]
    const plan = planCleanup(listed, new Set(), NOW, false)

    expect(plan.candidates).toEqual([])
  })

  it('flags an unreferenced object exactly at the 24h margin', () => {
    const listed = [object('users/a/1.pdf', ORPHAN_MIN_AGE_MS)]
    const plan = planCleanup(listed, new Set(), NOW, false)

    expect(plan.candidates).toHaveLength(1)
  })

  it('flags an unreferenced object well past the margin', () => {
    const listed = [object('users/a/1.pdf', 10 * DAY)]
    const plan = planCleanup(listed, new Set(), NOW, false)

    expect(plan.candidates).toHaveLength(1)
  })

  it('sums candidateBytes across every candidate', () => {
    const listed = [object('users/a/1.pdf', 10 * DAY, 500), object('users/a/2.pdf', 10 * DAY, 1500)]
    const plan = planCleanup(listed, new Set(), NOW, false)

    expect(plan.candidateBytes).toBe(2000)
  })

  it('never deletes when dry run is requested, even with clean candidates', () => {
    const listed = [object('users/a/1.pdf', 10 * DAY)]
    const plan = planCleanup(listed, new Set(), NOW, true)

    expect(plan.shouldDelete).toBe(false)
  })

  it('allows deletion when dry run is off, candidates are few, and the ratio is low', () => {
    const listed = [
      object('users/a/1.pdf', 10 * DAY), // candidate
      ...Array.from({ length: 19 }, (_, i) => object(`users/a/kept-${i}.pdf`, DAY)),
    ]
    const referenced = new Set(listed.slice(1).map((o) => o.key))
    const plan = planCleanup(listed, referenced, NOW, false)

    expect(plan.candidates).toHaveLength(1)
    expect(plan.safetyValveTripped).toBe(false)
    expect(plan.shouldDelete).toBe(true)
  })

  it('trips the safety valve when candidates exceed 50% of a large-enough listing', () => {
    const listed = Array.from({ length: 40 }, (_, i) => object(`users/a/${i}.pdf`, 10 * DAY))
    // Only 10 of the 40 are referenced -> 75% candidates.
    const referenced = new Set(listed.slice(0, 10).map((o) => o.key))
    const plan = planCleanup(listed, referenced, NOW, false)

    expect(plan.safetyValveTripped).toBe(true)
    expect(plan.shouldDelete).toBe(false)
  })

  it('does not trip the safety valve below the minimum candidate floor, even at 100%', () => {
    // 3 objects, all orphaned -- 100% ratio, but far below the 20-candidate
    // floor. An early, near-empty bucket must not be permanently unable to
    // clean up because every object it has happens to be orphaned.
    const listed = Array.from({ length: 3 }, (_, i) => object(`users/a/${i}.pdf`, 10 * DAY))
    const plan = planCleanup(listed, new Set(), NOW, false)

    expect(plan.safetyValveTripped).toBe(false)
    expect(plan.shouldDelete).toBe(true)
  })

  it('handles an empty bucket listing without dividing by zero', () => {
    const plan = planCleanup([], new Set(), NOW, false)

    expect(plan.totalListed).toBe(0)
    expect(plan.safetyValveTripped).toBe(false)
    expect(plan.shouldDelete).toBe(true)
  })
})

describe('resolveDryRun', () => {
  it('defaults to dry run when the env var is unset', () => {
    expect(resolveDryRun(undefined)).toBe(true)
  })

  it('stays dry run for anything other than the exact literal "false"', () => {
    expect(resolveDryRun('')).toBe(true)
    expect(resolveDryRun('true')).toBe(true)
    expect(resolveDryRun('False')).toBe(true)
    expect(resolveDryRun('FALSE')).toBe(true)
  })

  it('turns real deletion on only for the exact literal "false"', () => {
    expect(resolveDryRun('false')).toBe(false)
  })
})

describe('verifyCronSecret', () => {
  const SECRET = 'a-very-long-random-cron-secret-value'

  it('accepts the matching secret', () => {
    expect(verifyCronSecret(SECRET, SECRET)).toBe(true)
  })

  it('rejects a missing header', () => {
    expect(verifyCronSecret(null, SECRET)).toBe(false)
  })

  it('rejects a wrong value of the same length', () => {
    const wrong = 'b' + SECRET.slice(1)
    expect(verifyCronSecret(wrong, SECRET)).toBe(false)
  })

  it('rejects a wrong value of a different length', () => {
    expect(verifyCronSecret('short', SECRET)).toBe(false)
  })
})
