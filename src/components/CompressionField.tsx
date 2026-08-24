import type { CSSProperties } from 'react'
import {
  canChooseCompression,
  COMPRESSION_HINTS,
  COMPRESSION_LABELS,
  COMPRESSION_LEVELS,
  resolveCompressionLevel,
  type CompressionLevel,
} from '../lib/exportLimits'
import type { Tier } from '../lib/tier'

interface CompressionFieldProps {
  tier: Tier
  level: CompressionLevel
  isBusy: boolean
  onLevelChange: (level: CompressionLevel) => void
  onUpgrade: () => void
}

/**
 * The four-stop quality slider, shared by the single-document export sheet and
 * the batch one so the two can never drift apart.
 */
export function CompressionField({
  tier,
  level,
  isBusy,
  onLevelChange,
  onUpgrade,
}: CompressionFieldProps) {
  const canChoose = canChooseCompression(tier)
  /*
    Shown through the same gate the export runs through. A remembered 'max'
    outlives the Pro subscription that chose it — and another account on the
    same phone inherits it — so displaying the stored value raw would label the
    slider "Maksimal" while the file, and the estimate beside it, came out at
    Standar.
  */
  const effective = resolveCompressionLevel(tier, level)
  const position = COMPRESSION_LEVELS.indexOf(effective)

  return (
    <div className="export-quality">
      <div className="export-quality__head">
        <strong>Kualitas</strong>
        <span className="export-quality__value">{COMPRESSION_LABELS[effective]}</span>
      </div>

      {/*
        `--fill` colours the track up to the thumb: a uniformly grey bar
        reads as a setting that is off rather than one sitting at a level.
      */}
      <input
        type="range"
        className="export-quality__slider"
        min={0}
        max={COMPRESSION_LEVELS.length - 1}
        step={1}
        value={position}
        disabled={!canChoose || isBusy}
        onChange={(event) => onLevelChange(COMPRESSION_LEVELS[Number(event.target.value)])}
        aria-label="Kualitas ekspor"
        aria-valuetext={COMPRESSION_LABELS[effective]}
        style={
          {
            '--fill': `${(position / (COMPRESSION_LEVELS.length - 1)) * 100}%`,
          } as CSSProperties
        }
      />

      <div className="export-quality__ticks" aria-hidden="true">
        {COMPRESSION_LEVELS.map((step) => (
          <span
            key={step}
            className={`export-quality__tick${step === effective ? ' export-quality__tick--on' : ''}`}
          >
            {COMPRESSION_LABELS[step]}
          </span>
        ))}
      </div>

      <p className="export-quality__hint">{COMPRESSION_HINTS[effective]}</p>

      {/*
        Basic sees the real control rather than a hidden one, so the thing
        Pro buys is visible instead of merely described.
      */}
      {!canChoose && (
        <button
          type="button"
          className="export-quality__lock"
          onClick={onUpgrade}
          disabled={isBusy}
        >
          <span className="pro-badge">Pro</span>
          Atur sendiri kualitas & ukuran berkas
        </button>
      )}
    </div>
  )
}
