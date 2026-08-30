import type { ExportDestination } from '../lib/exportShare'

interface DestinationFieldProps {
  destination: ExportDestination
  isBusy: boolean
  onDestinationChange: (destination: ExportDestination) => void
}

const DESTINATIONS: { id: ExportDestination; label: string; hint: string }[] = [
  {
    id: 'share',
    label: 'Bagikan',
    hint: 'Kirim ke WhatsApp, email, atau aplikasi lain. Kalau dibatalkan, tidak ada berkas yang tertinggal di HP.',
  },
  {
    id: 'device',
    label: 'Simpan ke HP',
    hint: 'Masuk ke folder Documents dan bisa dibuka lewat file manager. Berkas lama dengan nama sama tidak ditimpa.',
  },
]

/**
 * Where an export goes, shared by both export sheets so the two cannot drift.
 *
 * Sits above the formats for the same reason the quality control does: in the
 * single-document sheet, tapping a format exports straight away, so every
 * choice has to already be made by then.
 *
 * The hint under it is not filler. The two options differ in what happens when
 * the user changes their mind halfway, and that is the whole reason this
 * control exists (Boss Ali, 26 Agustus 2026) — a label alone would leave the
 * difference invisible until it surprised someone.
 */
export function DestinationField({
  destination,
  isBusy,
  onDestinationChange,
}: DestinationFieldProps) {
  const chosen = DESTINATIONS.find((option) => option.id === destination) ?? DESTINATIONS[0]

  return (
    <div className="sheet-field">
      <strong className="sheet-field__label">Tujuan</strong>

      <div className="format-switch" role="radiogroup" aria-label="Tujuan ekspor">
        {DESTINATIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={destination === option.id}
            className={`format-switch__option${
              destination === option.id ? ' format-switch__option--active' : ''
            }`}
            disabled={isBusy}
            onClick={() => onDestinationChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className="sheet-field__hint">{chosen.hint}</p>
    </div>
  )
}
