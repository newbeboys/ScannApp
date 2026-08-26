import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { BatchExportSheet } from './BatchExportSheet'

async function renderSheet(overrides: Partial<Parameters<typeof BatchExportSheet>[0]> = {}) {
  return await render(
    <BatchExportSheet
      count={3}
      pageCount={17}
      level="standard"
      destination="share"
      progress={null}
      isBusy={false}
      onLevelChange={() => {}}
      onDestinationChange={() => {}}
      onExport={() => {}}
      onStop={() => {}}
      onClose={() => {}}
      {...overrides}
    />,
  )
}

describe('BatchExportSheet before it runs', () => {
  it('says how much is about to be exported', async () => {
    const screen = await renderSheet()

    await expect.element(screen.getByText('3 dokumen · 17 halaman')).toBeVisible()
  })

  it('exports when asked', async () => {
    const onExport = vi.fn()
    const screen = await renderSheet({ onExport })

    await screen.getByRole('button', { name: 'Ekspor 3 PDF' }).click()

    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('offers no stop button while nothing is running', async () => {
    const screen = await renderSheet()

    expect(screen.container.querySelector('[data-testid="batch-stop"]')).toBeNull()
  })
})

describe('BatchExportSheet while it runs', () => {
  it('names the document it is on and how far along it is', async () => {
    const screen = await renderSheet({
      isBusy: true,
      progress: { index: 1, total: 3, title: 'Kontrak Sewa' },
    })

    await expect.element(screen.getByText('Kontrak Sewa')).toBeVisible()
    await expect.element(screen.getByText('2 dari 3')).toBeVisible()
  })

  it('swaps the export button for a stop button', async () => {
    const onStop = vi.fn()
    const screen = await renderSheet({
      isBusy: true,
      progress: { index: 0, total: 3, title: 'A' },
      onStop,
    })

    await screen.getByRole('button', { name: 'Hentikan' }).click()

    expect(onStop).toHaveBeenCalledTimes(1)
    expect(screen.container.querySelector('[data-testid="batch-export"]')).toBeNull()
  })

  /**
   * Closing mid-run would leave the run going with nothing on screen to stop
   * it, and the toast would arrive over an unrelated screen.
   */
  it('locks the close button so a run cannot be abandoned', async () => {
    const screen = await renderSheet({
      isBusy: true,
      progress: { index: 0, total: 3, title: 'A' },
    })

    await expect.element(screen.getByRole('button', { name: 'Tutup' })).toBeDisabled()
  })
})

/**
 * Both gates on this sheet came off on 25 Agustus 2026: batch export itself
 * first, then the quality control inside it. The sheet no longer knows what
 * tier is looking at it, so what is left to prove is that nothing Pro-shaped
 * survived — a locked row that opened a paywall, or a slider that refused.
 */
describe('BatchExportSheet after the tier gates came off', () => {
  it('offers no Pro lock over the quality control', async () => {
    const screen = await renderSheet()

    await expect
      .element(screen.getByRole('button', { name: /Atur sendiri kualitas/ }))
      .not.toBeInTheDocument()
  })

  it('leaves the quality slider usable', async () => {
    const screen = await renderSheet()

    await expect.element(screen.getByRole('slider')).toBeEnabled()
  })
})

describe('BatchExportSheet — memilih PDF atau Word', () => {
  it('berangkat dari PDF, format yang selalu bisa dipakai', async () => {
    const screen = await renderSheet()

    await expect.element(screen.getByRole('radio', { name: 'PDF' })).toBeChecked()
    await expect.element(screen.getByTestId('batch-export')).toHaveTextContent('Ekspor 3 PDF')
  })

  it('mengganti tujuan ekspor ke Word', async () => {
    const onExport = vi.fn()
    const screen = await renderSheet({ onExport })

    await screen.getByRole('radio', { name: 'Word' }).click()
    await expect.element(screen.getByTestId('batch-export')).toHaveTextContent('Ekspor 3 Word')
    await screen.getByTestId('batch-export').click()

    expect(onExport).toHaveBeenCalledWith('docx')
  })

  it('tetap mengirim pdf kalau pilihannya tidak disentuh', async () => {
    const onExport = vi.fn()
    const screen = await renderSheet({ onExport })

    await screen.getByTestId('batch-export').click()

    expect(onExport).toHaveBeenCalledWith('pdf')
  })

  /**
   * Tidak ada gambar di dalam berkas Word, jadi menampilkan kontrol mutu di
   * sebelahnya itu menjanjikan pengaruh yang tidak ada. Beda dengan lembar
   * satu-dokumen, yang tidak punya keadaan "terpilih" untuk ditanggapi.
   */
  it('menyembunyikan kontrol mutu saat Word dipilih', async () => {
    const screen = await renderSheet()

    await expect.element(screen.getByText('Kualitas')).toBeVisible()
    await screen.getByRole('radio', { name: 'Word' }).click()

    await expect.element(screen.getByText('Kualitas')).not.toBeInTheDocument()
  })

  it('memberitahu bahwa dokumen yang belum dikenali akan dilewati', async () => {
    const screen = await renderSheet()

    await screen.getByRole('radio', { name: 'Word' }).click()

    await expect
      .element(screen.getByText(/belum dikenali teksnya akan dilewati/i))
      .toBeVisible()
  })

  it('mengunci pilihan format selama ekspor berjalan', async () => {
    const screen = await renderSheet({ isBusy: true })

    await expect.element(screen.getByRole('radio', { name: 'Word' })).toBeDisabled()
  })
})

describe('BatchExportSheet — tujuan ekspor', () => {
  it('reports the choice rather than acting on it itself', async () => {
    const onDestinationChange = vi.fn()
    const screen = await renderSheet({ onDestinationChange })

    await screen.getByRole('radio', { name: 'Simpan ke HP' }).click()

    expect(onDestinationChange).toHaveBeenCalledWith('device')
  })

  /**
   * Two segmented controls stacked one above the other: without names on both,
   * neither says which question it is answering.
   */
  it('names both switches', async () => {
    const screen = await renderSheet()

    await expect.element(screen.getByText('Format')).toBeVisible()
    await expect.element(screen.getByText('Tujuan')).toBeVisible()
  })

  it('promises a single share sheet at the end when sharing', async () => {
    const screen = await renderSheet({ destination: 'share' })

    await expect.element(screen.getByText(/satu layar berbagi di akhir/i)).toBeVisible()
  })

  it('drops that promise when the files are only being saved', async () => {
    const screen = await renderSheet({ destination: 'device' })

    await expect.element(screen.getByText(/satu layar berbagi di akhir/i)).not.toBeInTheDocument()
  })
})
