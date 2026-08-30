import { useEffect } from 'react'

const LOCK_CLASS = 'scroll-locked'

/**
 * How many sheets are open right now.
 *
 * Counted rather than a plain flag, because sheets do stack: the signature pad
 * opens on top of the annotate tools, and unsetting a flag when the inner one
 * closes would release the page while the outer one is still covering it.
 */
let locks = 0

/**
 * Freezes whatever is scrolling behind a sheet for as long as it is mounted.
 *
 * A `position: fixed` backdrop covers the screen but does not own the gesture.
 * A finger dragging across it still scrolls the nearest scrollable ancestor —
 * `.app__body` in the tabs, the document itself in the full-screen flows — so
 * the list slid around behind an open sheet on the phone even though nothing
 * on screen could be touched (dilaporkan dari HP, 25 Agustus 2026).
 *
 * Done with a class rather than an inline style so the two scrollers are named
 * once, in CSS, next to the rules that made them scrollers in the first place.
 * `overflow: hidden` keeps the scroll position, so nothing jumps when the sheet
 * closes again.
 */
export function useScrollLock(): void {
  useEffect(() => {
    locks++
    document.body.classList.add(LOCK_CLASS)

    return () => {
      locks = Math.max(0, locks - 1)
      if (locks === 0) document.body.classList.remove(LOCK_CLASS)
    }
  }, [])
}
