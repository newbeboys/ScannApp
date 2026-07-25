import { DocumentScanner } from '@capacitor-mlkit/document-scanner'

export interface DocumentScanFailure {
  reason: 'cancelled' | 'error'
  message?: string
}

export type DocumentScanOutcome = string[] | DocumentScanFailure

/**
 * Opens the ML Kit document scanner UI (camera, crop, multi-page) and
 * returns the captured page image URIs. Android only — see
 * @capacitor-mlkit/document-scanner, which has no web/iOS implementation.
 */
export async function scanDocument(): Promise<DocumentScanOutcome> {
  try {
    const result = await DocumentScanner.scanDocument({
      resultFormats: 'JPEG',
      scannerMode: 'FULL',
      galleryImportAllowed: true,
    })

    if (!result.scannedImages || result.scannedImages.length === 0) {
      return { reason: 'cancelled' }
    }

    return result.scannedImages
  } catch (error) {
    return {
      reason: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
