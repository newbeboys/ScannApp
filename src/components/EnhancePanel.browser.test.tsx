import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { EnhancePanel } from './EnhancePanel'

async function renderPanel(overrides: Partial<Parameters<typeof EnhancePanel>[0]> = {}) {
  return await render(
    <EnhancePanel
      enabled={false}
      enhancedCount={0}
      total={20}
      progress={null}
      isBusy={false}
      onToggle={() => {}}
      onCancel={() => {}}
      {...overrides}
    />,
  )
}

/**
 * Every query for the "Aktif" option asks for an exact name: accessible-name
 * matching is substring-based by default, and "Aktif" is inside "Nonaktif".
 */
describe('EnhancePanel', () => {
  it('shows which state the document is in', async () => {
    const screen = await renderPanel({ enabled: true, enhancedCount: 20 })

    await expect
      .element(screen.getByRole('button', { name: 'Aktif', exact: true }))
      .toBeVisible()
  })

  it('asks the caller to switch it on', async () => {
    const onToggle = vi.fn()
    const screen = await renderPanel({ onToggle })

    await screen.getByRole('button', { name: 'Aktif', exact: true }).click()

    expect(onToggle).toHaveBeenCalledWith(true)
  })

  /** The same lesson as FilterPicker: a live control during a render starts a second one. */
  it('locks both options while a run is in flight', async () => {
    const screen = await renderPanel({ isBusy: true, progress: { done: 3, total: 20 } })

    await expect
      .element(screen.getByRole('button', { name: 'Aktif', exact: true }))
      .toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Nonaktif' })).toBeDisabled()
  })

  it('reports progress and offers a way out of a long run', async () => {
    const onCancel = vi.fn()
    const screen = await renderPanel({ isBusy: true, progress: { done: 3, total: 20 }, onCancel })

    await expect.element(screen.getByText('Memperbaiki halaman 3 dari 20…')).toBeVisible()
    await screen.getByRole('button', { name: 'Batal' }).click()

    expect(onCancel).toHaveBeenCalled()
  })

  /**
   * What is left after a cancelled run, and it has to be legible: the switch
   * says on, but only part of the document has been through.
   */
  it('says how far a half-finished document got, and offers to continue', async () => {
    const screen = await renderPanel({ enabled: true, enhancedCount: 12 })

    await expect.element(screen.getByText('12 dari 20 halaman diperbaiki')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Lanjutkan' })).toBeVisible()
  })

  it('offers no Lanjutkan when the document is complete', async () => {
    const screen = await renderPanel({ enabled: true, enhancedCount: 20 })

    expect(screen.container.textContent).not.toContain('Lanjutkan')
  })

  /**
   * A binding decision, guarded by a test because the way it gets broken is one
   * word slipped into copy during a redesign: this feature is deterministic
   * maths and must never be presented as AI (CLAUDE.md Bagian 6). The name "AI
   * Enhance" belongs to the TFLite version.
   */
  it('never presents itself as AI', async () => {
    const screen = await renderPanel({ enabled: true, enhancedCount: 12 })

    expect(screen.container.textContent).not.toMatch(/\bAI\b/i)
    expect(screen.container.textContent).toContain('Perbaiki Pencahayaan')
  })

  /** Every tier. No badge, no upgrade path — see the design doc header. */
  it('shows no Pro badge', async () => {
    const screen = await renderPanel()

    expect(screen.container.textContent).not.toContain('Pro')
  })
})
