const UNITS = [
  { limit: 1024 * 1024 * 1024, suffix: 'GB' },
  { limit: 1024 * 1024, suffix: 'MB' },
  { limit: 1024, suffix: 'KB' },
] as const

/**
 * Human-readable size with an Indonesian decimal comma. Zero reads as "0 MB"
 * rather than "0 B" so the quota indicator keeps a steady unit at rest.
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'

  const unit = UNITS.find((candidate) => bytes >= candidate.limit) ?? UNITS[2]
  const value = bytes / unit.limit
  // One decimal is enough at every scale; whole numbers drop it entirely.
  const rounded = Math.round(value * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace('.', ',')

  return `${text} ${unit.suffix}`
}
