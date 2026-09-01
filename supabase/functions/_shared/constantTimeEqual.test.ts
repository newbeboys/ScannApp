import { describe, expect, it } from 'vitest'
import { constantTimeEqual } from './constantTimeEqual.ts'

describe('constantTimeEqual', () => {
  it('accepts two identical strings', () => {
    expect(constantTimeEqual('a-shared-secret', 'a-shared-secret')).toBe(true)
  })

  it('rejects a different string of the same length', () => {
    expect(constantTimeEqual('a-shared-secret', 'b-shared-secret')).toBe(false)
  })

  it('rejects a different string of a different length', () => {
    expect(constantTimeEqual('short', 'a-much-longer-secret')).toBe(false)
  })

  it('treats two empty strings as equal', () => {
    expect(constantTimeEqual('', '')).toBe(true)
  })

  it('is case-sensitive', () => {
    expect(constantTimeEqual('Secret', 'secret')).toBe(false)
  })
})
