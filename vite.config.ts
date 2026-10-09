// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Producción en servidor propio: build de Node (node .output/server/index.mjs) en lugar de
  // Cloudflare. Dentro de Lovable el paquete sigue forzando Cloudflare.
  nitro: { preset: "node-server" },
  vite: {
    server: {
      // En desarrollo: abrir http://<sucursal>.localhost:8080. Vite reenvía /api y /tenancy a la
      // API Node conservando el Host, así la API sabe de qué sucursal es cada petición.
      proxy: {
        "/api": { target: process.env.API_URL ?? "http://localhost:4000", changeOrigin: false },
        "/tenancy": { target: process.env.API_URL ?? "http://localhost:4000", changeOrigin: false },
      },
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
