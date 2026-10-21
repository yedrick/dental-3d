import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// Frontend (TanStack Start). Desarrollo: http://<sucursal>.localhost:8080, con /api, /tenancy y
// /admin reenviados a la API Node. Producción: build de Node (node .output/server/index.mjs) detrás de nginx.
const API_URL = process.env.API_URL ?? "http://localhost:4000";

export default defineConfig(({ command }) => ({
  plugins: [
    tailwindcss(),
    tanstackStart({
      // El código de servidor no puede terminar en el bundle del navegador
      importProtection: { behavior: "error", client: { files: ["**/server/**"], specifiers: ["server-only"] } },
      // Entrada del servidor: src/server.ts (página de error si falla el render en el servidor)
      server: { entry: "server" },
    }),
    // Solo al compilar: servidor Node para producción
    command === "build" && nitro({ preset: "node-server" }),
    viteReact(),
  ],
  // Mismo procesador de CSS en desarrollo y en el build (así lo que se ve en dev es lo que se publica)
  css: { transformer: "lightningcss" },
  resolve: {
    // Rutas de tsconfig.json (@/…) resueltas por Vite
    tsconfigPaths: true,
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  server: {
    host: "::",
    port: 8080,
    // La API sabe de qué sucursal es cada petición por el Host: se reenvía sin cambiarlo
    proxy: {
      "/api": { target: API_URL, changeOrigin: false },
      "/tenancy": { target: API_URL, changeOrigin: false },
      // Panel de la plataforma (tenancy-node), solo en el dominio central: http://localhost:8080/admin/
      "/admin": { target: API_URL, changeOrigin: false },
    },
  },
}));
