import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Edge Function helpers are plain TypeScript, so CI covers them too.
    include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
  },
})
