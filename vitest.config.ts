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
          // Left unbundled, the helper reaches `react-dom/client` as raw CJS
          // and the import fails for want of a default export, so React itself
          // has to stay pre-bundled into ESM.
          include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime'],
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
