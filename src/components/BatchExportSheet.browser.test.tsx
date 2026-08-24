import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { BatchExportSheet } from './BatchExportSheet'

async function renderSheet(overrides: Partial<Parameters<typeof BatchExportSheet>[0]> = {}) {
  return await render(
    <BatchExportSheet
      count={3}
      pageCount={17}
      tier="pro"
      level="standard"
      progress={null}
      isBusy={false}
      onLevelChange={() => {}}
      onExport={() => {}}
      onStop={() => {}}
      onClose={() => {}}
      {...overrides}
    />,
  )
}

describe('BatchExportSheet before it runs', () => {
  it('says how much is about to be exported', async () => {
    const screen = await renderSheet()

    await expect.element(screen.getByText('3 dokumen · 17 halaman')).toBeVisible()
  })

  it('exports when asked', async () => {
    const onExport = vi.fn()
    const screen = await renderSheet({ onExport })

    await screen.getByRole('button', { name: 'Ekspor 3 PDF' }).click()

    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('offers no stop button while nothing is running', async () => {
    const screen = await renderSheet()

    expect(screen.container.querySelector('[data-testid="batch-stop"]')).toBeNull()
  })
})

describe('BatchExportSheet while it runs', () => {
  it('names the document it is on and how far along it is', async () => {
    const screen = await renderSheet({
      isBusy: true,
      progress: { index: 1, total: 3, title: 'Kontrak Sewa' },
    })

    await expect.element(screen.getByText('Kontrak Sewa')).toBeVisible()
    await expect.element(screen.getByText('2 dari 3')).toBeVisible()
  })

  it('swaps the export button for a stop button', async () => {
    const onStop = vi.fn()
    const screen = await renderSheet({
      isBusy: true,
      progress: { index: 0, total: 3, title: 'A' },
      onStop,
    })

    await screen.getByRole('button', { name: 'Hentikan' }).click()

    expect(onStop).toHaveBeenCalledTimes(1)
    expect(screen.container.querySelector('[data-testid="batch-export"]')).toBeNull()
  })

  /**
   * Closing mid-run would leave the run going with nothing on screen to stop
   * it, and the toast would arrive over an unrelated screen.
   */
  it('locks the close button so a run cannot be abandoned', async () => {
    const screen = await renderSheet({
      isBusy: true,
      progress: { index: 0, total: 3, title: 'A' },
    })

    await expect.element(screen.getByRole('button', { name: 'Tutup' })).toBeDisabled()
  })
})

describe('BatchExportSheet for a Basic account', () => {
  /**
   * The button that opened this sheet is gated, but the slider inside it is a
   * second gate on a different thing — quality control, which Basic never gets.
   */
  it('shows the Pro lock on the quality control', async () => {
    const screen = await renderSheet({ tier: 'basic' })

    await expect
      .element(screen.getByRole('button', { name: /Atur sendiri kualitas/ }))
      .toBeVisible()
  })
})
