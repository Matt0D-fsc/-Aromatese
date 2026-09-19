import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The web app's "@/..." imports resolve the same way under vitest as they do under Next.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) } },
});
