import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { useScrollLock } from './useScrollLock'

/**
 * Runs in a real Chromium because what this hook does is put a class on the
 * real `document.body`. There is nothing to assert about it in a fake DOM that
 * would not just be asserting the fake.
 */
function Sheet({ label }: { label: string }) {
  useScrollLock()
  return <p>{label}</p>
}

const isLocked = () => document.body.classList.contains('scroll-locked')

afterEach(() => {
  // A test that failed mid-way must not leave the page locked for the next one.
  document.body.classList.remove('scroll-locked')
})

describe('useScrollLock', () => {
  it('locks the page while a sheet is on screen', async () => {
    const screen = await render(<Sheet label="Ekspor" />)

    expect(isLocked()).toBe(true)

    await screen.unmount()
    expect(isLocked()).toBe(false)
  })

  /**
   * Sheets do stack — the signature pad opens on top of the annotate tools —
   * and a plain flag would release the page as soon as the inner one closed,
   * putting the list back in motion behind a sheet that is still covering it.
   */
  it('stays locked until the last stacked sheet closes', async () => {
    const outer = await render(<Sheet label="Anotasi" />)
    const inner = await render(<Sheet label="Tanda tangan" />)

    await inner.unmount()
    expect(isLocked()).toBe(true)

    await outer.unmount()
    expect(isLocked()).toBe(false)
  })
})
