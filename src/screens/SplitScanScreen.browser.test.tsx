import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { SplitScanScreen } from './SplitScanScreen'

const pages = ['uri-1', 'uri-2', 'uri-3', 'uri-4']

async function renderScreen(overrides: Partial<Parameters<typeof SplitScanScreen>[0]> = {}) {
  return await render(
    <SplitScanScreen
      pages={pages}
      cuts={[]}
      name=""
      startAt={0}
      isBusy={false}
      progress={null}
      onCutsChange={() => {}}
      onNameChange={() => {}}
      onBack={() => {}}
      onSave={() => {}}
      {...overrides}
    />,
  )
}

describe('ready-made patterns', () => {
  it('fills a cut after every page', async () => {
    const onCutsChange = vi.fn()
    const screen = await renderScreen({ onCutsChange })

    await screen.getByRole('button', { name: 'Tiap 1 halaman' }).click()

    expect(onCutsChange).toHaveBeenCalledWith([1, 2, 3])
  })

  it('fills a cut after every second page', async () => {
    const onCutsChange = vi.fn()
    const screen = await renderScreen({ onCutsChange })

    await screen.getByRole('button', { name: 'Tiap 2 halaman' }).click()

    expect(onCutsChange).toHaveBeenCalledWith([2])
  })

  it('clears every cut', async () => {
    const onCutsChange = vi.fn()
    const screen = await renderScreen({ cuts: [1, 2, 3], onCutsChange })

    await screen.getByRole('button', { name: 'Bersihkan pemisah' }).click()

    expect(onCutsChange).toHaveBeenCalledWith([])
  })
})

describe('adjusting cuts by hand', () => {
  it('adds a cut where there is none', async () => {
    const onCutsChange = vi.fn()
    const screen = await renderScreen({ cuts: [1], onCutsChange })

    await screen.getByRole('button', { name: 'Pisah antara halaman 3 dan 4' }).click()

    expect(onCutsChange).toHaveBeenCalledWith([1, 3])
  })

  it('removes a cut that is already there', async () => {
    const onCutsChange = vi.fn()
    const screen = await renderScreen({ cuts: [1, 3], onCutsChange })

    await screen.getByRole('button', { name: 'Gabungkan halaman 3 dan 4' }).click()

    expect(onCutsChange).toHaveBeenCalledWith([1])
  })
})

describe('what the screen says', () => {
  it('counts the documents the cuts produce', async () => {
    const screen = await renderScreen({ cuts: [1, 2, 3] })

    await expect.element(screen.getByText('4 halaman → 4 dokumen')).toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Simpan 4 Dokumen' }))
      .toBeInTheDocument()
  })

  it('counts one document when nothing is cut', async () => {
    const screen = await renderScreen({ cuts: [] })

    await expect.element(screen.getByText('4 halaman → 1 dokumen')).toBeInTheDocument()
  })

  it('previews the numbered name on each group header', async () => {
    const screen = await renderScreen({ cuts: [2], name: 'Kwitansi' })

    await expect.element(screen.getByText('Dokumen 1 — Kwitansi (1)')).toBeInTheDocument()
    await expect.element(screen.getByText('Dokumen 2 — Kwitansi (2)')).toBeInTheDocument()
  })

  it('continues the numbering after a partial save, instead of promising "(1)" again', async () => {
    // The retry really saves as "Kwitansi (4)" and "(5)" — `saveSplitScan` gets
    // the same `startAt`. A header that still said "(1)" would be a preview of
    // something that is never going to happen.
    const screen = await renderScreen({ cuts: [2], name: 'Kwitansi', startAt: 3 })

    await expect.element(screen.getByText('Dokumen 4 — Kwitansi (4)')).toBeInTheDocument()
    await expect.element(screen.getByText('Dokumen 5 — Kwitansi (5)')).toBeInTheDocument()
  })

  it('closes the list, so the separator the last page never had does not read as a hidden one', async () => {
    // Reported from the phone: scrolled to the bottom, the run of separators
    // simply stops, and the reader concludes the last one is behind the save
    // button. Both halves are asserted — the closing line, and that there
    // really are only three separators for four pages.
    const screen = await renderScreen({ cuts: [1, 2, 3] })

    await expect
      .element(
        screen.getByText('Halaman terakhir. Pemisah hanya bisa dipasang di antara dua halaman.'),
      )
      .toBeInTheDocument()
    expect(document.querySelectorAll('.split-cut')).toHaveLength(pages.length - 1)
  })

  it('shows how far a running save has got', async () => {
    const screen = await renderScreen({ isBusy: true, progress: { done: 2, total: 5 } })

    await expect.element(screen.getByText('Menyimpan… 2 dari 5')).toBeInTheDocument()
  })
})

describe('saving', () => {
  it('hands over the groups the cuts describe, as page URIs', async () => {
    const onSave = vi.fn()
    const screen = await renderScreen({ cuts: [1, 3], onSave })

    await screen.getByRole('button', { name: 'Simpan 3 Dokumen' }).click()

    // Page indices, not the pages themselves: the screen serves both the scan
    // split (scanner URIs) and the document split (stored paths), so turning
    // indices into pages is the caller's job.
    expect(onSave).toHaveBeenCalledWith([[0], [1, 2], [3]])
  })

  it('is shut while a save is running, so nothing is saved twice', async () => {
    // Asserted as "disabled" rather than by clicking it: a forced click on a
    // disabled button proves whatever the driver happens to do with one,
    // whereas the attribute is the thing that actually stops a second save.
    const screen = await renderScreen({ isBusy: true, progress: { done: 1, total: 3 } })

    await expect.element(screen.getByRole('button', { name: 'Menyimpan…' })).toBeDisabled()
  })
})
