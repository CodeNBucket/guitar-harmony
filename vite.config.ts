import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // relative asset paths, so the build works from any folder (GitHub Pages included)
  base: './',
  server: { port: 5174, strictPort: true },
});
