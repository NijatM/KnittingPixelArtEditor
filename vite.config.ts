import { defineConfig } from 'vite';

// Served from https://<user>.github.io/KnittingPixelArtEditor/
export default defineConfig({
  base: '/KnittingPixelArtEditor/',
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
