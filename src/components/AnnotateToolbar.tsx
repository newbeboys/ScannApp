import type { CSSProperties } from 'react'
import { INK_COLORS, INK_WIDTHS, type InkColorId, type InkWidth } from '../lib/annotations'
import type { AnnotateTool } from './AnnotateOverlay'
import { CheckIcon, PencilIcon, SignatureIcon, TrashIcon, UndoIcon } from './Icons'

interface AnnotateToolbarProps {
  tool: AnnotateTool
  color: InkColorId
  width: InkWidth
  markCount: number
  isBusy: boolean
  hasChanges: boolean
  onToolChange: (tool: AnnotateTool) => void
  onColorChange: (color: InkColorId) => void
  onWidthChange: (width: InkWidth) => void
  onSignature: () => void
  onUndo: () => void
  onClear: () => void
  onSave: () => void
}

const TOOLS: { id: AnnotateTool; label: string }[] = [
  { id: 'pen', label: 'Pena' },
  { id: 'highlighter', label: 'Stabilo' },
  { id: 'move', label: 'Geser' },
]

const WIDTHS: { id: InkWidth; label: string }[] = [
  { id: 'thin', label: 'Tipis' },
  { id: 'medium', label: 'Sedang' },
  { id: 'thick', label: 'Tebal' },
]

export function AnnotateToolbar({
  tool,
  color,
  width,
  markCount,
  isBusy,
  hasChanges,
  onToolChange,
  onColorChange,
  onWidthChange,
  onSignature,
  onUndo,
  onClear,
  onSave,
}: AnnotateToolbarProps) {
  return (
    <div className="annotate-tools">
      <div className="filter-chips" role="group" aria-label="Alat">
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`filter-chip${tool === entry.id ? ' filter-chip--active' : ''}`}
            onClick={() => onToolChange(entry.id)}
            disabled={isBusy}
            aria-pressed={tool === entry.id}
          >
            {entry.label}
          </button>
        ))}
        <button
          type="button"
          className="filter-chip filter-chip--icon"
          onClick={onSignature}
          disabled={isBusy}
          aria-label="Tambah tanda tangan"
        >
          <SignatureIcon size={16} />
          <span>Tanda tangan</span>
        </button>
      </div>

      {/* Only the ink tools have a colour and a nib; 'Geser' has neither. */}
      {tool !== 'move' && (
        <div className="annotate-tools__ink">
          <div className="ink-colors" role="group" aria-label="Warna tinta">
            {INK_COLORS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`ink-color${color === entry.id ? ' ink-color--active' : ''}`}
                style={{ background: entry.value }}
                onClick={() => onColorChange(entry.id)}
                disabled={isBusy}
                aria-label={entry.label}
                aria-pressed={color === entry.id}
              />
            ))}
          </div>

          <div className="filter-chips" role="group" aria-label="Ketebalan">
            {WIDTHS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`filter-chip filter-chip--nib${width === entry.id ? ' filter-chip--active' : ''}`}
                onClick={() => onWidthChange(entry.id)}
                disabled={isBusy}
                aria-pressed={width === entry.id}
                // Dots the size of the actual nib, so the labels are a
                // description rather than the only clue.
                style={{ '--nib': `${INK_WIDTHS[entry.id] * 900}px` } as CSSProperties}
              >
                <span className="filter-chip__nib" />
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="editor-actions">
        <button
          type="button"
          className="button"
          onClick={onUndo}
          disabled={isBusy || markCount === 0}
        >
          <UndoIcon size={17} />
          <span>Urungkan</span>
        </button>
        <button
          type="button"
          className="button"
          onClick={onClear}
          disabled={isBusy || markCount === 0}
        >
          <TrashIcon size={17} />
          <span>Hapus</span>
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={onSave}
          disabled={isBusy || !hasChanges}
        >
          {isBusy ? <PencilIcon size={17} /> : <CheckIcon size={17} />}
          <span>{isBusy ? 'Menerapkan…' : 'Simpan'}</span>
        </button>
      </div>
    </div>
  )
}
