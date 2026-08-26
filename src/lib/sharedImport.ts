import { Capacitor, registerPlugin } from '@capacitor/core'

/** Shape of the event the native SharedImportPlugin sends. See spec §6 for what skippedCount covers. */
interface SharedFilesReceivedEvent {
  paths: string[]
  skippedCount: number
}

interface SharedImportNative {
  addListener(
    eventName: 'sharedFilesReceived',
    listener: (event: SharedFilesReceivedEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>
}

// Android-only, same as documentScanner.ts states in its own comment: there
// is no web or iOS implementation, so no `web` fallback is registered here.
const SharedImportNative = registerPlugin<SharedImportNative>('SharedImport')

export interface SharedImportResult {
  images: string[]
  skippedCount: number
}

/**
 * Registers a listener for files shared in from other apps via the Android
 * share sheet (see SharedImportPlugin.java). No-ops on web/iOS.
 *
 * The native side sends this event with `retainUntilConsumed: true`, so a
 * listener registered here also receives a share that arrived before it was
 * attached -- e.g. the app being opened cold by a share. There is no
 * separate pull method to call.
 *
 * Returns a function that unregisters the listener.
 */
export function onSharedFilesReceived(
  callback: (result: SharedImportResult) => void,
): () => void {
  if (!Capacitor.isNativePlatform()) {
    return () => {}
  }

  const handlePromise = SharedImportNative.addListener('sharedFilesReceived', (event) => {
    const paths = Array.isArray(event?.paths) ? event.paths : []
    callback({
      images: paths.map((path) => Capacitor.convertFileSrc(path)),
      skippedCount: typeof event?.skippedCount === 'number' ? event.skippedCount : 0,
    })
  })

  // Attached immediately, not deferred into the returned closure: App.tsx
  // registers this once on mount and never calls the unsubscribe function
  // during normal operation, so if native registration itself fails, this
  // must not surface as an unhandled promise rejection while nobody has
  // called unsubscribe yet.
  handlePromise.catch(() => {})

  return () => {
    void handlePromise.then((handle) => handle.remove())
  }
}
