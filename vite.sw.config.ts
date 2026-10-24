import { defineConfig } from 'vite';

/**
 * The service worker is built separately as one IIFE, so it can never pick up
 * `import` statements from chunks shared with the app (classic service workers
 * can't run modules).
 */
export default defineConfig({
  build: {
    emptyOutDir: false,
    copyPublicDir: false,
    rollupOptions: {
      input: 'src/sw.ts',
      output: { format: 'iife', entryFileNames: 'sw.js', inlineDynamicImports: true },
    },
  },
});
