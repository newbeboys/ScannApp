# Impor File Aktif (Gambar/PDF) di Menu Dokumen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tombol baru di layar Dokumen membuka picker sistem Android (folder lokal + Google Drive/provider cloud lain) supaya user bisa mengimpor gambar/PDF ke ScannApp secara aktif, bukan cuma menunggu file di-*share* dari aplikasi lain.

**Architecture:** Perluas `SharedImportPlugin.java` yang sudah ada (jalur pasif share-sheet) dengan method `pickFiles()` yang membuka `Intent.ACTION_OPEN_DOCUMENT` lewat `startActivityForResult`/`@ActivityCallback` (Capacitor 8), memakai ulang logika konversi URI→JPEG yang sama (salin gambar / rasterisasi PDF lewat `PdfRenderer`). Hasilnya sampai ke JS lewat pemanggilan promise langsung (`SharedImport.pickFiles()`), bukan event — beda dari jalur pasif yang event-based karena ini pemanggilan sekali-jalan dari tombol, bukan intent yang bisa datang kapan saja. `App.tsx` memakai ulang jalur "gambar masuk → antre tinjau" yang sama dengan jalur share pasif lewat satu fungsi `ingestImportedFiles()` baru.

**Tech Stack:** React + TypeScript + Vite + Capacitor 8.4.2; Java native plugin (Android SDK bawaan, `androidx.activity.result.ActivityResult`, nol dependency baru); Vitest suite `node` untuk `sharedImport.ts`, suite `browser` (Playwright/Chromium) untuk `DocumentsScreen.tsx`.

**Spec:** `docs/superpowers/specs/2026-09-02-dokumen-impor-file-design.md`

## Global Constraints

- **Tier: semua tier, tanpa gerbang sama sekali** (spec §1; pola yang sama dengan reorder/filter/PNG/anotasi/pisah/share-pasif — akses ke dokumen sendiri, bukan mesin baru).
- **Cakupan sesi ini: Gambar (`image/*`) dan PDF (`application/pdf`) saja.** DOCX sengaja **tidak** dicakup di sini — dipisah jadi sub-proyek tersendiri (spec §1 & §7), mewarisi keputusan 26 Agustus 2026.
- **Nol dependency baru**, npm maupun Gradle. `ACTION_OPEN_DOCUMENT`, `startActivityForResult`/`@ActivityCallback` semuanya sudah tersedia lewat `@capacitor/android` 8.4.2 yang sudah terpasang.
- **Tidak ada izin runtime baru.** SAF memberi akses baca per-URI lewat grant sistem saat picker mengembalikan hasil — jangan tambahkan `READ_EXTERNAL_STORAGE`/`READ_MEDIA_IMAGES` ke manifest, itu tidak dibutuhkan dan salah arah untuk `ACTION_OPEN_DOCUMENT`.
- **`AndroidManifest.xml` dan `MainActivity.java` tidak berubah.** `SharedImportPlugin` sudah terdaftar; method baru otomatis ikut terdaftar sebagai bagian plugin yang sama. Jangan buat plugin Java baru — lihat spec §2 untuk alasan reuse.
- **Membatalkan picker sistem bukan error** — resolve dengan `{paths: [], skippedCount: 0}`, sama seperti membatalkan alur lain di aplikasi ini (share sheet ekspor, dst).
- **Bahasa komentar:** Inggris di `SharedImportPlugin.java`, `sharedImport.ts`, `DocumentsScreen.tsx`, dan `App.tsx` — keempatnya sudah berkomentar Inggris secara konsisten sekarang (CLAUDE.md Bagian 4: konsisten per file). Teks yang dilihat user (toast, `aria-label`) tetap Bahasa Indonesia.
- **Tidak ada gerbang platform baru untuk tombol impor.** `pickFiles()` sudah aman dipanggil di web (resolve kosong tanpa memanggil native apa pun, pola yang sama dengan `onSharedFilesReceived`) — tombolnya tidak perlu prop `isNative`/`canImport` terpisah seperti tombol Scan di `HomeScreen`. Web bukan target rilis nyata untuk aplikasi ini (CLAUDE.md Bagian 2), jadi tidak sepadan menambah permukaan prop untuk itu.
- Perintah test: `npm run test:node` dan `npm run test:browser` (atau `npm test` untuk keduanya). Typecheck & build: `npm run build`. Native: `cd android; .\gradlew.bat assembleDebug` (Windows; set `JAVA_HOME`/`PATH` dulu, lihat Task 1 Step 2) — satu-satunya verifikasi otomatis untuk kode Java.
- Basis test sekarang (dicek langsung 2 September 2026, setelah fitur pencarian dokumen commit): **860 node tests, 158 browser tests**, keduanya lolos bersih.

---

### Task 1: Native — perluas `SharedImportPlugin.java`

**Files:**
- Modify: `android/app/src/main/java/com/newbeboys/scannapp/SharedImportPlugin.java`

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the first task).
- Produces: a new Capacitor plugin method `pickFiles()` on the already-registered `SharedImport` plugin, resolving to `{ paths: string[], skippedCount: number }` — the exact same shape as the existing `sharedFilesReceived` event payload. Task 2's JS wrapper calls this method directly (not via an event listener).

- [ ] **Step 1: Extract the shared URI-to-JPEG conversion logic, then add `pickFiles()`/`handlePickResult()`**

Replace the full contents of `SharedImportPlugin.java` with:

```java
package com.newbeboys.scannapp;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Gets files into ScannApp from outside the app, two ways:
 *
 * 1. Passive: files shared in from other apps (WPS Office, CamScanner, etc.)
 *    via the Android share sheet (ACTION_SEND / ACTION_SEND_MULTIPLE), caught
 *    by handleOnNewIntent. BridgeActivity.onCreate() ends its load() by
 *    calling onNewIntent(getIntent()) (confirmed by reading
 *    BridgeActivity.java in node_modules, not assumed), so both a cold launch
 *    (app opened via share) and an intent arriving while the app is already
 *    running (MainActivity is launchMode="singleTop") go through this exact
 *    same method. No separate load() override is needed.
 * 2. Active: pickFiles(), called from a button in the app, opens the system
 *    file picker (Storage Access Framework) via ACTION_OPEN_DOCUMENT -- this
 *    aggregates local folders and any installed cloud provider (Google
 *    Drive, Dropbox, etc) without this app integrating each provider's API.
 *
 * Both paths funnel through the same convertUris() -- one file that fails to
 * convert never takes the rest of a batch down with it, in either path.
 */
@CapacitorPlugin(name = "SharedImport")
public class SharedImportPlugin extends Plugin {

    private static final String EVENT_NAME = "sharedFilesReceived";
    private static final String CACHE_SUBDIR = "shared-import";
    private static final int MAX_PDF_PAGES = 50;
    private static final int PDF_RENDER_TARGET_PX = 2400;

    private final ExecutorService importExecutor = Executors.newSingleThreadExecutor();

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null) return;

        importExecutor.execute(() -> {
            List<Uri> uris = new ArrayList<>();
            String action = intent.getAction();
            if (Intent.ACTION_SEND.equals(action)) {
                Uri single = getStreamExtra(intent);
                if (single != null) uris.add(single);
            } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                ArrayList<Uri> many = getStreamExtraList(intent);
                if (many != null) uris.addAll(many);
            } else {
                return;
            }
            if (uris.isEmpty()) return;

            ConversionResult conversion = convertUris(uris, getContext().getContentResolver());

            JSArray paths = new JSArray();
            for (String path : conversion.outputPaths) {
                paths.put(path);
            }
            JSObject data = new JSObject();
            data.put("paths", paths);
            data.put("skippedCount", conversion.skippedCount);
            // Plugin.eventListeners / retainedEventArguments are plain
            // HashMaps with no internal synchronization. addListener() from
            // JS runs on the Bridge's own "CapacitorPlugins" handler thread,
            // not this importExecutor thread -- calling notifyListeners()
            // directly here would race that thread on the exact cold-launch
            // path this plugin exists for (JS calling addListener() while a
            // share is still being processed). execute() hands this back to
            // that same handler thread, code-review round 1.
            execute(() -> notifyListeners(EVENT_NAME, data, true));
        });
    }

    /**
     * Opens the system document picker for images and PDFs, allowing
     * multiple selection. Resolves via handlePickResult below -- including
     * when the user cancels, which is not an error (spec §5).
     */
    @PluginMethod
    public void pickFiles(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "image/*", "application/pdf" });
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, intent, "handlePickResult");
    }

    @ActivityCallback
    private void handlePickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        Intent resultData = (result.getResultCode() == Activity.RESULT_OK) ? result.getData() : null;
        List<Uri> uris = new ArrayList<>();
        if (resultData != null) {
            ClipData clipData = resultData.getClipData();
            if (clipData != null) {
                for (int i = 0; i < clipData.getItemCount(); i++) {
                    uris.add(clipData.getItemAt(i).getUri());
                }
            } else if (resultData.getData() != null) {
                uris.add(resultData.getData());
            }
        }

        if (uris.isEmpty()) {
            // Cancelled picker, or a provider that handed back nothing usable
            // -- not an error, same as backing out of any other flow in this
            // app (spec §5).
            JSObject empty = new JSObject();
            empty.put("paths", new JSArray());
            empty.put("skippedCount", 0);
            call.resolve(empty);
            return;
        }

        importExecutor.execute(() -> {
            ConversionResult conversion = convertUris(uris, getContext().getContentResolver());

            JSArray paths = new JSArray();
            for (String path : conversion.outputPaths) {
                paths.put(path);
            }
            JSObject payload = new JSObject();
            payload.put("paths", paths);
            payload.put("skippedCount", conversion.skippedCount);
            // Unlike notifyListeners() above, PluginCall.resolve() has no
            // documented same-thread requirement and is the standard way
            // Capacitor plugins resolve calls after background work -- no
            // execute() bounce-back needed here.
            call.resolve(payload);
        });
    }

    /** Result of converting a batch of incoming URIs into JPEG paths this app owns. */
    private static final class ConversionResult {
        final List<String> outputPaths;
        final int skippedCount;

        ConversionResult(List<String> outputPaths, int skippedCount) {
            this.outputPaths = outputPaths;
            this.skippedCount = skippedCount;
        }
    }

    /**
     * Converts a batch of content:// URIs (images or PDFs) into JPEG paths
     * this app owns, shared by both handleOnNewIntent (passive share) and
     * handlePickResult (active picker). One bad file does not take the rest
     * of the batch down with it.
     */
    private ConversionResult convertUris(List<Uri> uris, ContentResolver resolver) {
        List<String> outputPaths = new ArrayList<>();
        int skippedCount = 0;

        for (Uri uri : uris) {
            try {
                String mimeType = resolver.getType(uri);
                if (mimeType != null && mimeType.startsWith("image/")) {
                    String path = copyImageToCache(uri, resolver);
                    if (path != null) {
                        outputPaths.add(path);
                    } else {
                        skippedCount++;
                    }
                } else if ("application/pdf".equals(mimeType)) {
                    List<String> pages = rasterizePdfToCache(uri, resolver);
                    if (pages.isEmpty()) {
                        skippedCount++;
                    } else {
                        outputPaths.addAll(pages);
                    }
                } else {
                    // The manifest intent-filter (share) or EXTRA_MIME_TYPES
                    // (picker) already restricts what reaches ScannApp; this
                    // branch only matters for a provider that hands back
                    // something outside that filter anyway.
                    skippedCount++;
                }
            } catch (Exception | OutOfMemoryError e) {
                // A corrupt or unreadable file must not take the rest of the
                // batch down with it. OutOfMemoryError is caught explicitly
                // (it is an Error, not an Exception) because PDF rasterization
                // allocates a full ARGB_8888 bitmap per page -- large enough on
                // a phone already under memory pressure to throw one instead of
                // an ordinary exception, code-review round 1.
                skippedCount++;
            }
        }

        return new ConversionResult(outputPaths, skippedCount);
    }

    @SuppressWarnings("deprecation")
    private Uri getStreamExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    @SuppressWarnings("deprecation")
    private ArrayList<Uri> getStreamExtraList(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
    }

    /**
     * Copies a shared/picked image into the app's own cache, so the rest of
     * the app only ever deals with a file:// path it owns instead of a
     * content:// grant from another app (which, in practice, outlives this
     * call for the life of the receiving Activity -- copying immediately here
     * is just conservative, not a race against that grant expiring mid-copy,
     * corrected during review; the original comment overstated the risk).
     */
    private String copyImageToCache(Uri uri, ContentResolver resolver) throws IOException {
        File dir = new File(getContext().getCacheDir(), CACHE_SUBDIR);
        if (!dir.exists()) dir.mkdirs();
        File out = new File(dir, "shared-" + System.nanoTime() + ".jpg");

        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) return null;
            try (FileOutputStream fos = new FileOutputStream(out)) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    fos.write(buffer, 0, read);
                }
            }
        } catch (IOException e) {
            // Don't leave a truncated JPEG behind in our own cache dir if the
            // copy failed partway through (e.g. disk full).
            out.delete();
            throw e;
        }
        return "file://" + out.getAbsolutePath();
    }

    /**
     * Rasterizes a third-party PDF page-by-page via the platform's own
     * PdfRenderer (API 21+, no new dependency). pdfImport.ts cannot be reused
     * here: it only works for PDFs ScannApp itself wrote (exactly one raw
     * JPEG XObject per page) -- a PDF from CamScanner/WPS/Google Drive makes
     * no such promise, so it needs a real rasterizer instead of an XObject
     * lookup.
     */
    private List<String> rasterizePdfToCache(Uri uri, ContentResolver resolver) throws IOException {
        List<String> pages = new ArrayList<>();
        File dir = new File(getContext().getCacheDir(), CACHE_SUBDIR);
        if (!dir.exists()) dir.mkdirs();

        ParcelFileDescriptor pfd = resolver.openFileDescriptor(uri, "r");
        if (pfd == null) return pages;

        try {
            try (PdfRenderer renderer = new PdfRenderer(pfd)) {
                int pageCount = Math.min(renderer.getPageCount(), MAX_PDF_PAGES);
                for (int i = 0; i < pageCount; i++) {
                    try (PdfRenderer.Page page = renderer.openPage(i)) {
                        float scale =
                            (float) PDF_RENDER_TARGET_PX / Math.max(page.getWidth(), page.getHeight());
                        int w = Math.max(1, Math.round(page.getWidth() * scale));
                        int h = Math.max(1, Math.round(page.getHeight() * scale));
                        Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                        // A transparent PDF page would otherwise render as black.
                        bitmap.eraseColor(0xFFFFFFFF);
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);

                        File out = new File(dir, "shared-" + System.nanoTime() + "-" + i + ".jpg");
                        try (FileOutputStream fos = new FileOutputStream(out)) {
                            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, fos);
                        }
                        bitmap.recycle();
                        pages.add("file://" + out.getAbsolutePath());
                    }
                }
            }
        } finally {
            pfd.close();
        }
        return pages;
    }
}
```

This is a refactor (extract `convertUris()`) plus one new capability (`pickFiles()`/`handlePickResult()`) landed together: the refactor alone has no independently observable behavior to verify without the capability that motivates it, and both are reviewed against the same compile-check below.

- [ ] **Step 2: Compile-check the native change**

Run (PowerShell, from repo root -- set `JAVA_HOME` first, see the `android-build-env-jdk-sdk` memory: JDK is installed but not inherited by new shells):

```powershell
$env:JAVA_HOME = "C:\Users\HP\AppData\Local\Programs\Eclipse Adoptium\jdk-21.0.12.1-hotspot"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
cd android; .\gradlew.bat assembleDebug
```

Expected: `BUILD SUCCESSFUL`. This is the only automated verification available for this task -- no vitest suite touches Android code (spec §6). If it fails, fix the Java before moving on; do not defer a compile error to Task 5.

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/java/com/newbeboys/scannapp/SharedImportPlugin.java
git commit -m "feat(dokumen-impor): buka picker sistem lewat SharedImportPlugin (native)"
```

---

### Task 2: Jembatan JS — `pickFiles()` di `src/lib/sharedImport.ts`

**Files:**
- Modify: `src/lib/sharedImport.ts`
- Modify: `src/lib/sharedImport.test.ts`

**Interfaces:**
- Consumes: the native `SharedImport` plugin's `pickFiles()` method, resolving to `{ paths: string[], skippedCount: number }` (Task 1).
- Produces: `export async function pickFiles(): Promise<SharedImportResult>` (reuses the existing `SharedImportResult` interface already exported from this file). Task 4 imports this and calls it from a button handler.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/lib/sharedImport.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

let isNative = true
let registeredListener: ((data: { paths: string[]; skippedCount: number }) => void) | null = null
const removeMock = vi.fn().mockResolvedValue(undefined)
const addListenerMock = vi.fn(
  (_eventName: string, cb: (data: { paths: string[]; skippedCount: number }) => void) => {
    registeredListener = cb
    return Promise.resolve({ remove: removeMock })
  },
)
const pickFilesMock = vi.fn()

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNative,
    convertFileSrc: (path: string) =>
      path.startsWith('file://')
        ? `https://localhost${path.replace('file://', '/_capacitor_file_')}`
        : path,
  },
  registerPlugin: () => ({
    addListener: addListenerMock,
    pickFiles: pickFilesMock,
  }),
}))

const { onSharedFilesReceived, pickFiles } = await import('./sharedImport')

beforeEach(() => {
  isNative = true
  registeredListener = null
  addListenerMock.mockClear()
  removeMock.mockClear()
  pickFilesMock.mockReset()
})

describe('onSharedFilesReceived', () => {
  it('converts each path so the webview can read it', () => {
    const results: string[][] = []
    onSharedFilesReceived((result) => results.push(result.images))

    registeredListener?.({ paths: ['file:///cache/a.jpg', 'file:///cache/b.jpg'], skippedCount: 0 })

    expect(results).toEqual([
      [
        'https://localhost/_capacitor_file_/cache/a.jpg',
        'https://localhost/_capacitor_file_/cache/b.jpg',
      ],
    ])
  })

  it('passes skippedCount through untouched', () => {
    const results: number[] = []
    onSharedFilesReceived((result) => results.push(result.skippedCount))

    registeredListener?.({ paths: ['file:///cache/a.jpg'], skippedCount: 2 })

    expect(results).toEqual([2])
  })

  it('still calls back on an all-skipped share, with an empty image list', () => {
    const callback = vi.fn()
    onSharedFilesReceived(callback)

    registeredListener?.({ paths: [], skippedCount: 1 })

    expect(callback).toHaveBeenCalledWith({ images: [], skippedCount: 1 })
  })

  it('never registers the native listener on web', () => {
    isNative = false
    const unsubscribe = onSharedFilesReceived(vi.fn())

    expect(addListenerMock).not.toHaveBeenCalled()
    expect(() => unsubscribe()).not.toThrow()
  })

  it('returns an unsubscribe function that removes the native listener', async () => {
    const unsubscribe = onSharedFilesReceived(vi.fn())
    unsubscribe()
    await Promise.resolve()

    expect(removeMock).toHaveBeenCalledTimes(1)
  })

  it('does not leave an unhandled rejection when native addListener itself rejects', async () => {
    // App.tsx registers this once on mount and (in practice) never calls the
    // returned unsubscribe function during normal operation, so a rejection
    // must be caught right away -- not only inside the unsubscribe closure,
    // which may never run.
    addListenerMock.mockImplementationOnce(() => Promise.reject(new Error('plugin not implemented')))

    expect(() => onSharedFilesReceived(vi.fn())).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    // No assertion beyond "got here": an uncaught rejection here would fail
    // the test file via vitest's unhandled-rejection detection.
  })
})

describe('pickFiles', () => {
  it('converts each picked path so the webview can read it', async () => {
    pickFilesMock.mockResolvedValue({
      paths: ['file:///cache/a.jpg', 'file:///cache/b.jpg'],
      skippedCount: 0,
    })

    const result = await pickFiles()

    expect(result).toEqual({
      images: [
        'https://localhost/_capacitor_file_/cache/a.jpg',
        'https://localhost/_capacitor_file_/cache/b.jpg',
      ],
      skippedCount: 0,
    })
  })

  it('passes skippedCount through untouched', async () => {
    pickFilesMock.mockResolvedValue({ paths: ['file:///cache/a.jpg'], skippedCount: 2 })

    const result = await pickFiles()

    expect(result.skippedCount).toBe(2)
  })

  it('resolves to an empty result when the picker is cancelled, not a rejection', async () => {
    pickFilesMock.mockResolvedValue({ paths: [], skippedCount: 0 })

    const result = await pickFiles()

    expect(result).toEqual({ images: [], skippedCount: 0 })
  })

  it('never calls the native plugin on web, resolving to an empty result', async () => {
    isNative = false

    const result = await pickFiles()

    expect(pickFilesMock).not.toHaveBeenCalled()
    expect(result).toEqual({ images: [], skippedCount: 0 })
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:node -- sharedImport.test.ts`
Expected: FAIL — `describe('pickFiles', ...)` block errors because `pickFiles` is not exported from `./sharedImport` yet (`onSharedFilesReceived` tests still pass, unchanged).

- [ ] **Step 3: Write `src/lib/sharedImport.ts`**

Replace the full contents of `src/lib/sharedImport.ts` with:

```ts
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
```

- [ ] **Step 4: Run the tests again to confirm they pass**

Run: `npm run test:node -- sharedImport.test.ts`
Expected: PASS, 10 tests (6 existing `onSharedFilesReceived` + 4 new `pickFiles`).

- [ ] **Step 5: Run the full node suite to confirm nothing else broke**

Run: `npm run test:node`
Expected: PASS, 864 tests (860 baseline + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/sharedImport.ts src/lib/sharedImport.test.ts
git commit -m "feat(dokumen-impor): tambah pickFiles() ke jembatan JS sharedImport"
```

---

### Task 3: UI — tombol impor di `DocumentsScreen.tsx`

**Files:**
- Modify: `src/components/Icons.tsx`
- Modify: `src/screens/DocumentsScreen.tsx`
- Modify: `src/screens/DocumentsScreen.browser.test.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: nothing from Task 1/2 directly (this task only adds UI plumbing: an icon, a button, and two new props on `DocumentsScreenProps`). It does not call `pickFiles()` itself.
- Produces: `DocumentsScreenProps` gains `onImportFiles: () => void` and `isImporting: boolean`. Task 4 passes `handleImportFiles`/`isImporting` from `App.tsx` into these exact prop names.

- [ ] **Step 1: Write the failing tests**

In `src/screens/DocumentsScreen.browser.test.tsx`, update the `renderScreen` helper to include the two new required props, and add a new `describe` block. Find:

```tsx
async function renderScreen(overrides: Partial<Parameters<typeof DocumentsScreen>[0]> = {}) {
  return await render(
    <DocumentsScreen
      entries={entries}
      tier="pro"
      restoringId={null}
      isRestoringAll={false}
      selectMode={false}
      selectedIds={[]}
      isBatchBusy={false}
      onDelete={() => {}}
      onOpen={() => {}}
      onRestore={() => {}}
      onRestoreAll={() => {}}
      onMerge={() => {}}
      onEnterSelect={() => {}}
      onToggleSelect={() => {}}
      onToggleSelectAll={() => {}}
      onExitSelect={() => {}}
      onBatchExport={() => {}}
      onBatchDelete={() => {}}
      onNotice={() => {}}
      {...overrides}
    />,
  )
}
```

Replace with:

```tsx
async function renderScreen(overrides: Partial<Parameters<typeof DocumentsScreen>[0]> = {}) {
  return await render(
    <DocumentsScreen
      entries={entries}
      tier="pro"
      restoringId={null}
      isRestoringAll={false}
      selectMode={false}
      selectedIds={[]}
      isBatchBusy={false}
      onDelete={() => {}}
      onOpen={() => {}}
      onRestore={() => {}}
      onRestoreAll={() => {}}
      onMerge={() => {}}
      onEnterSelect={() => {}}
      onToggleSelect={() => {}}
      onToggleSelectAll={() => {}}
      onExitSelect={() => {}}
      onBatchExport={() => {}}
      onBatchDelete={() => {}}
      onNotice={() => {}}
      onImportFiles={() => {}}
      isImporting={false}
      {...overrides}
    />,
  )
}
```

Then append this new block at the end of the file (after the closing `})` of the existing `describe('searching documents', ...)` block added by the previous feature):

```tsx

describe('importing files', () => {
  it('calls onImportFiles when the import button is tapped', async () => {
    const onImportFiles = vi.fn()
    const screen = await renderScreen({ onImportFiles })

    await screen.getByRole('button', { name: 'Impor file' }).click()

    expect(onImportFiles).toHaveBeenCalledTimes(1)
  })

  it('disables the import button while importing', async () => {
    const screen = await renderScreen({ isImporting: true })

    await expect.element(screen.getByRole('button', { name: 'Impor file' })).toBeDisabled()
  })

  it('is hidden while in select mode', async () => {
    const screen = await renderScreen({ selectMode: true, selectedIds: ['a'] })

    await expect.element(screen.getByRole('button', { name: 'Impor file' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:browser -- DocumentsScreen.browser.test.tsx`
Expected: FAIL — a TypeScript error first (`onImportFiles`/`isImporting` are not in `DocumentsScreenProps` yet), then (once that's visible) the three new tests would fail to find a button with the accessible name "Impor file".

- [ ] **Step 3: Add `ImportIcon` to `src/components/Icons.tsx`**

Find:

```tsx
export function SearchIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4-4" />
    </svg>
  )
}
```

Replace with:

```tsx
export function SearchIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4-4" />
    </svg>
  )
}

export function ImportIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M12 3v11" />
      <path d="m8 7 4-4 4 4" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}
```

- [ ] **Step 4: Add the button and props to `src/screens/DocumentsScreen.tsx`**

Find the icon import at the top of the file:

```tsx
import {
  CheckIcon,
  CloseIcon,
  CloudIcon,
  DownloadIcon,
  ExportIcon,
  MergeIcon,
  ScanIcon,
  SearchIcon,
  TrashIcon,
} from '../components/Icons'
```

Replace with:

```tsx
import {
  CheckIcon,
  CloseIcon,
  CloudIcon,
  DownloadIcon,
  ExportIcon,
  ImportIcon,
  MergeIcon,
  ScanIcon,
  SearchIcon,
  TrashIcon,
} from '../components/Icons'
```

Find the props interface:

```tsx
  onExitSelect: () => void
  onBatchExport: () => void
  onBatchDelete: () => void
  onNotice: (message: string) => void
}
```

Replace with:

```tsx
  onExitSelect: () => void
  onBatchExport: () => void
  onBatchDelete: () => void
  onNotice: (message: string) => void
  /** Opens the system file picker (folders, Google Drive, etc). */
  onImportFiles: () => void
  /** True while the picker/conversion from onImportFiles is running. */
  isImporting: boolean
}
```

Find the destructured props in the function signature:

```tsx
  onExitSelect,
  onBatchExport,
  onBatchDelete,
  onNotice,
}: DocumentsScreenProps) {
```

Replace with:

```tsx
  onExitSelect,
  onBatchExport,
  onBatchDelete,
  onNotice,
  onImportFiles,
  isImporting,
}: DocumentsScreenProps) {
```

Find the non-select header:

```tsx
        <header className="app-header">
          <div className="app-header__badge">
            <ScanIcon size={22} />
          </div>
          <div className="app-header__titles">
            <h1>ScannApp</h1>
            <p>Semua dokumen tersimpan</p>
          </div>
          {entries.some(isSelectable) && (
            <button type="button" className="link-button" onClick={() => onEnterSelect('')}>
              Pilih
            </button>
          )}
          <span className="app-header__tier">{tier === 'pro' ? 'Pro' : 'Basic'}</span>
        </header>
      )}
```

Replace with:

```tsx
        <header className="app-header">
          <div className="app-header__badge">
            <ScanIcon size={22} />
          </div>
          <div className="app-header__titles">
            <h1>ScannApp</h1>
            <p>Semua dokumen tersimpan</p>
          </div>
          <button
            type="button"
            className="app-header__icon-btn"
            onClick={onImportFiles}
            disabled={isImporting}
            aria-label="Impor file"
          >
            <ImportIcon size={20} />
          </button>
          {entries.some(isSelectable) && (
            <button type="button" className="link-button" onClick={() => onEnterSelect('')}>
              Pilih
            </button>
          )}
          <span className="app-header__tier">{tier === 'pro' ? 'Pro' : 'Basic'}</span>
        </header>
      )}
```

- [ ] **Step 5: Add `.app-header__icon-btn` to `src/App.css`**

Find:

```css
.app-header__tier {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-dim);
  padding: 5px 11px;
  border-radius: 999px;
  background: var(--chip);
  border: 1px solid var(--chip-border);
}
```

Replace with:

```css
.app-header__tier {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-dim);
  padding: 5px 11px;
  border-radius: 999px;
  background: var(--chip);
  border: 1px solid var(--chip-border);
}

.app-header__icon-btn {
  width: 38px;
  height: 38px;
  border: none;
  background: none;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: var(--fg-dim);
}

.app-header__icon-btn:active {
  background: var(--chip);
}

.app-header__icon-btn:disabled {
  opacity: 0.6;
}
```

- [ ] **Step 6: Run the tests again to confirm they pass**

Run: `npm run test:browser -- DocumentsScreen.browser.test.tsx`
Expected: PASS, 22 tests (19 existing + 3 new).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Run the full browser suite to confirm nothing else broke**

Run: `npm run test:browser`
Expected: PASS, 161 tests (158 baseline + 3 new).

- [ ] **Step 9: Commit**

```bash
git add src/components/Icons.tsx src/screens/DocumentsScreen.tsx src/screens/DocumentsScreen.browser.test.tsx src/App.css
git commit -m "feat(dokumen-impor): tombol impor file di header layar Dokumen"
```

---

### Task 4: Sambungkan ke `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `pickFiles` from `src/lib/sharedImport.ts` (Task 2); `DocumentsScreenProps.onImportFiles`/`isImporting` (Task 3).
- Produces: nothing further downstream — this is the last task that touches application code. `App.tsx` gains one new piece of local state (`isImporting`) and two new functions (`ingestImportedFiles`, `handleImportFiles`), neither exported.

- [ ] **Step 1: Import `pickFiles` and the `SharedImportResult` type**

Find:

```tsx
import { onSharedFilesReceived } from './lib/sharedImport'
```

Replace with:

```tsx
import { onSharedFilesReceived, pickFiles, type SharedImportResult } from './lib/sharedImport'
```

- [ ] **Step 2: Add `isImporting` state**

Find:

```tsx
  const [isScanning, setIsScanning] = useState(false)
```

Replace with:

```tsx
  const [isScanning, setIsScanning] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
```

- [ ] **Step 3: Extract `ingestImportedFiles()` and simplify the share listener**

Find:

```tsx
  useEffect(() => {
    return onSharedFilesReceived(({ images, skippedCount }) => {
      if (images.length > 0) {
        if (pendingPagesRef.current) {
          // Mid-review already: same as handleAddPages -- append only. The new
          // pages' indices sit after every page already in the list.
          const startIndex = pendingPagesRef.current.length
          setPendingPages((existing) => [...(existing ?? []), ...images])
          setStraightenQueue((queue) => [...queue, ...images.map((_, i) => startIndex + i)])
        } else {
          // Nothing in progress: same as handleStartScan -- a fresh review
          // session. exitSplit() is called *first*, not last: it clears
          // straightenQueue too (see its own comment), and calling it after
          // setStraightenQueue below would silently wipe the queue this branch
          // is trying to fill — React applies same-tick setState calls for one
          // variable in the order they were made, and exitSplit's own call
          // would be the last word on straightenQueue if it ran second.
          exitSplit()
          setPendingPages(images)
          setStraightenQueue(images.map((_, i) => i))
          setCurrentPage(0)
          setReviewPreview(null)
        }
      }

      if (skippedCount > 0) {
        setToast(
          images.length > 0
            ? 'Sebagian file tidak bisa diimpor.'
            : 'Tidak ada file yang bisa diimpor.',
        )
      }
    })
  }, [])
```

Replace with:

```tsx
  // ingestImportedFiles is defined further down (next to handleAddPages,
  // which it mirrors), but is safe to reference here: this effect's callback
  // only runs after the component function has finished executing once, by
  // which point the const below has already been assigned -- same reasoning
  // as any other handler a mount effect closes over in this file.
  useEffect(() => {
    return onSharedFilesReceived(ingestImportedFiles)
  }, [])
```

- [ ] **Step 4: Add `ingestImportedFiles()` and `handleImportFiles()` next to `handleAddPages`**

Find:

```tsx
  const handleAddPages = async () => {
    const pages = await runScanner()
    if (!pages) return
    setPendingPages((existing) => [...(existing ?? []), ...pages])
  }
```

Replace with:

```tsx
  const handleAddPages = async () => {
    const pages = await runScanner()
    if (!pages) return
    setPendingPages((existing) => [...(existing ?? []), ...pages])
  }

  /**
   * Feeds picked/shared images into the pending-pages review flow, and
   * surfaces a toast if some of them could not be converted. Shared by the
   * passive share listener above and handleImportFiles below -- both hand it
   * exactly what the native side already agreed on (SharedImportResult), so
   * neither path duplicates this branching (spec §3).
   */
  const ingestImportedFiles = ({ images, skippedCount }: SharedImportResult) => {
    if (images.length > 0) {
      if (pendingPagesRef.current) {
        // Mid-review already: same as handleAddPages -- append only. The new
        // pages' indices sit after every page already in the list.
        const startIndex = pendingPagesRef.current.length
        setPendingPages((existing) => [...(existing ?? []), ...images])
        setStraightenQueue((queue) => [...queue, ...images.map((_, i) => startIndex + i)])
      } else {
        // Nothing in progress: same as handleStartScan -- a fresh review
        // session. exitSplit() is called *first*, not last: it clears
        // straightenQueue too (see its own comment), and calling it after
        // setStraightenQueue below would silently wipe the queue this branch
        // is trying to fill — React applies same-tick setState calls for one
        // variable in the order they were made, and exitSplit's own call
        // would be the last word on straightenQueue if it ran second.
        exitSplit()
        setPendingPages(images)
        setStraightenQueue(images.map((_, i) => i))
        setCurrentPage(0)
        setReviewPreview(null)
      }
    }

    if (skippedCount > 0) {
      setToast(
        images.length > 0
          ? 'Sebagian file tidak bisa diimpor.'
          : 'Tidak ada file yang bisa diimpor.',
      )
    }
  }

  const handleImportFiles = async () => {
    setIsImporting(true)
    try {
      const result = await pickFiles()
      ingestImportedFiles(result)
    } finally {
      setIsImporting(false)
    }
  }
```

- [ ] **Step 5: Pass the new props to `DocumentsScreen`**

Find:

```tsx
            onExitSelect={exitSelect}
            onBatchExport={() => setBatchOpen(true)}
            onBatchDelete={handleBatchDelete}
            onNotice={setToast}
          />
        )}
        {tab === 'settings' && (
```

Replace with:

```tsx
            onExitSelect={exitSelect}
            onBatchExport={() => setBatchOpen(true)}
            onBatchDelete={handleBatchDelete}
            onNotice={setToast}
            onImportFiles={handleImportFiles}
            isImporting={isImporting}
          />
        )}
        {tab === 'settings' && (
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual reasoning check (no automated test — matches spec §6)**

`App.tsx` has no dedicated test file today (confirmed: no `App.test.tsx`/`App.browser.test.tsx` exists), and this task doesn't add one — the branching it wires together (`ingestImportedFiles`'s mid-review-vs-fresh-session split) is the exact same code that already shipped and works in the share-sheet listener; only its call sites changed. Reason through, don't skip:

- The `useEffect` at Step 3 registers `onSharedFilesReceived(ingestImportedFiles)` once on mount, same as before — `ingestImportedFiles` is a fresh closure each render, but the effect's `[]` deps mean only the mount-time closure is ever used, exactly matching the original inline callback's behavior (it also closed over mount-time setters/refs only).
- `handleImportFiles` always resets `isImporting` to `false` in a `finally` block, so a picker cancellation, a rejected `pickFiles()` promise, or a normal completion all leave the button re-enabled — never stuck disabled.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(dokumen-impor): sambungkan tombol impor ke pickFiles() di App.tsx"
```

---

### Task 5: Code review, security check, dan update `TASKS.md`

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Jalankan code-review**

Jalankan `/code-review` untuk diff cabang ini (correctness + reuse + simplification). Nilai tiap temuan sebelum menerapkannya — temuan yang keliru dijawab dengan alasan, bukan diikuti (skill `superpowers:receiving-code-review`; memori "tutup temuan review sebelum lanjut" — jangan menumpuk temuan ke sesi berikutnya).

- [ ] **Step 2: Jalankan security-review**

Jalankan `/security-review` sebelum commit terakhir (CLAUDE.md 9.1). Fitur ini menyalin byte dari `content://` URI pihak lain (kali ini dipilih user sendiri lewat picker sistem, bukan dikirim dari app lain) ke cache app sendiri dan merender PDF pihak lain — perhatikan khusus: nama file tujuan (`shared-<nanoTime>[-<index>].jpg`) diturunkan dari `System.nanoTime()`, bukan dari nama asli berkas yang dipilih, jadi seharusnya tidak ada celah path traversal — tapi ini layak diverifikasi ulang saat review, bukan diasumsikan dari sini (pola yang sama dengan review Task 4 di plan `2026-08-26-share-target-import.md`).

- [ ] **Step 3: Verifikasi akhir**

Jalankan urutan penuh sebelum commit terakhir:

```powershell
npm run test:node
npm run test:browser
npm run build
$env:JAVA_HOME = "C:\Users\HP\AppData\Local\Programs\Eclipse Adoptium\jdk-21.0.12.1-hotspot"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
cd android; .\gradlew.bat assembleDebug
```

Semuanya harus lolos — `gradlew.bat assembleDebug` di sini bukan cuma typecheck, harus benar-benar `BUILD SUCCESSFUL`. Catat hasil aktualnya (jumlah test tiap suite, exit code build) di langkah berikutnya — bukan diasumsikan lolos.

- [ ] **Step 4: Update `TASKS.md`**

`TASKS.md` saat ini punya paragraf yang diakhiri "...celah pra-ada, di luar cakupan perubahan ini, dicatat di sini supaya tidak hilang." tepat sebelum baris `---` yang mendahului `## Status Keputusan`. Sisipkan section baru **di antara** keduanya:

```markdown

## Impor File Aktif (Gambar/PDF) di Menu Dokumen — 2 September 2026

Bagian kedua dari dua permintaan Boss Ali di menu Dokumen (bagian pertama:
pencarian nama dokumen, lihat section di atas). Desain:
`docs/superpowers/specs/2026-09-02-dokumen-impor-file-design.md`, plan:
`docs/superpowers/plans/2026-09-02-dokumen-impor-file.md`.

- [x] **`SharedImportPlugin.java` diperluas, bukan plugin baru.** Logika
      konversi URI→JPEG yang sudah ada (salin gambar / rasterisasi PDF lewat
      `PdfRenderer`) diekstrak jadi `convertUris()`, dipakai bersama oleh
      jalur pasif (share sheet) yang sudah ada **dan** jalur aktif baru
      (`pickFiles()` via `Intent.ACTION_OPEN_DOCUMENT` +
      `startActivityForResult`/`@ActivityCallback`)
- [x] **Tidak ada izin runtime baru** — SAF memberi akses baca per-URI lewat
      grant sistem, bukan `READ_EXTERNAL_STORAGE`
- [x] **Boleh pilih banyak file sekaligus** (`EXTRA_ALLOW_MULTIPLE`), dan
      picker sistem Android otomatis mengagregasi folder lokal + provider
      cloud terpasang (Google Drive, dst) tanpa integrasi API per provider
- [x] **Membatalkan picker bukan error** — resolve kosong, tidak ada toast,
      sama seperti membatalkan alur lain di aplikasi ini
- [x] **`App.tsx`: `ingestImportedFiles()` baru** memakai ulang persis
      logika "gambar masuk → antre tinjau" yang sebelumnya cuma dipakai
      listener share pasif — sekarang dipakai bersama oleh listener itu dan
      tombol impor baru, tidak ada logika yang digandakan
- [x] **Tombol ikon baru di header layar Dokumen**, sebelum tombol "Pilih",
      nonaktif selama proses impor berjalan
- [x] **Tier: semua tier, tanpa gerbang** — pola yang sama dengan
      reorder/filter/PNG/anotasi/pisah/share-pasif
- [x] **DOCX sengaja tidak dicakup** — dipisah jadi sub-proyek tersendiri,
      mewarisi keputusan 26 Agustus 2026
- [x] **Test bertambah: 4 di `sharedImport.test.ts` (node) + 3 di
      `DocumentsScreen.browser.test.tsx` (browser)** (ganti angka-angka di
      baris ini kalau hasil Step 3 di atas ternyata beda)
- [x] **Build native sungguhan lolos**, bukan cuma typecheck:
      `gradlew.bat assembleDebug` → `BUILD SUCCESSFUL`

**Belum diverifikasi di device fisik** (butuh Boss Ali):

- [ ] Ketuk tombol impor → picker sistem Android terbuka, menampilkan folder
      lokal **dan** akun Google Drive yang terpasang di HP
- [ ] Pilih beberapa gambar sekaligus → semuanya masuk ke alur tinjau yang
      sama seperti hasil scan
- [ ] Pilih satu PDF pihak ketiga (bukan hasil ScannApp) → dirasterisasi
      jadi beberapa halaman, masuk ke alur tinjau
- [ ] Batalkan picker (tombol kembali/back gesture) → tidak ada toast, tidak
      ada perubahan pada layar Dokumen
- [ ] Impor saat sedang di tengah sesi tinjau (habis scan, belum simpan) →
      halaman baru nambah di akhir, bukan sesi baru
```

Kalau jumlah test yang keluar dari Step 3 bukan seperti yang tertulis di atas, koreksi angkanya di baris yang baru ditambahkan sebelum commit.

- [ ] **Step 5: Commit**

```bash
git add TASKS.md
git commit -m "docs(tasks): catat impor file aktif & daftar uji device"
```

---

## Catatan penutup untuk pelaksana

- Task 1 (native) tidak punya test otomatis — `gradlew.bat assembleDebug` yang benar-benar `BUILD SUCCESSFUL` adalah bukti satu-satunya sebelum lanjut ke Task 2. Jangan lanjut kalau step itu gagal.
- Task 3 dan Task 4 saling bergantung lewat kontrak prop (`onImportFiles`, `isImporting`) — kalau nama atau tipe salah satunya berubah saat implementasi, perbarui keduanya di task yang sama, jangan biarkan drift antar task.
- Task 4 Step 7 sengaja bukan test otomatis — ini konsisten dengan `App.tsx` yang sekarang memang tidak punya berkas test sendiri (spec §6), bukan langkah yang dilewati karena malas.
