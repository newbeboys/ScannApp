import { describe, expect, it } from 'vitest'
import { activeChip, pickToChoice } from './filterChoice'
import type { ScanPage } from './scanIndexMigration'

const plain: ScanPage = { original: 'page-1.jpg' }
const excepted: ScanPage = { original: 'page-1.jpg', filter: 'none' }
const overridden: ScanPage = { original: 'page-1.jpg', filter: 'magic' }

/**
 * Which chip reads as chosen. It has to answer for the scope the chips are
 * about to act on, not for whatever the open page happens to render with.
 */
describe('activeChip', () => {
  it('answers with the document filter in document scope', () => {
    expect(activeChip('document', { filter: 'bw' }, plain)).toBe('bw')
  })

  /**
   * The bug this locks out: a black-and-white document whose open page carries
   * a 'none' exception used to light "Asli" while the scope said "Semua
   * halaman". The document looked unfiltered, and tapping that apparently
   * inert chip cleared the filter from every other page.
   */
  it('ignores a page exception in document scope', () => {
    expect(activeChip('document', { filter: 'bw' }, excepted)).toBe('bw')
    expect(activeChip('document', { filter: 'bw' }, overridden)).toBe('bw')
  })

  it('says nothing is chosen when the document has no filter', () => {
    expect(activeChip('document', {}, overridden)).toBeNull()
  })

  it('answers with what this page really renders in page scope', () => {
    expect(activeChip('page', { filter: 'bw' }, excepted)).toBeNull()
    expect(activeChip('page', { filter: 'bw' }, overridden)).toBe('magic')
    expect(activeChip('page', { filter: 'bw' }, plain)).toBe('bw')
  })
})

describe('pickToChoice', () => {
  it('clears the document filter for both "Asli" and none in document scope', () => {
    expect(pickToChoice(null, 'document')).toEqual({ document: null })
    expect(pickToChoice('none', 'document')).toEqual({ document: null })
  })

  it('keeps the two meanings apart in page scope', () => {
    // 'none' is a deliberate plain page; null puts it back under the document.
    expect(pickToChoice('none', 'page')).toEqual({ page: 'none' })
    expect(pickToChoice(null, 'page')).toEqual({ page: null })
  })

  it('passes a real filter through in either scope', () => {
    expect(pickToChoice('bw', 'document')).toEqual({ document: 'bw' })
    expect(pickToChoice('bw', 'page')).toEqual({ page: 'bw' })
  })
})
