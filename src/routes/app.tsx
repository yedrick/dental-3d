import { translateError } from "@/lib/translate-error";
import { createFileRoute, Outlet, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { tokenStore } from "@/lib/api";
import { useBranding } from "@/lib/branding";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { LogOut, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { NotificationBell } from "@/components/notification-bell";
import { SetupAccount } from "@/components/setup-account";

export const Route = createFileRoute("/app")({
  ssr: false,
  component: AppLayout,
});

function ImpersonationBanner() {
  const { user, impersonatedBy, setSessionToken, signOut } = useAuth();
  if (!impersonatedBy) return null;
  // Entrada desde el panel de la plataforma (tenancy-node): no hay una sesión propia a la cual volver
  if (impersonatedBy.startsWith("platform:")) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">
        <div>
          <span className="font-semibold text-amber-800">Acceso desde el panel de la plataforma:</span>{" "}
          estás como <b>{user?.full_name}</b>. La sesión dura 1 hora y todo queda registrado.
        </div>
        <Button size="sm" variant="outline" onClick={async () => { await signOut(); window.location.href = "/auth"; }}>
          <LogOut className="mr-1 h-3.5 w-3.5" /> Cerrar sesión
        </Button>
      </div>
    );
  }
  const back = async () => {
    const adminToken = tokenStore.getAdmin();
    tokenStore.clearAdmin();
    if (!adminToken) {
      toast.error("No se encontró tu sesión original. Vuelve a iniciar sesión.");
      tokenStore.clear();
      window.location.href = "/auth";
      return;
    }
    try {
      await setSessionToken(adminToken);
      toast.success("Sesión restaurada");
      window.location.href = "/app/users";
    } catch (e) {
      toast.error(translateError(e) || "No se pudo restaurar la sesión");
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">
      <div>
        <span className="font-semibold text-amber-800">Modo suplantación:</span>{" "}
        estás como <b>{user?.full_name}</b> ({user?.email}). Todo lo que hagas queda registrado a tu nombre.
      </div>
      <Button size="sm" variant="outline" onClick={back}>
        <LogOut className="mr-1 h-3.5 w-3.5" /> Volver a mi sesión
      </Button>
    </div>
  );
}

function AppLayout() {
  const { user, loading } = useAuth();
  const branding = useBranding();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !user) navigate({ to: "/auth" }); }, [user, loading, navigate]);
  if (loading || !user) return (
    <div className="grid min-h-screen place-items-center bg-muted/30" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4">
        <img src={branding.logo} alt="" className="h-16 w-16 animate-pulse rounded-xl object-contain" />
        <div className="text-sm font-semibold">{branding.name}</div>
        <div className="h-1 w-40 overflow-hidden rounded-full bg-primary/15">
          <div className="loader-bar h-full w-2/5 rounded-full bg-primary" />
        </div>
        <span className="sr-only">Cargando…</span>
      </div>
    </div>
  );

  // Cuenta ADMIN por defecto de una sucursal nueva: primero se activa
  if (user.must_change_password) return <SetupAccount />;

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <ImpersonationBanner />
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <SidebarTrigger aria-label="Alternar menú lateral" />
            <Link to="/app" className="flex min-w-0 items-center gap-2">
              <img src={branding.logo} alt="" className="h-7 w-7 shrink-0 object-contain" />
              <span className="truncate text-sm font-semibold">{branding.name}</span>
            </Link>
            <div className="ml-auto flex items-center gap-1">
              <NotificationBell />
              <Button asChild variant="ghost" size="icon" title="Mi perfil" aria-label="Mi perfil">
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

