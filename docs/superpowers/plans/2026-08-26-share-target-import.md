# Impor via Share Sheet Android — Gambar & PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ScannApp muncul di daftar "Bagikan ke..." Android saat user membagikan gambar atau PDF dari aplikasi lain (WPS Office, CamScanner, galeri, dst.), dan file itu masuk lewat alur review-scan yang sudah ada.

**Architecture:** Plugin Capacitor native kecil (`SharedImportPlugin.java`, ditulis langsung di app, bukan paket npm) menangkap `ACTION_SEND`/`ACTION_SEND_MULTIPLE` lewat satu titik masuk (`handleOnNewIntent`, yang menutupi kasus dingin maupun hangat sekaligus — lihat spec §3.2). Gambar disalin ke cache, PDF dirasterisasi per halaman lewat `PdfRenderer` bawaan Android. Hasilnya dikirim ke JS lewat satu event Capacitor (`sharedFilesReceived`, `retainUntilConsumed: true`), dibungkus `src/lib/sharedImport.ts`, lalu disambungkan ke `pendingPages` yang sudah ada di `App.tsx` — 100% reuse `ReviewScreen`, tidak ada layar baru.

**Tech Stack:** React + TypeScript + Vite + Capacitor 8; Java native plugin (Android SDK bawaan, `android.graphics.pdf.PdfRenderer`, nol dependency baru); Vitest suite `node` untuk `sharedImport.ts`.

**Spec:** `docs/superpowers/specs/2026-08-26-share-target-import-design.md`

## Global Constraints

- **Tier: semua tier, tanpa gerbang sama sekali** (spec header; CLAUDE.md Bagian 6 — menerima file itu akses, bukan mesin baru).
- **Cakupan sesi ini: gambar (`image/*`) dan PDF (`application/pdf`) saja.** `.docx` dan tipe lain **tidak** didaftarkan di manifest — sengaja tidak muncul di share sheet sampai spec terpisah untuk itu ada (spec §1).
- **Nol dependency baru**, npm maupun Gradle. `PdfRenderer` adalah API bawaan Android sejak API 21; `minSdkVersion` proyek ini 24, jadi tidak perlu version-guard untuk kelas itu sendiri.
- **`EXTRA_STREAM` diambil lewat overload yang API-33-aware** (`getParcelableExtra(String, Class)` di atas `Build.VERSION_CODES.TIRAMISU`, fallback ke overload lama di bawahnya) — `compileSdk`/`targetSdk` proyek ini 36, overload lama sudah deprecated di level itu.
- **Bahasa komentar:** Inggris di `SharedImportPlugin.java` dan `sharedImport.ts`, mengikuti `documentScanner.ts` yang sudah jadi tetangga langsungnya (CLAUDE.md Bagian 4: konsisten per file, dan berkas baru boleh mengikuti tetangga terdekatnya). Teks yang dilihat user (toast) tetap Bahasa Indonesia.
- **Penamaan:** `camelCase.ts` untuk berkas lib baru, `PascalCase.java` untuk kelas plugin (konvensi Java, bukan penyimpangan dari CLAUDE.md yang mengatur JS/TS).
- **Angka teknis, boleh disetel ulang tanpa bertanya** (spec §2): target rasterisasi PDF ~2400px sisi terpanjang, batas 50 halaman per PDF yang dibagikan.
- **`skippedCount` dihitung native, disapaikan JS** (spec §6) — plugin tidak pernah menyusun kalimat toast sendiri, itu tugas `App.tsx`.
- Perintah test: `npm run test:node` (suite node). Typecheck: `npm run build`. Native: `cd android && ./gradlew.bat assembleDebug` (Windows) untuk memastikan Java-nya kompilasi — tidak ada suite vitest yang menyentuh kode Android (spec §8), jadi ini satu-satunya "test" otomatis untuk Task 1.
- Basis test sekarang: **647 node tests** (dicek langsung dengan `npm run test:node`, 26 Agustus 2026 sore).

---

### Task 1: Native — plugin, manifest, registrasi

**Files:**
- Create: `android/app/src/main/java/com/newbeboys/scannapp/SharedImportPlugin.java`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/java/com/newbeboys/scannapp/MainActivity.java`

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the first task).
- Produces: a Capacitor event named `sharedFilesReceived`, payload `{ paths: string[], skippedCount: number }`, delivered via `notifyListeners(..., retainUntilConsumed = true)`. Task 2's JS wrapper registers a listener for exactly this event name and payload shape.

- [ ] **Step 1: Write `SharedImportPlugin.java`**

```java
package com.newbeboys.scannapp;

import android.content.ContentResolver;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Catches files shared in from other apps (WPS Office, CamScanner, etc.) via
 * the Android share sheet (ACTION_SEND / ACTION_SEND_MULTIPLE) and hands them
 * to JS as a ready-to-use list of image paths.
 *
 * Single entry point: handleOnNewIntent. BridgeActivity.onCreate() ends its
 * load() by calling onNewIntent(getIntent()) (confirmed by reading
 * BridgeActivity.java in node_modules, not assumed), so both a cold launch
 * (app opened via share) and an intent arriving while the app is already
 * running (MainActivity is launchMode="singleTop") go through this exact
 * same method. No separate load() override is needed.
 */
@CapacitorPlugin(name = "SharedImport")
public class SharedImportPlugin extends Plugin {

    private static final String EVENT_NAME = "sharedFilesReceived";
    private static final String CACHE_SUBDIR = "shared-import";
    private static final int MAX_PDF_PAGES = 50;
    private static final int PDF_RENDER_TARGET_PX = 2400;

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null) return;

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

        List<String> outputPaths = new ArrayList<>();
        int skippedCount = 0;
        ContentResolver resolver = getContext().getContentResolver();

        for (Uri uri : uris) {
            String mimeType = resolver.getType(uri);
            try {
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
                    // The manifest already restricts what reaches ScannApp as a
                    // share target; this branch only matters for a mixed-type
                    // SEND_MULTIPLE that slipped through.
                    skippedCount++;
                }
            } catch (Exception e) {
                // A corrupt or unreadable file must not take the rest of the
                // share down with it.
                skippedCount++;
            }
        }

        JSArray paths = new JSArray();
        for (String path : outputPaths) {
            paths.put(path);
        }
        JSObject data = new JSObject();
        data.put("paths", paths);
        data.put("skippedCount", skippedCount);
        notifyListeners(EVENT_NAME, data, true);
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
     * Copies a shared image into the app's own cache. The content:// read
     * permission granted by a share is only valid while it is being handled,
     * so this has to happen synchronously and immediately.
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
        }
        return "file://" + out.getAbsolutePath();
    }

    /**
     * Rasterizes a third-party PDF page-by-page via the platform's own
     * PdfRenderer (API 21+, no new dependency). pdfImport.ts cannot be reused
     * here: it only works for PDFs ScannApp itself wrote (exactly one raw
     * JPEG XObject per page) -- a PDF from CamScanner/WPS makes no such
     * promise, so it needs a real rasterizer instead of an XObject lookup.
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

- [ ] **Step 2: Add the intent-filters to `AndroidManifest.xml`**

Open `android/app/src/main/AndroidManifest.xml`. Inside the existing `<activity android:name=".MainActivity" ...>` block, right after the existing MAIN/LAUNCHER `<intent-filter>` and before the closing `</activity>`, add:

```xml
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
            </intent-filter>

            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="application/pdf" />
            </intent-filter>

            <intent-filter>
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
            </intent-filter>
```

(Split per action+mimeType, not combined — Android's intent-filter matching for `<data>` does not reliably OR multiple `android:mimeType` values inside one filter across versions, so this is the standard pattern for accepting more than one MIME type on a share target.)

- [ ] **Step 3: Register the plugin in `MainActivity.java`**

Replace the whole file:

```java
package com.newbeboys.scannapp;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must run before super.onCreate(): that call is what builds the
        // bridge and immediately replays the launch intent through it (see
        // BridgeActivity.load()), so the plugin has to already be registered.
        registerPlugin(SharedImportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
```

- [ ] **Step 4: Compile-check the native change**

Run (PowerShell, from repo root):

```
cd android; .\gradlew.bat assembleDebug
```

Expected: `BUILD SUCCESSFUL`. This is the only automated verification available for this task — no vitest suite touches Android code (spec §8). If it fails, fix the Java before moving on; do not defer a compile error to Task 4.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/newbeboys/scannapp/SharedImportPlugin.java android/app/src/main/AndroidManifest.xml android/app/src/main/java/com/newbeboys/scannapp/MainActivity.java
git commit -m "feat(share-target): terima gambar & PDF lewat Android share sheet (native)"
```

---

### Task 2: Jembatan JS — `src/lib/sharedImport.ts`

**Files:**
- Create: `src/lib/sharedImport.ts`
- Test: `src/lib/sharedImport.test.ts`

**Interfaces:**
- Consumes: the native `SharedImport` plugin's `sharedFilesReceived` event, payload `{ paths: string[], skippedCount: number }` (Task 1).
- Produces:
  - `export interface SharedImportResult { images: string[]; skippedCount: number }`
  - `export function onSharedFilesReceived(callback: (result: SharedImportResult) => void): () => void`

  Task 3 imports `onSharedFilesReceived` from this file and calls it once on mount.

- [ ] **Step 1: Write the failing test**

Create `src/lib/sharedImport.test.ts`:

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
  }),
}))

const { onSharedFilesReceived } = await import('./sharedImport')

beforeEach(() => {
  isNative = true
  registeredListener = null
  addListenerMock.mockClear()
  removeMock.mockClear()
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
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:node -- sharedImport`
Expected: FAIL — `Cannot find module './sharedImport'` (the file does not exist yet).

- [ ] **Step 3: Write `src/lib/sharedImport.ts`**

```ts
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
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `npm run test:node -- sharedImport`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the full node suite to confirm nothing else broke**

Run: `npm run test:node`
Expected: PASS, 653 tests (647 existing + 6 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/sharedImport.ts src/lib/sharedImport.test.ts
git commit -m "feat(share-target): jembatan JS ke plugin SharedImport"
```

---

### Task 3: Sambungkan ke `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `onSharedFilesReceived` and `SharedImportResult` from `src/lib/sharedImport.ts` (Task 2); existing `pendingPages`/`setPendingPages` state and `setToast` (already in `App.tsx`).
- Produces: nothing new for later tasks — this is the last functional task.

- [ ] **Step 1: Import `onSharedFilesReceived`**

In `src/App.tsx`, add to the import block (alongside the other `./lib/...` imports, e.g. right after the `scanDocument` import at line 37):

```ts
import { onSharedFilesReceived } from './lib/sharedImport'
```

- [ ] **Step 2: Register the listener in a mount effect**

Add a new `useEffect` right after the existing one that calls `refreshDocuments`/`refreshBackupState` (the block starting `useEffect(() => { if (status !== 'signed-in') return; ...`, around `App.tsx:196-200`):

```tsx
  useEffect(() => {
    return onSharedFilesReceived(({ images, skippedCount }) => {
      if (images.length > 0) {
        setPendingPages((existing) => (existing ? [...existing, ...images] : images))
        setReviewPreview(null)
        setSplitting(false)
        setSplitCuts([])
        setSplitName('')
        setSplitProgress(null)
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

(The five setters used here — `setPendingPages`, `setReviewPreview`, `setSplitting`, `setSplitCuts`, `setSplitName`, `setSplitProgress`, `setToast` — are the same ones `handleStartScan`/`handleAddPages`/`exitSplit` already use; they are React state setters, stable across renders, so the empty dependency array is correct: this effect only needs to run once, to register the listener for the component's lifetime.)

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: succeeds, no TypeScript errors.

- [ ] **Step 4: Manual reasoning check (no automated test — matches spec §8)**

Confirm by reading the code you just wrote:
- If `pendingPages` was `null`, it is now the shared images, and `App.tsx:892`'s `if (pendingPages)` block renders `ReviewScreen` unconditionally of `tab`/`view` — so the review screen opens.
- If `pendingPages` already had pages (mid-review of an earlier scan), the shared images are appended, not replacing the array — no unsaved work is lost.
- An empty `images` array with `skippedCount === 0` (defensive case — native only sends the event when `uris` was non-empty, so this specific combination should not occur in practice) leaves `pendingPages` untouched and shows no toast, which is the safe default either way.

This task's real verification is the device checklist in Task 4 / `TASKS.md`, not a unit test — this mirrors how `handleStartScan`/`handleAddPages` themselves have no component test today (checked: no `App.browser.test.tsx` exists).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(share-target): sambungkan file yang dibagikan ke alur review scan"
```

---

### Task 4: Code review, security check, dan update `TASKS.md`

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Jalankan code-review**

Jalankan `/code-review` untuk diff cabang ini (correctness + reuse + simplification). Nilai tiap temuan sebelum menerapkannya — temuan yang keliru dijawab dengan alasan, bukan diikuti (skill `superpowers:receiving-code-review`; memori "tutup temuan review sebelum lanjut" — jangan menumpuk temuan ke potongan berikutnya kalau ada sesi lanjutan).

- [ ] **Step 2: Jalankan security-review**

Jalankan `/security-review` sebelum commit terakhir (CLAUDE.md 9.1). Fitur ini menyalin byte dari `content://` URI pihak lain ke cache app sendiri dan merender PDF pihak lain — perhatikan khusus: apakah nama file tujuan (`shared-<nanoTime>[-<index>].jpg`) pernah bisa dipengaruhi oleh data dari URI yang dibagikan (path traversal) — jawabannya seharusnya tidak, karena nama file diturunkan dari `System.nanoTime()`, bukan dari nama asli berkas yang dibagikan, tapi ini layak diverifikasi ulang saat review, bukan diasumsikan dari sini.

- [ ] **Step 3: Verifikasi akhir**

Jalankan urutan penuh sebelum commit terakhir:

```
npm run test:node
npm run build
cd android; .\gradlew.bat assembleDebug
```

Ketiganya harus lolos. Catat hasil aktualnya (jumlah test, exit code build) di langkah berikutnya — bukan diasumsikan lolos.

- [ ] **Step 4: Update `TASKS.md`**

`TASKS.md` saat ini punya baris `## Fase 7 — AI Enhance...` tepat setelah daftar "Belum diverifikasi di device fisik" yang menutup Fase 6 (baris "Judul & tanggal dokumen terbaca benar di properti berkas Word"). Sisipkan section baru **di antara** keduanya — setelah baris itu, sebelum `## Fase 7`:

```markdown
## Impor via Share Sheet Android — Gambar & PDF — 26 Agustus 2026

Dipicu temuan Boss Ali: ScannApp tidak muncul di daftar "Bagikan ke..." saat berbagi
dari WPS Office/CamScanner. Bukan soal Play Store — fitur penerimaan share intent
memang belum pernah dibangun. Desain: `docs/superpowers/specs/2026-08-26-share-target-import-design.md`.

- [x] **Plugin Capacitor native kecil (`SharedImportPlugin.java`), nol dependency baru.** Satu titik masuk, `handleOnNewIntent` — dikonfirmasi lewat pembacaan langsung `BridgeActivity.java` di node_modules bahwa `onCreate` sudah memutar ulang intent peluncuran lewat jalur yang sama, jadi kasus dingin dan hangat tidak perlu dua method terpisah
- [x] **PDF pihak ketiga dirasterisasi lewat `PdfRenderer` bawaan Android**, bukan reuse `pdfImport.ts` — itu cuma jalan untuk PDF buatan ScannApp sendiri (satu JPEG mentah per halaman)
- [x] **`retainUntilConsumed=true` bawaan Capacitor menggantikan kebutuhan method pull terpisah** — listener yang baru dipasang tetap menerima share yang tiba sebelum app selesai mount
- [x] **Tier: semua tier, tanpa gerbang** — menerima file itu akses, bukan mesin baru (pola yang sama dengan reorder/filter/PNG/anotasi/pisah)
- [x] **Masuk lewat `pendingPages` yang sudah ada, tanpa layar baru** — append kalau user sedang di tengah review lain, replace kalau kosong; tidak pernah menimpa kerja yang belum disimpan
- [x] **Ditunda ke spec terpisah: `.docx` sebagai lampiran.** `LocalScanDocument` strict berbentuk `pages: ScanPage[]`, dipakai di 31 berkas — kind dokumen baru tanpa pages itu subsistem sendiri, bukan bagian kecil dari fitur ini
- [x] **Test node: 647 → 653** (6 test baru di `sharedImport.test.ts`, Task 2; ganti angka ini kalau hasil `npm run test:node` di Step 3 ternyata beda)
- [x] **Dua temuan review ditutup di Task 1** (round 1/5, kode plan sendiri yang salah, bukan implementer): `resolver.getType(uri)` sempat di luar try/catch per-item — satu file rusak bisa menggagalkan `notifyListeners` untuk seluruh share, bukan cuma file itu; dan `handleOnNewIntent` sempat memproses semua file secara sinkron di main thread (risiko ANR untuk PDF banyak halaman) — dipindah ke `ExecutorService` satu thread

**Belum diverifikasi di device fisik** (butuh Boss Ali — disalin dari spec §9):

- [ ] Share 1 foto dari galeri/app lain ke ScannApp saat app tertutup → app terbuka, langsung di layar review dengan foto itu
- [ ] Share 1 foto saat ScannApp sedang di foreground (bukan di tengah review) → langsung ke review
- [ ] Share saat sedang di tengah review scan lain yang belum disimpan → foto baru ditambahkan, bukan menimpa halaman yang sudah ada
- [ ] Share beberapa foto sekaligus (pilih multi di galeri → share) → semua masuk sebagai halaman, urutannya sesuai
- [ ] Share PDF dari WPS Office → tiap halaman PDF jadi halaman terpisah di review, kualitas gambar terbaca jelas
- [ ] Share PDF hasil CamScanner → sama, dan pastikan bukan cuma halaman pertama yang muncul
- [ ] Share file docx dari WPS Office → tidak muncul di daftar app (mime type tidak didaftarkan di manifest sesi ini) — perilaku yang diharapkan, bukan bug
- [ ] Share PDF terenkripsi/rusak sengaja → toast error, app tidak crash
- [ ] Ukuran APK & waktu build setelah plugin Java baru — tidak ada regresi mencolok
```

Kalau jumlah test node yang keluar dari Step 3 bukan 653, koreksi angka itu di baris yang baru ditambahkan sebelum commit.

- [ ] **Step 5: Commit**

```bash
git add TASKS.md
git commit -m "docs(tasks): catat impor share sheet Android & daftar uji device"
```

---

## Catatan penutup untuk pelaksana

- **Yang sengaja TIDAK dikerjakan di sesi ini** (spec §1): menerima `.docx` atau tipe berkas non-gambar lain lewat share sheet. Itu subsistem terpisah — kind dokumen baru tanpa `pages`, menyentuh 31 berkas yang berasumsi dokumen = kumpulan halaman gambar. Jangan mulai mengerjakannya di sini walau tergoda karena manifest sudah disentuh; itu butuh spec sendiri.
- **Jangan menambah `getPendingSharedFiles()` atau method pull manapun ke `sharedImport.ts`.** Itu godaan yang sudah dicoba dan dibuang saat brainstorming (lihat spec §3.2/§4) — `retainUntilConsumed: true` di sisi native sudah menutupi kasus dingin lewat mekanisme bawaan Capacitor, dan method pull kedua di sana cuma jadi jalur mati yang tidak pernah perlu dipanggil.
- **Kalau muncul keputusan bisnis/angka baru** yang tidak ada di spec (mis. mau membatasi fitur ini ke tier tertentu setelah semua ini, atau menambah tipe file lain) — berhenti dan tanya Boss Ali, jangan mengarang sendiri (CLAUDE.md Bagian 5 poin 5).
- **Kalau `gradlew.bat assembleDebug` gagal karena masalah environment** (SDK belum terpasang, `local.properties` hilang, dst.) bukan karena kode Java yang salah — laporkan itu dengan jelas ke Boss Ali sebagai blocker environment, jangan coba "perbaiki" dengan mengubah kode yang sudah benar.
