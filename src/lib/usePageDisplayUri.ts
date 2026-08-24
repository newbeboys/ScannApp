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
    getScanPageDisplayUri(source)
      .then((uri) => {
        if (!cancelled) setSrc(uri)
      })
      .catch(() => {
        // A page whose file is gone — deleted out from under the index, a
        // stale path, or (in tests) a fixture that was never written to the
        // mocked filesystem — leaves nothing to display. Falling back to
        // `null` sends the caller (PageImage, the full-screen viewer) to its
        // loading placeholder rather than a broken object URL or a stale
        // image left over from before `source` changed. That is a more
        // honest result than a broken-image icon for a page the user has no
        // way to recover from mid-scroll, and it stops this rejection from
        // going unhandled.
        if (!cancelled) setSrc(null)
      })
    return () => {
      cancelled = true
    }
  }, [source, raw])

  return src
}
