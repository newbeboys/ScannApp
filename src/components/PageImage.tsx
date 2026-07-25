import { useEffect, useState } from 'react'
import { getScanPageDisplayUri } from '../lib/scanStorage'

interface PageImageProps {
  /** Stored page path (Directory.Data-relative) or a raw URI straight from the scanner. */
  source: string
  /** Scanner URIs are already displayable; stored paths need resolving first. */
  raw?: boolean
  className?: string
  alt?: string
}

export function PageImage({ source, raw = false, className, alt = '' }: PageImageProps) {
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

  if (!src) return <div className={`page-image page-image--loading ${className ?? ''}`} />
  return <img className={`page-image ${className ?? ''}`} src={src} alt={alt} />
}
