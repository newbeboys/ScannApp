import { useEffect, useState } from 'react'
import type { Mark } from './annotations'
import { getScanPageDisplayUri } from './scanStorage'

/**
 * Display URLs for every signature the given marks refer to, keyed by path.
 *
 * The annotate overlay draws stamps live, before anything has been rendered
 * into the page, so it needs the signature files themselves. Usually there is
 * exactly one — but a document signed over several months can carry stamps
 * made from different files (see the design doc, Bagian 2.4), so this resolves
 * whatever set is actually present rather than assuming a single current one.
 */
export function useSignatureUris(marks: Mark[]): Record<string, string> {
  const [uris, setUris] = useState<Record<string, string>>({})

  // Joined into a string so the effect re-runs when the *set* of signatures
  // changes, not on every stroke — `marks` is a new array after each one.
  const paths = [
    ...new Set(marks.filter((mark) => mark.kind === 'signature').map((mark) => mark.source)),
  ]
  const key = paths.join('|')

  useEffect(() => {
    if (key === '') {
      setUris({})
      return
    }

    let cancelled = false
    Promise.all(
      key.split('|').map(async (path) => [path, await getScanPageDisplayUri(path)] as const),
    )
      .then((entries) => {
        if (!cancelled) setUris(Object.fromEntries(entries))
      })
      .catch(() => {
        // A missing signature file just renders as nothing here, the same way
        // it is skipped by the final render.
      })

    return () => {
      cancelled = true
    }
  }, [key])

  return uris
}
