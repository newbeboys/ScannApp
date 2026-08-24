import { usePageDisplayUri } from '../lib/usePageDisplayUri'

interface PageImageProps {
  /** Stored page path (Directory.Data-relative), or a scanner URI from scanDocument(). */
  source: string
  /**
   * True for URIs coming straight out of scanDocument(), which are already
   * displayable because that function converts them (see the note there — a raw
   * `file://` URI renders as a broken image). Stored paths still need resolving.
   */
  raw?: boolean
  className?: string
  alt?: string
}

export function PageImage({ source, raw = false, className, alt = '' }: PageImageProps) {
  const src = usePageDisplayUri(source, raw)

  if (!src) return <div className={`page-image page-image--loading ${className ?? ''}`} />
  return (
    <img
      className={`page-image ${className ?? ''}`}
      src={src}
      alt={alt}
      /*
        Scanned pages are 12 MP JPEGs shown here at thumbnail size, and the
        document detail screen renders one per page — a 30-page document would
        decode 360 MP before the user has reached the second row. Both
        attributes keep that work off the first paint.
      */
      loading="lazy"
      decoding="async"
    />
  )
}
