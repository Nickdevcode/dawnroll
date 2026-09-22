import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    // three + rapier (wasm embutido em base64) passam fácil de 500 kB; o aviso não ajuda aqui.
    chunkSizeWarningLimit: 4000,
  },
});
