import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The web app's "@/..." imports resolve the same way under vitest as they do under Next.
// next/headers is pinned to the copy the app itself loads: next lives in web/node_modules, so a test at the
// repo root and a route under web/src would otherwise resolve it to two different modules, and a vi.mock in
// the test would silently miss the one the route is using.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./web/src', import.meta.url)),
      'next/headers': fileURLToPath(new URL('./web/node_modules/next/headers.js', import.meta.url)),
    },
  },
});
