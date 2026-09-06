import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { AccountDeletionBanner } from './AccountDeletionBanner'

const DAY = 86_400_000

/** An ISO timestamp `days` days in the past. */
function requestedDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString()
}

async function renderBanner(overrides: Partial<Parameters<typeof AccountDeletionBanner>[0]> = {}) {
  return await render(
    <AccountDeletionBanner
      requestedAt={requestedDaysAgo(0)}
      isBusy={false}
      onCancel={() => {}}
      {...overrides}
    />,
  )
}

describe('AccountDeletionBanner', () => {
  it('counts down from the full grace period', async () => {
    const screen = await renderBanner()

    await expect.element(screen.getByText('Akun ini akan dihapus permanen dalam 7 hari.')).toBeVisible()
  })

  it('says besok on the last full day', async () => {
    const screen = await renderBanner({ requestedAt: requestedDaysAgo(6) })

    await expect.element(screen.getByText('Akun ini akan dihapus permanen besok.')).toBeVisible()
  })

  it('carries the way out, not just the warning', async () => {
    const onCancel = vi.fn()
    const screen = await renderBanner({ onCancel })

    await screen.getByRole('button', { name: 'Batalkan' }).click()

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('cannot be cancelled twice at once', async () => {
    const screen = await renderBanner({ isBusy: true })

    await expect.element(screen.getByRole('button', { name: 'Membatalkan…' })).toBeDisabled()
  })

  /**
   * A profile cached by an older build has no timestamp to read. Rendering
   * "dalam NaN hari" over every tab would be worse than rendering nothing.
   */
  it('renders nothing at all for a timestamp it cannot read', async () => {
    const screen = await renderBanner({ requestedAt: 'entah kapan' })

    expect(screen.container.textContent).toBe('')
  })
})
