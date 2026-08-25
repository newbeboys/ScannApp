import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ReviewScreen } from './ReviewScreen'

async function renderScreen(overrides: Partial<Parameters<typeof ReviewScreen>[0]> = {}) {
  return await render(
    <ReviewScreen
      pages={['uri-1', 'uri-2', 'uri-3']}
      currentIndex={0}
      isBusy={false}
      onSelectPage={() => {}}
      onPreview={() => {}}
      onRemovePage={() => {}}
      onAddPages={() => {}}
      onCancel={() => {}}
      onSave={() => {}}
      onSplit={() => {}}
      {...overrides}
    />,
  )
}

describe('the split button', () => {
  /**
   * Splitting stopped being Pro on 25 Agustus 2026 (Boss Ali). There is no
   * paywall on this screen any more and no tier for it to depend on.
   */
  it('opens the split screen', async () => {
    const onSplit = vi.fn()
    const screen = await renderScreen({ onSplit })

    await screen.getByRole('button', { name: /Pisah jadi Beberapa Dokumen/ }).click()

    expect(onSplit).toHaveBeenCalled()
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
