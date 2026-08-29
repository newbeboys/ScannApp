import type { CSSProperties } from 'react'
import {
  COMPRESSION_HINTS,
  COMPRESSION_LABELS,
  COMPRESSION_LEVELS,
  resolveCompressionLevel,
  type CompressionLevel,
} from '../lib/exportLimits'

interface CompressionFieldProps {
  level: CompressionLevel
  isBusy: boolean
  onLevelChange: (level: CompressionLevel) => void
}

/**
 * The four-stop quality slider, shared by the single-document export sheet and
 * the batch one so the two can never drift apart.
 *
 * Open to every tier since 25 Agustus 2026. The locked row that used to sit
 * under it — a "Pro" badge over "Atur sendiri kualitas & ukuran berkas" — went
 * with the gate, along with the `tier` and `onUpgrade` props that existed only
 * to draw it.
 */
export function CompressionField({ level, isBusy, onLevelChange }: CompressionFieldProps) {
  /*
    Still resolved rather than shown raw: the level comes back from
    `localStorage`, so it can be a value this build has never heard of, and the
    slider must not label itself with something the file will not come out at.
  */
  const effective = resolveCompressionLevel(level)
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
        disabled={isBusy}
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
    </div>
  )
}
