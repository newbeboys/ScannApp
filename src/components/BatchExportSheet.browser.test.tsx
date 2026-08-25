import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { BatchExportSheet } from './BatchExportSheet'

async function renderSheet(overrides: Partial<Parameters<typeof BatchExportSheet>[0]> = {}) {
  return await render(
    <BatchExportSheet
      count={3}
      pageCount={17}
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

/**
 * Both gates on this sheet came off on 25 Agustus 2026: batch export itself
 * first, then the quality control inside it. The sheet no longer knows what
 * tier is looking at it, so what is left to prove is that nothing Pro-shaped
 * survived — a locked row that opened a paywall, or a slider that refused.
 */
describe('BatchExportSheet after the tier gates came off', () => {
  it('offers no Pro lock over the quality control', async () => {
    const screen = await renderSheet()

    await expect
      .element(screen.getByRole('button', { name: /Atur sendiri kualitas/ }))
      .not.toBeInTheDocument()
  })

  it('leaves the quality slider usable', async () => {
    const screen = await renderSheet()

    await expect.element(screen.getByRole('slider')).toBeEnabled()
  })
})
