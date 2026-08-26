import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ExportSheet } from './ExportSheet'

async function renderSheet(overrides: Partial<Parameters<typeof ExportSheet>[0]> = {}) {
  return await render(
    <ExportSheet
      pageCount={3}
      tier="pro"
      isBusy={false}
      level="standard"
      destination="share"
      hasText={true}
      estimate={{ pdf: 2_400_000, jpg: 2_100_000, png: 24_000_000, docx: 41_984 }}
      onLevelChange={() => {}}
      onDestinationChange={() => {}}
      onExport={() => {}}
      onRecognizeText={() => {}}
      onClose={() => {}}
      {...overrides}
    />,
  )
}

describe('ExportSheet — Word', () => {
  it('offers Word alongside the three formats that were already there', async () => {
    const screen = await renderSheet()

    for (const name of [/^PDF/, /^JPG/, /^PNG/, /^Word/]) {
      await expect.element(screen.getByRole('button', { name })).toBeVisible()
    }
  })

  /**
   * Shown without the "≈" the image formats carry: a text-only file is built
   * for real to measure it, so this number is the file, not a projection.
   */
  it('shows the measured size, not an approximation', async () => {
    const screen = await renderSheet()

    // 41 x 1024: formatBytes counts in KiB, so this reads back as a whole number.
    await expect.element(screen.getByText('41 KB')).toBeVisible()
  })

  it('exports when the document has been recognised', async () => {
    const onExport = vi.fn()
    const screen = await renderSheet({ onExport })

    await screen.getByRole('button', { name: /^Word/ }).click()

    expect(onExport).toHaveBeenCalledWith('docx')
  })

  /**
   * A dead entry would read as a broken app. With no text there is nothing to
   * put in a Word file, so the row offers the one thing that would fix that.
   */
  it('offers to read the document instead of exporting nothing', async () => {
    const onExport = vi.fn()
    const onRecognizeText = vi.fn()
    const screen = await renderSheet({
      hasText: false,
      estimate: { pdf: 2_400_000, jpg: 2_100_000, png: 24_000_000, docx: null },
      onExport,
      onRecognizeText,
    })

    await expect.element(screen.getByText('Kenali teks dokumen dulu')).toBeVisible()
    await screen.getByRole('button', { name: /^Word/ }).click()

    expect(onRecognizeText).toHaveBeenCalledOnce()
    expect(onExport).not.toHaveBeenCalled()
  })

  it('locks Word along with everything else while an export runs', async () => {
    const screen = await renderSheet({ isBusy: true })

    await expect.element(screen.getByRole('button', { name: /^Word/ })).toBeDisabled()
  })

  it('still exports the other three formats', async () => {
    const onExport = vi.fn()
    const screen = await renderSheet({ onExport })

    await screen.getByRole('button', { name: /^PDF/ }).click()

    expect(onExport).toHaveBeenCalledWith('pdf')
  })
})

describe('ExportSheet — tujuan ekspor', () => {
  it('offers both destinations and marks the chosen one', async () => {
    const screen = await renderSheet({ destination: 'share' })

    await expect.element(screen.getByRole('radio', { name: 'Bagikan' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect.element(screen.getByRole('radio', { name: 'Simpan ke HP' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('reports the choice rather than acting on it itself', async () => {
    const onDestinationChange = vi.fn()
    const screen = await renderSheet({ onDestinationChange })

    await screen.getByRole('radio', { name: 'Simpan ke HP' }).click()

    expect(onDestinationChange).toHaveBeenCalledWith('device')
  })

  /**
   * The two options differ in what happens when the user changes their mind
   * halfway, which is the whole reason this control exists. A label alone
   * would leave that invisible until it surprised someone.
   */
  it('says what happens on a cancel while sharing', async () => {
    const screen = await renderSheet({ destination: 'share' })

    await expect
      .element(screen.getByText(/tidak ada berkas yang tertinggal di HP/i))
      .toBeVisible()
  })

  it('says where a saved file goes', async () => {
    const screen = await renderSheet({ destination: 'device' })

    await expect.element(screen.getByText(/folder Documents/i)).toBeVisible()
  })

  /** Every choice has to be made before a format is tapped, because that exports. */
  it('locks the destination while an export is running', async () => {
    const screen = await renderSheet({ isBusy: true })

    await expect.element(screen.getByRole('radio', { name: 'Simpan ke HP' })).toBeDisabled()
  })
})
