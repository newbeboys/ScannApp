import { describe, expect, it } from 'vitest'
import { limitRows } from './upgradeLedger'

/**
 * The paywall may only sell what the app actually does. Every row here was
 * added the day the thing behind it shipped, and three rows were *removed*
 * across August as Boss Ali moved reorder, filters, PNG, annotation, split and
 * batch export out to every tier. This test is the reminder that the ledger is
 * a claim about the product, not decoration.
 */
describe('upgrade ledger', () => {
  it('sells the four limits Pro has always lifted', () => {
    const labels = limitRows('yearly').map((row) => row.label)

    expect(labels).toEqual(
      expect.arrayContaining([
        'Halaman per dokumen gabungan',
        'Penyimpanan cadangan cloud',
        'Iklan',
        'Watermark di PDF',
      ]),
    )
  })

  it('sells OCR now that it exists', () => {
    const row = limitRows('yearly').find((entry) => entry.label === 'Teks dokumen')

    expect(row?.basic).toBe('Tidak bisa dicari')
    expect(row?.pro).toBe('PDF bisa dicari & Word')
  })

  it('quotes the storage of the plan the user is looking at', () => {
    const yearly = limitRows('yearly').find((row) => row.label === 'Penyimpanan cadangan cloud')
    const monthly = limitRows('monthly').find((row) => row.label === 'Penyimpanan cadangan cloud')

    expect(yearly?.pro).not.toBe(monthly?.pro)
  })
})
