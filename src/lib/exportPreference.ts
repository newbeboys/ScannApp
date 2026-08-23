import {
  COMPRESSION_LEVELS,
  DEFAULT_COMPRESSION_LEVEL,
  type CompressionLevel,
} from './exportLimits'

const LEVEL_KEY = 'scannapp.export.level'

/**
 * The export quality the user last chose.
 *
 * Remembered rather than reset per export: someone who always wants the
 * smallest possible file should say so once, not on every share. Storage can
 * be unavailable (private mode, a WebView with data cleared) and the stored
 * text can be anything, so every failure path lands on the standard level —
 * the same one Basic gets, and the one every export used before Fase 6.
 */
export function readExportLevel(storage: Storage = localStorage): CompressionLevel {
  try {
    const stored = storage.getItem(LEVEL_KEY)
    return COMPRESSION_LEVELS.includes(stored as CompressionLevel)
      ? (stored as CompressionLevel)
      : DEFAULT_COMPRESSION_LEVEL
  } catch {
    return DEFAULT_COMPRESSION_LEVEL
  }
}

export function writeExportLevel(level: CompressionLevel, storage: Storage = localStorage): void {
  try {
    storage.setItem(LEVEL_KEY, level)
  } catch {
    // Remembering a preference is never worth failing an export over.
  }
}
