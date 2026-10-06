import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000,
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
  },
  plugins: [viteSingleFile()],
});
