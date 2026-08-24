import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { resumeTracker } from './ads/appOpenGate'
import { blobToBase64 } from './blobBase64'

export interface ExportFile {
  name: string
  blob: Blob
}

export interface DeliveryResult {
  /** Where the files ended up, for the confirmation toast. */
  message: string
}

/**
 * Public Documents needs WRITE_EXTERNAL_STORAGE only on Android 10 and
 * below; Android 11+ grants it implicitly. Failing to get it is not fatal
 * here — the write below will surface a clearer error if it truly can't
 * proceed.
 */
async function ensureStoragePermission(): Promise<void> {
  try {
    const status = await Filesystem.checkPermissions()
    if (status.publicStorage !== 'granted') {
      await Filesystem.requestPermissions()
    }
  } catch {
    // Plugin reports no permission model on this platform/API level.
  }
}

/**
 * Writes every file to the public Documents folder and returns the URI of
 * each, so a caller exporting many documents can save them one at a time and
 * open a single share sheet at the end rather than holding every blob in
 * memory at once.
 *
 * Returns an empty list on the web: a browser download has no URI anything
 * else could share.
 */
export async function writeExportFiles(files: ExportFile[]): Promise<string[]> {
  if (!Capacitor.isNativePlatform()) {
    downloadInBrowser(files)
    return []
  }

  await ensureStoragePermission()

  const uris: string[] = []
  for (const file of files) {
    await Filesystem.writeFile({
      path: file.name,
      directory: Directory.Documents,
      data: await blobToBase64(file.blob),
      recursive: true,
    })
    const { uri } = await Filesystem.getUri({
      path: file.name,
      directory: Directory.Documents,
    })
    uris.push(uri)
  }

  return uris
}

/**
 * Hands the saved files to another app. Never throws: by the time this runs
 * the files are already on disk, so a dismissed sheet is not a failed export.
 */
export async function shareFiles(uris: string[], title: string): Promise<void> {
  if (uris.length === 0) return

  try {
    // Sharing hands the user to another app; coming back from it is our doing,
    // not a return from elsewhere, so it must not earn an App Open ad.
    resumeTracker.leaveForOwnFlow()
    await Share.share({ title, files: uris })
  } catch {
    // Share sheet dismissed or unavailable — the saved files still stand.
  }
}

/** Browser fallback so the whole export flow can be reviewed via `npm run dev`. */
function downloadInBrowser(files: ExportFile[]): void {
  for (const file of files) {
    const url = URL.createObjectURL(file.blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

/** Where the files ended up, for the confirmation toast. */
function describeDelivery(files: ExportFile[], downloaded: boolean): string {
  if (downloaded) {
    return files.length === 1 ? `${files[0].name} diunduh.` : `${files.length} file diunduh.`
  }
  return files.length === 1
    ? `Tersimpan di folder Documents: ${files[0].name}`
    : `${files.length} file tersimpan di folder Documents.`
}

/**
 * Saves and shares in one go — the single-document export path, unchanged.
 *
 * Saved first, shared second: if the user dismisses the share sheet the file
 * is still on the device where they can find it.
 */
export async function deliverExport(files: ExportFile[]): Promise<DeliveryResult> {
  if (files.length === 0) throw new Error('Tidak ada file untuk diekspor.')

  const uris = await writeExportFiles(files)
  await shareFiles(uris, files.length === 1 ? files[0].name : 'Dokumen ScannApp')

  return { message: describeDelivery(files, uris.length === 0) }
}
