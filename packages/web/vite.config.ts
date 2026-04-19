import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  define: {
    // amazon-cognito-identity-js pulls in the `buffer` polyfill which references
    // the Node-only `global`. Alias it to `globalThis` so it works in the browser.
    global: 'globalThis',
  },
});
