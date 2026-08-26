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
