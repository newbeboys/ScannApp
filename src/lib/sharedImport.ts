import { Capacitor, registerPlugin } from '@capacitor/core'

/** Shape of the event the native SharedImportPlugin sends. See spec §6 for what skippedCount covers. */
interface SharedFilesReceivedEvent {
  paths: string[]
  skippedCount: number
}

/** Shape of what the native plugin's pickFiles() call resolves to -- same shape as the event above. */
interface PickFilesResult {
  paths: string[]
  skippedCount: number
}

interface SharedImportNative {
  addListener(
    eventName: 'sharedFilesReceived',
    listener: (event: SharedFilesReceivedEvent) => void,
  ): Promise<{ remove: () => Promise<void> }>
  pickFiles(): Promise<PickFilesResult>
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
    // .then() here creates its own promise, separate from handlePromise --
    // the .catch() above only marks handlePromise itself as handled, so this
    // needs its own rejection handler too, or a native registration failure
    // becomes a second unhandled rejection the moment unsubscribe runs
    // (React StrictMode's mount/unmount/remount in dev), caught in review.
    void handlePromise.then((handle) => handle.remove()).catch(() => {})
  }
}

/**
 * Opens the system file picker (Storage Access Framework), letting the user
 * pick images and/or PDFs from local folders or any cloud provider
 * registered as a document provider (Google Drive, Dropbox, etc). No-ops on
 * web/iOS, resolving to an empty result rather than throwing -- picking a
 * file is not possible there, but the button that calls this should not have
 * to special-case the platform itself.
 *
 * Resolves once, when the user finishes with the picker -- including when
 * they cancel it, which resolves to an empty result rather than rejecting
 * (spec §5).
 */
export async function pickFiles(): Promise<SharedImportResult> {
  if (!Capacitor.isNativePlatform()) {
    return { images: [], skippedCount: 0 }
  }

  const { paths, skippedCount } = await SharedImportNative.pickFiles()
  return {
    images: paths.map((path) => Capacitor.convertFileSrc(path)),
    skippedCount,
  }
}
