import { describe, expect, it } from 'vitest'
import { buildObjectKey, isOwnedBy } from './storageKey.ts'

const USER = '2b1f0c9e-1111-2222-3333-444455556666'
const DOC = 'aa11bb22-cc33-dd44-ee55-ff6677889900'

describe('buildObjectKey', () => {
  it('namespaces every object under its owner', () => {
    expect(buildObjectKey(USER, DOC)).toBe(`users/${USER}/${DOC}.pdf`)
  })

  it('is stable, so re-backing up a document overwrites the same object', () => {
    expect(buildObjectKey(USER, DOC)).toBe(buildObjectKey(USER, DOC))
  })

  it('refuses ids that could escape the owner prefix', () => {
    expect(() => buildObjectKey(USER, '../../etc/passwd')).toThrow()
    expect(() => buildObjectKey('..', DOC)).toThrow()
    expect(() => buildObjectKey(USER, '')).toThrow()
  })
})

describe('isOwnedBy', () => {
  it('accepts a key under the user prefix', () => {
    expect(isOwnedBy(`users/${USER}/${DOC}.pdf`, USER)).toBe(true)
  })

  it('rejects another user key', () => {
    expect(isOwnedBy(`users/${USER}/${DOC}.pdf`, 'someone-else')).toBe(false)
  })

  it('rejects a key that only looks like a prefix match', () => {
    expect(isOwnedBy(`users/${USER}-evil/${DOC}.pdf`, USER)).toBe(false)
  })
})
