import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'

/**
 * Two suites, because two kinds of code need two kinds of proof.
 *
 * `node` is the bulk of it: pure logic — tier maths, index migration, quota,
 * filter pixel maths — which runs fastest and most reliably with no DOM at all.
 *
 * `browser` exists for the code whose whole job is to talk to the browser.
 * `imageEditor` is the clearest case: its correctness lives in `canvas.toBlob`
 * and the JPEG/PNG encoders behind it, so a mocked canvas would only prove that
 * the mock was called. React components go here too — they were previously
 * untestable, which let three review findings through in the editor UI.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          // Edge Function helpers are plain TypeScript, so CI covers them too.
          include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
          // Browser specs match the pattern above; they belong to the other project.
          exclude: ['**/*.browser.test.*', '**/node_modules/**'],
        },
      },
      {
        plugins: [react()],
        /*
          Left out of Vite's dependency pre-bundling. Bundled, it carries its
          own copy of `vitest` along with it, and that copy has no test runner
          attached — every component spec then fails to import with "Vitest
          failed to find the runner".
        */
        optimizeDeps: {
          exclude: ['vitest-browser-react'],
          /*
            React entries stay pre-bundled into ESM for the reason above. The
            five Capacitor native plugins are here for a different reason:
            left undeclared, Vite discovers them lazily mid-run the first time
            a cold run's dependency crawl reaches whichever lib file imports
            them (adsService.ts -> @capacitor-community/admob,
            crashlytics.ts -> @capacitor-firebase/crashlytics,
            documentScanner.ts -> @capacitor-mlkit/document-scanner, ocr.ts ->
            @capacitor-mlkit/text-recognition, purchasesService.ts ->
            @revenuecat/purchases-capacitor), triggers "optimized dependencies
            changed. reloading" mid-suite, and can tear down an unrelated
            test's dynamic import in the process (CI run 33972024211, 5
            September 2026 — PageViewerScreen.browser.test.tsx failed to
            import on a cold cache, nothing to do with that file itself).
            None of the five ever runs in a browser — they no-op behind
            Capacitor.isNativePlatform() guards — so this is purely about
            forcing the optimizer to settle on them up front instead of
            discovering them partway through a run.
          */
          include: [
            'react',
            'react-dom',
            'react-dom/client',
            'react/jsx-dev-runtime',
            '@capacitor-community/admob',
            '@capacitor-firebase/crashlytics',
            '@capacitor-mlkit/document-scanner',
            '@capacitor-mlkit/text-recognition',
            '@revenuecat/purchases-capacitor',
            // Same story, confirmed by reproducing the cold-cache race
            // locally (`rm -rf node_modules/.vite && vitest run --project
            // browser`): pdf-lib is a large, statically-imported dependency
            // (pdfExport.ts, pdfImport.ts, watermark.ts) that a first-ever
            // crawl can still discover after test execution has begun.
            'pdf-lib',
          ],
        },
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
