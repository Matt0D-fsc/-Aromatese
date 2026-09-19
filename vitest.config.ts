import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The web app's "@/..." imports resolve the same way under vitest as they do under Next.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) } },
  // Gemini calls are replayed from recordings instead of made for real. See tests/gemini-tape.ts.
  test: { setupFiles: ['./tests/gemini-tape.ts'] },
});
