import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { DocumentsScreen } from './DocumentsScreen'
import type { DocumentEntry } from '../lib/documentEntries'
import { LONG_PRESS_MS } from '../lib/documentSelection'
import type { LocalScanDocument } from '../lib/scanIndexMigration'

function local(id: string, title: string): DocumentEntry {
  const document: LocalScanDocument = {
    schemaVersion: 5,
    id,
    title,
    createdAt: '2026-08-25T00:00:00.000Z',
    pageCount: 2,
    pages: [{ original: `${id}/page-1.jpg` }, { original: `${id}/page-2.jpg` }],
  }
  return { kind: 'local', id, document }
}

function cloud(id: string, title: string): DocumentEntry {
  return {
    kind: 'cloud',
    id,
    backup: {
      id,
      title,
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
      pageCount: 3,
      sizeBytes: 2048,
    },
  }
}

const entries = [local('a', 'Kwitansi Agustus'), cloud('b', 'Kontrak Lama')]

async function renderScreen(overrides: Partial<Parameters<typeof DocumentsScreen>[0]> = {}) {
  return await render(
    <DocumentsScreen
      entries={entries}
      tier="pro"
      restoringId={null}
      isRestoringAll={false}
      selectMode={false}
      selectedIds={[]}
      isBatchBusy={false}
      onDelete={() => {}}
      onOpen={() => {}}
      onRestore={() => {}}
      onRestoreAll={() => {}}
      onMerge={() => {}}
      onEnterSelect={() => {}}
      onToggleSelect={() => {}}
      onToggleSelectAll={() => {}}
      onExitSelect={() => {}}
      onBatchExport={() => {}}
      onBatchDelete={() => {}}
      onNotice={() => {}}
      {...overrides}
    />,
  )
}

/** Holds a finger on the row long enough for the long press to fire. */
async function longPress(element: Element) {
  element.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }),
  )
  await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 120))
  element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 }))
}

describe('entering select mode', () => {
  it('enters on a long press of a local document', async () => {
    const onEnterSelect = vi.fn()
    const screen = await renderScreen({ onEnterSelect })

    await longPress(screen.getByText('Kwitansi Agustus').element())

    expect(onEnterSelect).toHaveBeenCalledWith('a')
  })

  /**
   * The bug this locks out. A long press is followed by a real `click` from
   * the same finger — without swallowing it, selecting a document also opened
   * it, and the user landed on the detail screen instead of a selection.
   */
  it('swallows the click that follows the press, so the document does not open', async () => {
    const onOpen = vi.fn()
    const screen = await renderScreen({ onOpen })
    const row = screen.getByText('Kwitansi Agustus').element()

    await longPress(row)
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('opens the document on a plain tap, with no long press involved', async () => {
    const onOpen = vi.fn()
    const screen = await renderScreen({ onOpen })

    await screen.getByText('Kwitansi Agustus').click()

    expect(onOpen).toHaveBeenCalledWith('a')
  })

  /** A cloud row has no pages on this phone, so there is nothing to act on. */
  it('says why a cloud row cannot be selected instead of doing nothing', async () => {
    const onEnterSelect = vi.fn()
    const onNotice = vi.fn()
    const screen = await renderScreen({ onEnterSelect, onNotice })

    await longPress(screen.getByText('Kontrak Lama').element())

    expect(onEnterSelect).not.toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledWith('Pulihkan dulu ke HP sebelum bisa dipilih.')
  })

  /**
   * Switching tabs mid-press unmounts this screen before the timer fires.
   * Without a cleanup, the pending timeout survives the unmount and calls
   * `onEnterSelect` afterwards — re-entering select mode after `App.tsx`'s
   * tab-change effect already exited it.
   */
  it('does not enter select mode if the screen unmounts mid-press', async () => {
    const onEnterSelect = vi.fn()
    const screen = await renderScreen({ onEnterSelect })
    const row = screen.getByText('Kwitansi Agustus').element()

    row.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }),
    )
    await screen.unmount()
    await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 120))

    expect(onEnterSelect).not.toHaveBeenCalled()
  })
})

describe('the action bar', () => {
  it('stays hidden while nothing is selected', async () => {
    const screen = await renderScreen({ selectMode: true, selectedIds: [] })

    expect(screen.container.querySelector('.select-bar')).toBeNull()
  })

  it('counts what is selected', async () => {
    const screen = await renderScreen({ selectMode: true, selectedIds: ['a'] })

    await expect.element(screen.getByText('1 dipilih · 2 halaman')).toBeVisible()
  })

  it('exports when Pro asks it to', async () => {
    const onBatchExport = vi.fn()
    const screen = await renderScreen({
      selectMode: true,
      selectedIds: ['a'],
      onBatchExport,
    })

    await screen.getByRole('button', { name: /Ekspor PDF/ }).click()

    expect(onBatchExport).toHaveBeenCalledTimes(1)
  })

  /**
   * Batch export stopped being Pro on 25 Agustus 2026 (Boss Ali). This used to
   * send Basic to the paywall instead, so the regression is worth a test.
   */
  it('lets Basic export in bulk', async () => {
    const onBatchExport = vi.fn()
    const screen = await renderScreen({
      tier: 'basic',
      selectMode: true,
      selectedIds: ['a'],
      onBatchExport,
    })

    await screen.getByRole('button', { name: /Ekspor PDF/ }).click()

    expect(onBatchExport).toHaveBeenCalledTimes(1)
  })

  /**
   * Ten documents is ten taps without this, which is the complaint it answers
   * (Boss Ali, 25 Agustus 2026). The cloud row must stay out of it: there are
   * no page files for it on this phone, so it can never be part of a batch.
   */
  it('ticks every local document at once, and leaves the cloud row alone', async () => {
    const onToggleSelectAll = vi.fn()
    const screen = await renderScreen({ selectMode: true, onToggleSelectAll })

    await screen.getByRole('button', { name: 'Semua', exact: true }).click()

    expect(onToggleSelectAll).toHaveBeenCalledTimes(1)
  })

  /** The one button changes its name rather than sitting there already spent. */
  it('offers Kosongkan once everything selectable is ticked', async () => {
    const screen = await renderScreen({ selectMode: true, selectedIds: ['a'] })

    await expect.element(screen.getByRole('button', { name: 'Kosongkan' })).toBeInTheDocument()
  })

  /** Tidying up your own documents is not something Pro has to buy. */
  it('lets Basic delete in bulk', async () => {
    const onBatchDelete = vi.fn()
    const screen = await renderScreen({
      tier: 'basic',
      selectMode: true,
      selectedIds: ['a'],
      onBatchDelete,
    })

    await screen.getByRole('button', { name: /Hapus/ }).click()

    expect(onBatchDelete).toHaveBeenCalledTimes(1)
  })

  it('leaves select mode on Batal', async () => {
    const onExitSelect = vi.fn()
    const screen = await renderScreen({ selectMode: true, selectedIds: ['a'], onExitSelect })

    await screen.getByRole('button', { name: 'Batal' }).click()

    expect(onExitSelect).toHaveBeenCalledTimes(1)
  })

  it('toggles a row instead of opening it while selecting', async () => {
    const onToggleSelect = vi.fn()
    const onOpen = vi.fn()
    const screen = await renderScreen({
      selectMode: true,
      selectedIds: [],
      onToggleSelect,
      onOpen,
    })

    await screen.getByText('Kwitansi Agustus').click()

    expect(onToggleSelect).toHaveBeenCalledWith('a')
    expect(onOpen).not.toHaveBeenCalled()
  })
})
