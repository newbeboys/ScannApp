import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { resumeTracker } from './ads/appOpenGate'
import { blobToBase64 } from './blobBase64'
import { exportNameCandidates } from './exportNames'

export interface ExportFile {
  name: string
  blob: Blob
}

/**
 * Where an export is meant to end up, chosen in the export sheet.
 *
 * The two are exclusive on purpose (Boss Ali, 26 Agustus 2026). The old flow
 * did both at once — write to the public Documents folder, then open the share
 * sheet — so dismissing the sheet still left a file behind on the phone, which
 * is not what cancelling means. Splitting them also takes the public folder
 * out of the sharing path entirely, and with it the scoped-storage write that
 * could fail on a name the folder already held.
 */
export type ExportDestination = 'share' | 'device'

/** A file that reached the disk, under the name it actually got. */
export interface WrittenFile {
  name: string
  uri: string
}

export interface DeliveryResult {
  /** Where the files ended up, for the confirmation toast. */
  message: string
  /** True when the share sheet was dismissed, so nothing left the app. */
  cancelled: boolean
}

/**
 * Files on their way to another app live here, not in Documents.
 *
 * A private cache folder: no permission is needed to write it, scoped storage
 * has no say over it, and `file_paths.xml` already exposes `cache-path` to the
 * FileProvider the Share plugin hands the URI through. Wiped at the start of
 * every export rather than after each one, because the app receiving the file
 * may still be reading it when the share resolves.
 */
const STAGING_DIR = 'exports'

/**
 * How many names one file may burn through before the export gives up.
 *
 * Only reached when `stat` said a name was free and the write disagreed — see
 * `writeToDocuments`. Three is enough to get past a stale name or two without
 * turning a full disk into ninety-nine doomed writes.
 */
const WRITE_ATTEMPTS = 3

/**
 * Asked for once per app run, not once per file.
 *
 * Both calls below cross the Capacitor bridge, and `requestPermissions` can put
 * a system dialog on screen. A ten-document batch export ran the pair ten times
 * — a visible part of why exporting ten documents felt like it had hung
 * (dilaporkan dari HP, 25 Agustus 2026). The answer cannot change underneath us
 * within a run: the only thing that would change it is the user answering the
 * dialog, which is what this waits for the first time.
 */
let storagePermission: Promise<void> | null = null

/**
 * Public Documents needs WRITE_EXTERNAL_STORAGE only on Android 10 and
 * below; Android 11+ grants it implicitly. Failing to get it is not fatal
 * here — the write below will surface a clearer error if it truly can't
 * proceed.
 */
function ensureStoragePermission(): Promise<void> {
  storagePermission ??= (async () => {
    try {
      const status = await Filesystem.checkPermissions()
      if (status.publicStorage !== 'granted') {
        await Filesystem.requestPermissions()
      }
    } catch {
      // Plugin reports no permission model on this platform/API level.
    }
  })()

  return storagePermission
}

/**
 * Empties the staging folder. Called once per export, never between files.
 *
 * A batch stages every document into the same folder and shares them together,
 * so clearing per file would delete the run's earlier documents just before
 * handing their URIs to the share sheet.
 */
export async function prepareStaging(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  try {
    await Filesystem.rmdir({ path: STAGING_DIR, directory: Directory.Cache, recursive: true })
  } catch {
    // Nothing staged yet — the normal case on the first export of a run.
  }
}

/**
 * How much of a file crosses the Capacitor bridge in one call.
 *
 * The plugin only speaks base64 on native (`WriteFileOptions.data` is typed
 * `string | Blob`, and the Blob half is web-only), and one call carries the
 * whole string: JS builds it, `JSON.stringify` copies it into the bridge
 * message, Java parses that back out as a `String`, and only then is it decoded
 * into bytes. A twenty-page PDF is around 25 MB, which is a 33 MB base64
 * string — and every one of those steps allocates its own copy of it, on a
 * phone, at once. That is the shape of the report from the device on
 * 31 Agustus 2026: a twenty-page export that took over a minute while the same
 * pages compressed in a couple of seconds.
 *
 * The same total still crosses, but in slices, so nothing bigger than this ever
 * exists on either side. 1.5 MB is a multiple of 3, so each slice encodes to
 * base64 with no padding and the bytes that come out the far end are exactly
 * the bytes that went in.
 *
 * Technical, not a business number — free to retune.
 */
export const WRITE_CHUNK_BYTES = 1_572_864

/**
 * How many bytes are on disk at this path, or `null` when it will not say.
 *
 * Null rather than a throw, because this only ever second-guesses a write that
 * already reported success. A guard that turned "this platform answers `stat`
 * differently than expected" into a failed export would be doing more harm than
 * the truncation it was added to catch — `isTaken` already reads `stat` on the
 * Documents folder, so it works here, but a check that cannot misfire needs no
 * such argument to stand on.
 */
async function sizeOnDisk(path: string, directory: Directory): Promise<number | null> {
  try {
    const { size } = await Filesystem.stat({ path, directory })
    return typeof size === 'number' ? size : null
  } catch {
    return null
  }
}

/**
 * Writes a whole blob to one path, in slices.
 *
 * The first slice creates the file and every later one is appended, so a caller
 * that wants "create, never overwrite" still gets exactly that from the first
 * call — which is what keeps `writeToDocuments` below able to catch an EACCES
 * on a name it does not own and move to the next one.
 *
 * A slice that fails partway through takes the half-written file with it.
 * Anything else would leave a truncated PDF sitting where a whole one belongs,
 * and would hand `writeToDocuments` a name that now exists for its retry to
 * append onto.
 */
async function writeBlob(
  blob: Blob,
  path: string,
  directory: Directory,
  recursive: boolean,
): Promise<void> {
  if (blob.size <= WRITE_CHUNK_BYTES) {
    await Filesystem.writeFile({ path, directory, data: await blobToBase64(blob), recursive })
    return
  }

  try {
    for (let offset = 0; offset < blob.size; offset += WRITE_CHUNK_BYTES) {
      const data = await blobToBase64(blob.slice(offset, offset + WRITE_CHUNK_BYTES))
      if (offset === 0) {
        await Filesystem.writeFile({ path, directory, data, recursive })
      } else {
        await Filesystem.appendFile({ path, directory, data })
      }
    }

    /*
      Counted back off the disk, because the only failure this path has that
      the single call did not is a *silent* one. `appendFile` is the plugin's
      own API and the mode is first class in the layer under it, but if any
      Android version were to land a slice short without saying so, what would
      reach the user is a PDF that opens on page eleven — and on the "Simpan ke
      HP" route, a file that is not looked at again for months. A truncated
      export must fail like a failed export.
    */
    const written = await sizeOnDisk(path, directory)
    if (written !== null && written !== blob.size) {
      throw new Error(
        `Berkas tersimpan tidak utuh (${written} dari ${blob.size} byte). Coba ekspor ulang.`,
      )
    }
  } catch (error) {
    await Filesystem.deleteFile({ path, directory }).catch(() => {})
    throw error
  }
}

/** True when something already occupies this name in the public Documents folder. */
async function isTaken(name: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path: name, directory: Directory.Documents })
    return true
  } catch {
    return false
  }
}

/**
 * Saves one file to the public Documents folder without ever replacing a file
 * already sitting there.
 *
 * Scoped storage is why this is not a plain write. From Android 11 an app may
 * create files in the shared Documents folder but may only reopen the ones it
 * still owns, and ownership does not survive the app being reinstalled — so a
 * document exported by yesterday's build is, to today's build, another app's
 * file. Writing over it fails with EACCES, which is exactly what Boss Ali hit
 * on 26 Agustus 2026: the same document failed every time under its own name
 * and succeeded the moment it was renamed.
 *
 * Not overwriting is the better behaviour on its own terms as well — a second
 * export of the same document no longer destroys the first — so both problems
 * are answered by minting a fresh name rather than by asking for more
 * permission than the app needs.
 *
 * The retry after a failed write is not caution for its own sake: `stat`
 * cannot always see a file this install does not own, so a name it reports as
 * free can still be refused by the write that follows.
 */
async function writeToDocuments(name: string, blob: Blob): Promise<WrittenFile> {
  let attempts = 0
  let lastError: unknown = null

  for (const candidate of exportNameCandidates(name)) {
    if (await isTaken(candidate)) continue

    try {
      await writeBlob(blob, candidate, Directory.Documents, true)
      const { uri } = await Filesystem.getUri({ path: candidate, directory: Directory.Documents })
      return { name: candidate, uri }
    } catch (error) {
      lastError = error
      if (++attempts >= WRITE_ATTEMPTS) break
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Tidak ada nama berkas yang bisa dipakai untuk ${name}.`)
}

/** Stages one file in the private cache folder, ready to hand to another app. */
async function writeToStaging(name: string, blob: Blob): Promise<WrittenFile> {
  const path = `${STAGING_DIR}/${name}`
  await writeBlob(blob, path, Directory.Cache, true)
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache })
  return { name, uri }
}

/**
 * Writes every file to the chosen destination and returns what landed, so a
 * caller exporting many documents can save them one at a time rather than
 * holding every blob in memory at once.
 *
 * Returns an empty list on the web: a browser download has no URI anything
 * else could share.
 */
export async function writeExportFiles(
  files: ExportFile[],
  destination: ExportDestination,
): Promise<WrittenFile[]> {
  if (!Capacitor.isNativePlatform()) {
    downloadInBrowser(files)
    return []
  }

  // Only the public folder has a permission model worth asking about; the
  // cache folder is the app's own.
  if (destination === 'device') await ensureStoragePermission()

  const written: WrittenFile[] = []
  for (const file of files) {
    written.push(
      destination === 'device'
        ? await writeToDocuments(file.name, file.blob)
        : await writeToStaging(file.name, file.blob),
    )
  }

  return written
}

/** Whether the files reached another app, or the sheet was dismissed. */
export type ShareOutcome = 'sent' | 'cancelled'

/**
 * Hands the staged files to another app.
 *
 * A dismissed sheet comes back as `cancelled` rather than as an exception,
 * because it is a decision and not a fault. Anything else is rethrown: a share
 * that genuinely failed — a FileProvider that cannot see the path, a plugin
 * error — must not be reported to the user as something they chose to do.
 */
export async function shareFiles(uris: string[], title: string): Promise<ShareOutcome> {
  if (uris.length === 0) return 'cancelled'

  try {
    // Sharing hands the user to another app; coming back from it is our doing,
    // not a return from elsewhere, so it must not earn an App Open ad.
    resumeTracker.leaveForOwnFlow()
    await Share.share({ title, files: uris })
    return 'sent'
  } catch (error) {
    if (isDismissal(error)) return 'cancelled'
    throw error
  }
}

/**
 * The Android plugin rejects a dismissed sheet with the literal string
 * "Share canceled" (SharePlugin.activityResult). Matched on the word itself so
 * that a spelling change on either side of the Atlantic keeps working.
 */
function isDismissal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /cancel/i.test(message)
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

/**
 * Where the files ended up, for the confirmation toast.
 *
 * Reads the names back off what was written rather than off what was asked
 * for: a file saved to Documents can come out as "Nota (2).pdf", and a toast
 * naming "Nota.pdf" would send the user looking for a file that is not there.
 */
export function describeDelivery(
  written: WrittenFile[],
  destination: ExportDestination,
): string {
  if (written.length === 1) {
    return destination === 'device'
      ? `Tersimpan di folder Documents: ${written[0].name}`
      : `${written[0].name} dikirim.`
  }

  const where = destination === 'device' ? 'tersimpan di folder Documents' : 'dikirim'
  return `${written.length} file ${where}.`
}

/** The browser path, where the files went to the downloads folder instead. */
function describeDownload(files: ExportFile[]): string {
  return files.length === 1 ? `${files[0].name} diunduh.` : `${files.length} file diunduh.`
}

export const CANCELLED_MESSAGE = 'Ekspor dibatalkan — tidak ada berkas yang disimpan di HP.'

/**
 * Saves or shares one document's files, according to the destination.
 *
 * "Simpan ke HP" never opens the share sheet and "Bagikan" never touches the
 * public folder. That is the whole point of the split: cancelling a share can
 * only leave the private staging copy behind, and the next export wipes that.
 */
export async function deliverExport(
  files: ExportFile[],
  destination: ExportDestination,
): Promise<DeliveryResult> {
  if (files.length === 0) throw new Error('Tidak ada file untuk diekspor.')

  if (destination === 'share') await prepareStaging()

  const written = await writeExportFiles(files, destination)

  // Web: the browser has already downloaded them and there is no URI to pass on.
  if (written.length === 0) return { message: describeDownload(files), cancelled: false }

  if (destination === 'device') {
    return { message: describeDelivery(written, destination), cancelled: false }
  }

  const title = files.length === 1 ? files[0].name : 'Dokumen ScannApp'
  const uris = written.map((file) => file.uri)

  let outcome: ShareOutcome
  try {
    outcome = await shareFiles(uris, title)
  } catch (error) {
    // Thrown on, unlike the batch path: one document has no accounting worth
    // preserving, so the real cause is the whole story and the caller shows it.
    // The staged copy still goes, because the share did not land.
    await prepareStaging()
    throw error
  }

  if (outcome === 'cancelled') {
    await prepareStaging()
    return { message: CANCELLED_MESSAGE, cancelled: true }
  }

  return { message: describeDelivery(written, destination), cancelled: false }
}
