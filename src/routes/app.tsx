import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/app")({
  ssr: false,
  component: AppLayout,
});

function GlobalLoader() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const active = fetching + mutating > 0;
  return (
    <>
      <div
        className={`pointer-events-none fixed left-0 right-0 top-0 z-50 h-0.5 overflow-hidden bg-transparent transition-opacity ${active ? "opacity-100" : "opacity-0"}`}
      >
        <div className="h-full w-1/3 animate-[loader_1s_ease-in-out_infinite] bg-primary" />
      </div>
      {active && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Cargando…
        </div>
      )}
      <style>{`@keyframes loader{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}`}</style>
    </>
  );
}

function AppLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);
  if (loading || !user) return (
    <div className="grid min-h-screen place-items-center gap-3 text-sm text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <div>Cargando…</div>
    </div>
  );

  return (
    <SidebarProvider>
      <GlobalLoader />
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="flex h-12 items-center gap-2 border-b bg-background px-3">
            <SidebarTrigger />
            <div className="text-sm font-medium">Dental-3D</div>
          </header>
          <main className="flex-1 bg-muted/30 p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

