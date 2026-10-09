import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
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

