import { describe, expect, it } from 'vitest'
import {
  boundaryCuts,
  canSplitScan,
  everyNCuts,
  planSplit,
  splitTitles,
  toggleCut,
} from './scanSplit'

describe('planSplit', () => {
  it('groups pages around the cuts', () => {
    expect(planSplit(7, [2, 3, 6])).toEqual([[0, 1], [2], [3, 4, 5], [6]])
  })

  it('is one document when there are no cuts', () => {
    expect(planSplit(3, [])).toEqual([[0, 1, 2]])
  })

  it('is one document per page when every position is cut', () => {
    expect(planSplit(3, [1, 2])).toEqual([[0], [1], [2]])
  })

  it('ignores duplicate cuts', () => {
    expect(planSplit(4, [2, 2, 2])).toEqual([[0, 1], [2, 3]])
  })

  it('ignores cuts at 0 and past the last page', () => {
    // A cut at 0 would mint an empty first document; a cut past the end would
    // mint an empty last one. Both arrive for real after a half-successful
    // save shrinks the page list under the cuts.
    expect(planSplit(3, [0, 1, 3, 9, -2])).toEqual([[0], [1, 2]])
  })

  it('sorts cuts that arrive out of order', () => {
    expect(planSplit(4, [3, 1])).toEqual([[0], [1, 2], [3]])
  })

  it('has nothing to group when there are no pages', () => {
    expect(planSplit(0, [1])).toEqual([])
  })
})

describe('toggleCut', () => {
  it('adds a cut, keeping the list sorted', () => {
    expect(toggleCut([1, 5], 3)).toEqual([1, 3, 5])
  })

  it('removes a cut that is already there', () => {
    expect(toggleCut([1, 3, 5], 3)).toEqual([1, 5])
  })

  it('never mutates the array it was handed', () => {
    const cuts = [1, 5]
    toggleCut(cuts, 3)
    expect(cuts).toEqual([1, 5])
  })
})

describe('everyNCuts', () => {
  it('cuts after every page', () => {
    expect(everyNCuts(4, 1)).toEqual([1, 2, 3])
  })

  it('cuts after every second page', () => {
    expect(everyNCuts(5, 2)).toEqual([2, 4])
  })

  it('never cuts past the last page', () => {
    expect(everyNCuts(4, 2)).toEqual([2])
  })

  it('returns nothing for a nonsensical size', () => {
    expect(everyNCuts(4, 0)).toEqual([])
  })
})

describe('boundaryCuts', () => {
  it('rebuilds the cuts that separate a list of groups', () => {
    // What a half-successful save needs: the groups that failed become the new
    // page list, so their boundaries have to be renumbered from zero.
    expect(boundaryCuts([[1, 2], [3], [4, 5, 6]])).toEqual([2, 3])
  })

  it('has no boundary for a single group', () => {
    expect(boundaryCuts([[1, 2]])).toEqual([])
  })

  it('has no boundary for no groups at all', () => {
    expect(boundaryCuts([])).toEqual([])
  })
})

describe('splitTitles', () => {
  it('numbers every document from the one name typed', () => {
    expect(splitTitles('Kwitansi', 3)).toEqual(['Kwitansi (1)', 'Kwitansi (2)', 'Kwitansi (3)'])
  })

  it('trims the name before numbering it', () => {
    expect(splitTitles('  Kwitansi  ', 2)).toEqual(['Kwitansi (1)', 'Kwitansi (2)'])
  })

  it('leaves an empty name undefined so storage falls back to "Scan <tanggal>"', () => {
    expect(splitTitles('   ', 2)).toEqual([undefined, undefined])
  })

  it('does not number a lone document', () => {
    expect(splitTitles('Kwitansi', 1)).toEqual(['Kwitansi'])
  })

  it('continues the numbering after a partial save', () => {
    expect(splitTitles('Kwitansi', 2, 5)).toEqual(['Kwitansi (6)', 'Kwitansi (7)'])
  })
})

describe('canSplitScan', () => {
  it('lets Pro split into several documents', () => {
    expect(canSplitScan('pro', 6)).toBe(true)
  })

  it('refuses Basic more than one document', () => {
    expect(canSplitScan('basic', 2)).toBe(false)
  })

  it('lets Basic through when it is really just an ordinary save', () => {
    // Splitting into one document is what the Simpan button next door already
    // does for free. Refusing it would be a bug wearing the clothes of a rule.
    expect(canSplitScan('basic', 1)).toBe(true)
  })
})
