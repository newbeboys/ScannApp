import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { StraightenScreen } from './StraightenScreen'

async function renderScreen(overrides: Partial<Parameters<typeof StraightenScreen>[0]> = {}) {
  return await render(
    <StraightenScreen
      pageUri="uri-1"
      pageNumber={1}
      pageCount={3}
      isBusy={false}
      onApply={() => {}}
      onSkip={() => {}}
      onCancelAll={() => {}}
      {...overrides}
    />,
  )
}

const DEFAULT_QUAD = {
  topLeft: { x: 0.05, y: 0.05 },
  topRight: { x: 0.95, y: 0.05 },
  bottomLeft: { x: 0.05, y: 0.95 },
  bottomRight: { x: 0.95, y: 0.95 },
}

describe('the straighten screen', () => {
  it('hands the untouched default quad to Luruskan when nothing was dragged', async () => {
    const onApply = vi.fn()
    const screen = await renderScreen({ onApply })

    await screen.getByRole('button', { name: 'Luruskan' }).click()

    expect(onApply).toHaveBeenCalledWith(DEFAULT_QUAD)
  })

  it('skips without applying anything', async () => {
    const onSkip = vi.fn()
    const onApply = vi.fn()
    const screen = await renderScreen({ onSkip, onApply })

    await screen.getByRole('button', { name: 'Lewati' }).click()

    expect(onSkip).toHaveBeenCalled()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('leaves the whole import through the back chevron', async () => {
    const onCancelAll = vi.fn()
    const screen = await renderScreen({ onCancelAll })

    await screen.getByRole('button', { name: 'Kembali' }).click()

    expect(onCancelAll).toHaveBeenCalled()
  })

  it('disables every button while busy', async () => {
    const screen = await renderScreen({ isBusy: true })

    await expect.element(screen.getByRole('button', { name: 'Lewati' })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Memproses…' })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Kembali' })).toBeDisabled()
  })

  it('shows the page position in the header', async () => {
    const screen = await renderScreen({ pageNumber: 2, pageCount: 5 })

    await expect.element(screen.getByText('Halaman 2 dari 5 · geser sudut untuk meluruskan')).toBeVisible()
  })
})
