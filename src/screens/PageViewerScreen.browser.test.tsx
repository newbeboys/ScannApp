import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { PageViewerScreen } from './PageViewerScreen'

/**
 * A 1x1 GIF, one per page so each `<img>` has a distinct src to assert on.
 * `raw` is passed throughout so nothing here reaches Capacitor's Filesystem —
 * the point of these tests is the viewer's own behaviour, not page storage.
 */
function pages(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) =>
      `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#${index}`,
  )
}

async function renderViewer(count: number, initialIndex = 0) {
  return await render(
    <PageViewerScreen
      title="Nota Belanja"
      sources={pages(count)}
      raw
      initialIndex={initialIndex}
      onClose={() => {}}
    />,
  )
}

describe('PageViewerScreen', () => {
  it('opens on the page that was tapped, not on page one', async () => {
    const screen = await renderViewer(6, 3)

    await expect.element(screen.getByText('4/6')).toBeVisible()
    await expect.element(screen.getByAltText('Halaman 4')).toBeVisible()
  })

  /**
   * The memory guard, and the reason `isPageMounted` exists. Scanned pages are
   * 12 MP JPEGs; a 40-page document with every page in the DOM is gigabytes of
   * decoded bitmap. Only the page on screen and its two neighbours are real.
   */
  it('keeps only three pages in the DOM however long the document is', async () => {
    const screen = await renderViewer(40, 20)

    const images = screen.container.querySelectorAll('.viewer__image, .viewer__placeholder')
    expect(images).toHaveLength(3)

    await expect.element(screen.getByAltText('Halaman 20')).toBeInTheDocument()
    await expect.element(screen.getByAltText('Halaman 21')).toBeInTheDocument()
    await expect.element(screen.getByAltText('Halaman 22')).toBeInTheDocument()
    expect(screen.container.querySelector('img[alt="Halaman 24"]')).toBeNull()
  })

  it('steps forward and back with the arrow buttons', async () => {
    const screen = await renderViewer(3)

    await screen.getByRole('button', { name: 'Halaman berikutnya' }).click()
    await expect.element(screen.getByText('2/3')).toBeVisible()

    await screen.getByRole('button', { name: 'Halaman sebelumnya' }).click()
    await expect.element(screen.getByText('1/3')).toBeVisible()
  })

  it('cannot step past either end of the document', async () => {
    const screen = await renderViewer(2)

    await expect.element(screen.getByRole('button', { name: 'Halaman sebelumnya' })).toBeDisabled()

    await screen.getByRole('button', { name: 'Halaman berikutnya' }).click()
    await expect.element(screen.getByText('2/2')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Halaman berikutnya' })).toBeDisabled()
  })

  it('jumps straight to a page from the strip', async () => {
    const screen = await renderViewer(8)

    await screen.getByRole('button', { name: 'Ke halaman 6' }).click()

    await expect.element(screen.getByText('6/8')).toBeVisible()
    await expect.element(screen.getByAltText('Halaman 6')).toBeInTheDocument()
  })

  /**
   * A single page has nothing to swipe to, so neither the arrows nor the strip
   * should take up room — and an arrow that can never be pressed is worse than
   * no arrow at all.
   */
  it('hides the paging controls for a one-page document', async () => {
    const screen = await renderViewer(1)

    expect(screen.container.querySelector('.viewer__step')).toBeNull()
    expect(screen.container.querySelector('.viewer__page-dot')).toBeNull()
    await expect.element(screen.getByText('1/1')).toBeVisible()
  })

  it('starts with its bars showing', async () => {
    const screen = await renderViewer(4)

    expect(screen.container.querySelector('.viewer--immersive')).toBeNull()
    await expect.element(screen.getByRole('button', { name: 'Tutup pratinjau' })).toBeVisible()
  })

  /*
    No test drives a tap on the page itself. Playwright refuses to click
    anything inside `position: fixed` here — it reports the element as "outside
    of the viewport" because the screen is fixed to the test iframe rather than
    to the page Playwright is measuring. That is a harness limitation, not
    something about this screen; the gesture reading underneath it is covered
    by `pageViewer.test.ts`, and the one regression that mattered is below.
  */

  /**
   * The bug this locks out. The arrows sit inside the gesture surface, and the
   * surface used to capture every pointer that landed on it — which retargeted
   * the pointerup away from the button, so the click never fired and the press
   * was read as a tap instead, hiding the arrow the user had just pressed.
   */
  it('pressing an arrow pages the document instead of hiding the bars', async () => {
    const screen = await renderViewer(4)

    await screen.getByRole('button', { name: 'Halaman berikutnya' }).click()

    await expect.element(screen.getByText('2/4')).toBeVisible()
    expect(screen.container.querySelector('.viewer--immersive')).toBeNull()
  })
})
