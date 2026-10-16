import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        // Firebase is large and rarely changes: a separate chunk keeps it cached between deploys.
        manualChunks: id => (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase') ? 'firebase' : undefined),
      },
    },
    chunkSizeWarningLimit: 700,
  },
});
