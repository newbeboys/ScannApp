import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { FilterPicker } from './FilterPicker'

async function renderPicker(overrides: Partial<Parameters<typeof FilterPicker>[0]> = {}) {
  return await render(
    <FilterPicker
      active={null}
      scope="document"
      isBusy={false}
      progress={null}
      pageNumber={1}
      onScopeChange={() => {}}
      onPick={() => {}}
      {...overrides}
    />,
  )
}

describe('FilterPicker while a render is running', () => {
  it('leaves the chips usable when nothing is happening', async () => {
    const screen = await renderPicker()

    await expect.element(screen.getByRole('button', { name: 'Hitam-Putih' })).toBeEnabled()
  })

  /**
   * The bug this locks out. The picker used to derive "busy" from `progress`
   * alone, and `progress` is only filled for a whole-document render — so
   * during a single-page one the chips stayed live. A second tap started a
   * second render that wrote the same derived file and the same index from an
   * already-stale document.
   */
  it('locks the chips during a single-page render, which reports no progress', async () => {
    const screen = await renderPicker({ isBusy: true, progress: null, scope: 'page' })

    await expect.element(screen.getByRole('button', { name: 'Hitam-Putih' })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Asli' })).toBeDisabled()
  })

  it('locks the scope switch too, so the scope cannot change mid-render', async () => {
    const screen = await renderPicker({ isBusy: true, progress: null })

    await expect.element(screen.getByRole('button', { name: 'Semua halaman' })).toBeDisabled()
  })

  it('still locks the chips during a whole-document render', async () => {
    const screen = await renderPicker({ isBusy: true, progress: { done: 3, total: 12 } })

    await expect.element(screen.getByRole('button', { name: 'Magic Color' })).toBeDisabled()
    await expect.element(screen.getByText(/3 dari 12 halaman/)).toBeVisible()
  })
})
