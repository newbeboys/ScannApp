/**
 * Filename maths, kept apart from `exportShare` on purpose.
 *
 * Both functions here are pure string work, but `exportShare` imports
 * Capacitor — leaving them there would make every naming test drag mocks for
 * the Filesystem and Share plugins along with it.
 */

/**
 * Strips characters Android/Windows reject in filenames.
 *
 * The control characters go with them. Newline, tab and carriage return were
 * already collapsed by the whitespace pass below, but the rest of C0 — a NUL
 * above all — survived it and would have been handed straight to `open()`,
 * where a name is a C string and everything after the NUL simply stops
 * existing. No title in this app can hold one today; the point is that the
 * name this function returns is safe to write without the caller checking.
 */
export function toSafeFilename(title: string): string {
  const cleaned = title
    // eslint-disable-next-line no-control-regex -- the point of the line
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 0 ? cleaned.slice(0, 60) : 'Dokumen'
}

/**
 * Makes every name in a batch distinct, keeping the first occurrence as-is.
 *
 * `toSafeFilename` removes characters and truncates at 60, so two different
 * titles can arrive here identical. Writing both would overwrite the first and
 * hand the user fewer files than they selected, with nothing on screen saying
 * so.
 *
 * Comparison is case-insensitive because the filesystems this lands on are:
 * "Nota.pdf" and "NOTA.pdf" are one file on Android and on Windows.
 */
export function uniqueExportNames(names: string[]): string[] {
  const taken = new Set<string>()

  return names.map((name) => {
    if (!taken.has(name.toLowerCase())) {
      taken.add(name.toLowerCase())
      return name
    }

    // Counts past suffixes the batch already contains, so a list holding both
    // "Nota.pdf" and "Nota (2).pdf" mints "Nota (3).pdf" rather than a second
    // copy of a name that is already spoken for.
    let counter = 2
    let candidate = withSuffix(name, counter)
    while (taken.has(candidate.toLowerCase())) {
      counter++
      candidate = withSuffix(name, counter)
    }

    taken.add(candidate.toLowerCase())
    return candidate
  })
}

/**
 * The names to try for one file, in order, when the first one is unavailable.
 *
 * Lives here rather than in `exportShare` for the same reason the rest of this
 * file does: it is string arithmetic, and the one caller that needs it sits in
 * the module that cannot be tested without the Filesystem plugin.
 *
 * Bounded at 99. A folder already holding ninety-nine files of one name is a
 * situation to report, not one to keep grinding through a `stat` at a time.
 */
export function* exportNameCandidates(name: string): Generator<string> {
  yield name
  for (let counter = 2; counter <= 99; counter++) yield withSuffix(name, counter)
}

/** Inserts " (n)" before the extension, so the file still opens as its type. */
function withSuffix(name: string, counter: number): string {
  const dot = name.lastIndexOf('.')
  // `dot <= 0` covers both "no extension" and a leading-dot name, where
  // everything after the dot is the name rather than a suffix.
  return dot <= 0
    ? `${name} (${counter})`
    : `${name.slice(0, dot)} (${counter})${name.slice(dot)}`
}
