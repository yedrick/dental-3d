import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { translateError } from "@/lib/translate-error";

/**
 * Si una consulta falla, se avisa (antes la lista quedaba vacía o el panel en Bs 0,00 como si no
 * hubiera datos). Un mensaje igual no se repite; la sesión vencida (401) ya la avisa auth.tsx.
 */
let lastError = { message: "", at: 0 };
function notifyQueryError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return;
  const message = translateError(error) || "No se pudieron cargar los datos";
  const now = Date.now();
  if (message === lastError.message && now - lastError.at < 10_000) return;
  lastError = { message, at: now };
  toast.error(`No se pudieron cargar los datos: ${message}`, { id: `query-error:${message}` });
}
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError: notifyQueryError }),
    defaultOptions: {
      queries: {
        // Por defecto, datos de operación diaria; cada pantalla usa STALE (src/lib/query-config.ts)
        staleTime: 20_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        refetchOnReconnect: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });


  return router;
};

