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
