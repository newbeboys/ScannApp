import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { DeleteAccountSheet } from './DeleteAccountSheet'

async function renderSheet(overrides: Partial<Parameters<typeof DeleteAccountSheet>[0]> = {}) {
  return await render(
    <DeleteAccountSheet
      requiresSubscriptionCancel={false}
      isBusy={false}
      error={null}
      onConfirm={() => {}}
      onClose={() => {}}
      {...overrides}
    />,
  )
}

describe('DeleteAccountSheet', () => {
  it('spells out the grace period, so nobody reads this as instant', async () => {
    const screen = await renderSheet()

    await expect.element(screen.getByText('7 hari')).toBeVisible()
  })

  it('says the cloud backups go, and that the phone keeps its copies', async () => {
    const screen = await renderSheet()

    await expect.element(screen.getByText('semua cadangan di cloud')).toBeVisible()
    await expect.element(screen.getByText('tidak ikut terhapus')).toBeVisible()
  })

  /**
   * The Play Store warning is conditional because it is only true for a paying
   * plan. Showing it to a Basic — or referral-Pro — user would send them
   * hunting for a subscription that does not exist.
   */
  it('warns a paying subscriber to cancel in Play Store first', async () => {
    const screen = await renderSheet({ requiresSubscriptionCancel: true })

    await expect.element(screen.getByText('Batalkan dulu di Play Store')).toBeVisible()
  })

  it('says nothing about Play Store when there is no subscription to cancel', async () => {
    const screen = await renderSheet({ requiresSubscriptionCancel: false })

    expect(screen.container.textContent).not.toContain('Play Store')
  })

  it('confirms only when the destructive button is pressed', async () => {
    const onConfirm = vi.fn()
    const screen = await renderSheet({ onConfirm })

    await screen.getByRole('button', { name: 'Hapus akun saya' }).click()

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('closes without deleting anything from Batal', async () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    const screen = await renderSheet({ onClose, onConfirm })

    await screen.getByRole('button', { name: 'Batal' }).click()

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  /**
   * A second tap while the first request is in flight would raise a second
   * grace period — and the server answers the repeat with the *original*
   * date, so the two would disagree about when the account goes.
   */
  it('cannot be confirmed twice while a request is in flight', async () => {
    const screen = await renderSheet({ isBusy: true })

    await expect.element(screen.getByRole('button', { name: 'Memproses…' })).toBeDisabled()
    await expect.element(screen.getByRole('button', { name: 'Batal' })).toBeDisabled()
  })

  /**
   * Kept in the sheet rather than in a toast: the refusal names the steps to
   * cancel a subscription, and a toast slides away mid-sentence.
   */
  it('shows the server refusal in place, next to the button that caused it', async () => {
    const screen = await renderSheet({
      error: 'Langganan Pro kamu masih aktif. Batalkan dulu langganannya di Play Store',
    })

    await expect
      .element(screen.getByText(/Langganan Pro kamu masih aktif/))
      .toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Hapus akun saya' })).toBeEnabled()
  })
})
