import { useEffect, useState } from 'react'
import { getScanPageDisplayUri } from './scanStorage'

/**
 * Resolves a stored page into something an `<img>` can load.
 *
 * `PageImage` is the usual way to show a page, but the full-screen viewer owns
 * its own `<img>` — it attaches a ref for measuring and a transform for the
 * zoom, neither of which fits behind that component. Both go through this.
 *
 * `raw` is for URIs coming straight out of `scanDocument()`, which are already
 * displayable; stored paths still need resolving.
 */
export function usePageDisplayUri(source: string, raw = false): string | null {
  const [src, setSrc] = useState<string | null>(raw ? source : null)

  useEffect(() => {
    if (raw) {
      setSrc(source)
      return
    }
    let cancelled = false
    getScanPageDisplayUri(source).then((uri) => {
      if (!cancelled) setSrc(uri)
    })
    return () => {
      cancelled = true
    }
  }, [source, raw])

  return src
}
