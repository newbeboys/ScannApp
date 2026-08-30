import {
  COMPRESSION_LEVELS,
  DEFAULT_COMPRESSION_LEVEL,
  type CompressionLevel,
} from './exportLimits'
import type { ExportDestination } from './exportShare'

const LEVEL_KEY = 'scannapp.export.level'
const DESTINATION_KEY = 'scannapp.export.destination'

const DESTINATIONS: ExportDestination[] = ['share', 'device']

/**
 * Sharing, unless the user has said otherwise.
 *
 * "Ekspor" opening a share sheet is what the button has always done, and it is
 * the destination that cannot leave anything behind when the user changes
 * their mind halfway. Someone who wants the file in their file manager instead
 * says so once and it is remembered.
 */
export const DEFAULT_DESTINATION: ExportDestination = 'share'

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

/** The destination the user last chose, with the same defensive posture as the level. */
export function readExportDestination(storage: Storage = localStorage): ExportDestination {
  try {
    const stored = storage.getItem(DESTINATION_KEY)
    return DESTINATIONS.includes(stored as ExportDestination)
      ? (stored as ExportDestination)
      : DEFAULT_DESTINATION
  } catch {
    return DEFAULT_DESTINATION
  }
}

export function writeExportDestination(
  destination: ExportDestination,
  storage: Storage = localStorage,
): void {
  try {
    storage.setItem(DESTINATION_KEY, destination)
  } catch {
    // Remembering a preference is never worth failing an export over.
  }
}
