import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { OcrRow } from './OcrRow'

async function renderRow(overrides: Partial<Parameters<typeof OcrRow>[0]> = {}) {
  return await render(
    <OcrRow
      tier="pro"
      recognized={0}
      total={4}
      progress={null}
      onRecognize={() => {}}
      onUpgrade={() => {}}
      {...overrides}
    />,
  )
}

describe('OcrRow', () => {
  it('offers to read the document when nothing has been recognised', async () => {
    const screen = await renderRow()

    await expect.element(screen.getByRole('button', { name: 'Kenali Teks' })).toBeEnabled()
  })

  /**
   * Half-done is the normal state after leaving mid-run or cropping one page,
   * so the row says which it is instead of rounding to "done" or "not started".
   */
  it('says how far it got when only some pages have text', async () => {
    const screen = await renderRow({ recognized: 3 })

    await expect.element(screen.getByText('3 dari 4 halaman dikenali')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Kenali Sisanya' })).toBeVisible()
  })

  it('offers a re-read once every page has text', async () => {
    const screen = await renderRow({ recognized: 4 })

    await expect.element(screen.getByText('Teks dikenali · 4 halaman')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Kenali Ulang' })).toBeVisible()
  })

  it('reports which page it is on while running', async () => {
    const screen = await renderRow({ progress: { done: 2, total: 4 } })

    await expect.element(screen.getByText('Membaca halaman 2 dari 4…')).toBeVisible()
  })

  /**
   * A second tap would start a second pass over pages the first is still
   * writing — the same shape of bug the filter chips had in Fase 6 bagian 2.
   */
  it('cannot be started twice at once', async () => {
    const screen = await renderRow({ progress: { done: 1, total: 4 } })

    await expect.element(screen.getByRole('button', { name: /Kenali/ })).toBeDisabled()
  })

  /**
   * OCR is the engine Pro sells. Basic sees the door and what is behind it
   * rather than a button that silently does nothing.
   */
  it('sends a Basic account to the upgrade screen instead of running', async () => {
    const onRecognize = vi.fn()
    const onUpgrade = vi.fn()
    const screen = await renderRow({ tier: 'basic', onRecognize, onUpgrade })

    await screen.getByRole('button', { name: /Kenali Teks/ }).click()

    expect(onUpgrade).toHaveBeenCalledOnce()
    expect(onRecognize).not.toHaveBeenCalled()
  })

  it('marks the row as Pro for a Basic account', async () => {
    const screen = await renderRow({ tier: 'basic' })

    await expect.element(screen.getByText('Pro')).toBeVisible()
  })

  it('does not nag a Pro account with a Pro badge', async () => {
    const screen = await renderRow({ tier: 'pro' })

    await expect.element(screen.getByText('Pro')).not.toBeInTheDocument()
  })

  it('runs when a Pro account taps it', async () => {
    const onRecognize = vi.fn()
    const screen = await renderRow({ onRecognize })

    await screen.getByRole('button', { name: 'Kenali Teks' }).click()

    expect(onRecognize).toHaveBeenCalledOnce()
  })
})
