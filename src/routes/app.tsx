import { createFileRoute, Outlet, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { NotificationBell } from "@/components/notification-bell";
import logoAsset from "@/assets/logo-3d.png.asset.json";

export const Route = createFileRoute("/app")({
  ssr: false,
  component: AppLayout,
});

function GlobalLoader() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const active = fetching + mutating > 0;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 400);
    return () => clearTimeout(t);
  }, [active]);
  if (!show) return null;
  return (
    <div className="fixed top-3 right-3 z-50 flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
      <span>Actualizando…</span>
    </div>
  );
}



function ImpersonationBanner() {
  const { user } = useAuth();
  const [info, setInfo] = useState<{ admin_email?: string } | null>(null);
  useEffect(() => {
    const raw = sessionStorage.getItem("impersonation_return");
    if (raw) { try { setInfo(JSON.parse(raw)); } catch { setInfo(null); } }
  }, [user?.id]);
  if (!info) return null;
  const back = async () => {
    try {
      const raw = sessionStorage.getItem("impersonation_return");
      if (!raw) return;
      const { refresh_token } = JSON.parse(raw);
      const { error } = await supabase.auth.refreshSession({ refresh_token });
      if (error) throw error;
      sessionStorage.removeItem("impersonation_return");
      toast.success("Sesión restaurada");
      window.location.href = "/app/users";
    } catch (e: any) {
      toast.error(e.message ?? "No se pudo restaurar la sesión");
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">
      <div>
        <span className="font-semibold text-amber-800">Modo suplantación:</span>{" "}
        estás como <b>{user?.email}</b>
        {info.admin_email && <> · admin: {info.admin_email}</>}
      </div>
      <Button size="sm" variant="outline" onClick={back}>
        <LogOut className="mr-1 h-3.5 w-3.5" /> Volver a mi sesión
      </Button>
    </div>
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
          <ImpersonationBanner />
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <SidebarTrigger />
            <Link to="/app" className="flex min-w-0 items-center gap-2">
              <img src={logoAsset.url} alt="" className="h-7 w-7 shrink-0" />
              <span className="truncate text-sm font-semibold">3 Dental Imagen</span>
            </Link>
            <div className="ml-auto flex items-center gap-1">
              <NotificationBell />
              <Button asChild variant="ghost" size="icon" title="Mi perfil">
                <Link to="/app/profile"><UserIcon className="h-5 w-5" /></Link>
              </Button>
            </div>
          </header>

          <main className="flex-1 bg-muted/30 p-3 sm:p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

