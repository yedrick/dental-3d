import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/auth";
import { BrandingProvider } from "@/lib/branding";
import { Toaster } from "@/components/ui/sonner";
import { GlobalLoader } from "@/components/global-loader";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página no encontrada</h2>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Ir al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  // Queda en la consola del navegador
  useEffect(() => { console.error(error); }, [error]);
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Error al cargar</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <button onClick={() => { router.invalidate(); reset(); }} className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Reintentar</button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "IONIX · Gestión para centros de radiología dental" },
      { name: "description", content: "IONIX: sistema para centros de radiología dental. Pacientes, atenciones, cobros, comisiones, caja, reportes y página web propia." },
      { property: "og:site_name", content: "IONIX" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <AuthProvider>
          <GlobalLoader />
          <Outlet />
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </BrandingProvider>
    </QueryClientProvider>
  );
}
