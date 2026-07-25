import { describe, expect, it } from 'vitest'
import { formatBytes } from './formatBytes'

describe('formatBytes', () => {
  it('writes nothing stored as 0 MB, not an empty string', () => {
    expect(formatBytes(0)).toBe('0 MB')
  })

  it('keeps small files readable in KB', () => {
    expect(formatBytes(512)).toBe('0,5 KB')
    expect(formatBytes(140 * 1024)).toBe('140 KB')
  })

  /** Indonesian uses a comma for the decimal separator. */
  it('uses a comma as the decimal separator', () => {
    expect(formatBytes(Math.round(1.25 * 1024 * 1024))).toBe('1,3 MB')
  })

  it('switches to GB for large quotas', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB')
  })

  it('drops the decimal when it would read as ,0', () => {
    expect(formatBytes(100 * 1024 * 1024)).toBe('100 MB')
  })
})
