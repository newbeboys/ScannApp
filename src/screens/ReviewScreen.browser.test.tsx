import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ReviewScreen } from './ReviewScreen'

async function renderScreen(overrides: Partial<Parameters<typeof ReviewScreen>[0]> = {}) {
  return await render(
    <ReviewScreen
      pages={['uri-1', 'uri-2', 'uri-3']}
      currentIndex={0}
      tier="pro"
      isBusy={false}
      onSelectPage={() => {}}
      onPreview={() => {}}
      onRemovePage={() => {}}
      onAddPages={() => {}}
      onCancel={() => {}}
      onSave={() => {}}
      onSplit={() => {}}
      onUpgrade={() => {}}
      {...overrides}
    />,
  )
}

describe('the split button', () => {
  it('opens the split screen for Pro', async () => {
    const onSplit = vi.fn()
    const onUpgrade = vi.fn()
    const screen = await renderScreen({ onSplit, onUpgrade })

    await screen.getByRole('button', { name: /Pisah jadi Beberapa Dokumen/ }).click()

    expect(onSplit).toHaveBeenCalled()
    expect(onUpgrade).not.toHaveBeenCalled()
  })

  it('sends Basic to the paywall instead of a dead screen', async () => {
    const onSplit = vi.fn()
    const onUpgrade = vi.fn()
    const screen = await renderScreen({ tier: 'basic', onSplit, onUpgrade })

    await screen.getByRole('button', { name: /Pisah jadi Beberapa Dokumen/ }).click()

    expect(onUpgrade).toHaveBeenCalled()
    expect(onSplit).not.toHaveBeenCalled()
  })

  it('is not offered at all for a single page', async () => {
    // Splitting one page into several documents is not a thing.
    const screen = await renderScreen({ pages: ['uri-1'] })

    await expect
      .element(screen.getByRole('button', { name: /Pisah jadi Beberapa Dokumen/ }))
      .not.toBeInTheDocument()
  })

  it('still saves the whole scan as one document', async () => {
    const onSave = vi.fn()
    const screen = await renderScreen({ onSave })

    await screen.getByRole('button', { name: 'Simpan Dokumen (3 halaman)' }).click()

    expect(onSave).toHaveBeenCalled()
  })
})
