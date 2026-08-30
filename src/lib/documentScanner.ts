import { Capacitor } from '@capacitor/core'
import { DocumentScanner } from '@capacitor-mlkit/document-scanner'
import { resumeTracker } from './ads/appOpenGate'

export interface DocumentScanFailure {
  reason: 'cancelled' | 'error'
  message?: string
}

export type DocumentScanOutcome = string[] | DocumentScanFailure

/**
 * Opens the ML Kit document scanner UI (camera, crop, multi-page) and
 * returns the captured page image URIs. Android only — see
 * @capacitor-mlkit/document-scanner, which has no web/iOS implementation.
 *
 * The URIs are converted here, at the boundary where they enter the app, so no
 * caller downstream ever handles a raw one. The plugin hands back the value of
 * `page.getImageUri()`, which is a `file://` URI into the app's own cache. The
 * webview runs on the `https://localhost` origin and cannot touch that scheme
 * at all: `<img src>` renders a broken-image icon and `fetch()` rejects with
 * "Failed to fetch". convertFileSrc rewrites it to
 * `https://localhost/_capacitor_file_/...`, which Capacitor's own asset loader
 * serves, so both work. It also covers `content://` URIs, and leaves anything
 * already converted untouched — so it is safe to apply more than once.
 */
export async function scanDocument(): Promise<DocumentScanOutcome> {
  // The scanner is a separate activity, so the WebView sees the app get
  // backgrounded and come back — indistinguishable from the user stepping out
  // to another app unless we say so. Without this, finishing a scan would be
  // met with a full-screen App Open ad every single time.
  resumeTracker.leaveForOwnFlow()

  try {
    const result = await DocumentScanner.scanDocument({
      resultFormats: 'JPEG',
      scannerMode: 'FULL',
      galleryImportAllowed: true,
    })

    if (!result.scannedImages || result.scannedImages.length === 0) {
      return { reason: 'cancelled' }
    }

    return result.scannedImages.map((uri) => Capacitor.convertFileSrc(uri))
  } catch (error) {
    return {
      reason: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
