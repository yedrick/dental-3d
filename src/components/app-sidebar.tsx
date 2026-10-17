import { Link, useRouterState } from "@tanstack/react-router";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard, Stethoscope, Users, TestTube2, ClipboardList, Percent,
  Wallet, Landmark, Receipt, BarChart3, ShieldCheck, UserCog, LogOut,
  PackageCheck, KeyRound, Settings2, CalendarDays, Bell, UserCircle, Palette, Globe,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useBranding } from "@/lib/branding";

// feature: módulo del plan que necesita (server/src/tenancy/plans.ts); sin feature = núcleo
type Item = { title: string; url: string; icon: any; perm: string; feature?: string };

const nav: { label: string; items: Item[] }[] = [
  { label: "General", items: [
    { title: "Dashboard", url: "/app", icon: LayoutDashboard, perm: "view.dashboard" },
  ]},
  { label: "Clínico", items: [
    { title: "Doctores", url: "/app/doctors", icon: Stethoscope, perm: "view.doctors" },
    { title: "Pacientes", url: "/app/patients", icon: Users, perm: "view.patients" },
    { title: "Estudios y tarifas", url: "/app/studies", icon: TestTube2, perm: "view.studies" },
    { title: "Atenciones", url: "/app/attention", icon: ClipboardList, perm: "view.attention" },
    { title: "Agenda de citas", url: "/app/appointments", icon: CalendarDays, perm: "view.appointments", feature: "agenda" },
    { title: "Entregas y cobros", url: "/app/delivery", icon: PackageCheck, perm: "view.delivery" },
  ]},
  { label: "Financiero", items: [
    { title: "Comisiones", url: "/app/commissions", icon: Percent, perm: "view.commissions", feature: "comisiones" },
    { title: "Caja chica", url: "/app/cashbox", icon: Wallet, perm: "view.cashbox", feature: "caja" },
    { title: "Depósitos", url: "/app/deposits", icon: Landmark, perm: "view.deposits", feature: "finanzas" },
    { title: "Pagos a terceros", url: "/app/third-party", icon: Receipt, perm: "view.third_party", feature: "finanzas" },
  ]},
  { label: "Control", items: [
    { title: "Reportes", url: "/app/reports", icon: BarChart3, perm: "view.reports", feature: "reportes" },
    { title: "Auditoría", url: "/app/audit", icon: ShieldCheck, perm: "view.audit", feature: "auditoria" },
    { title: "Usuarios", url: "/app/users", icon: UserCog, perm: "view.users" },
    { title: "Roles y permisos", url: "/app/roles", icon: KeyRound, perm: "view.roles" },
    { title: "Parámetros", url: "/app/params", icon: Settings2, perm: "view.params" },
    { title: "Marca de la sucursal", url: "/app/branding", icon: Palette, perm: "branding.edit" },
    { title: "Página web", url: "/app/site", icon: Globe, perm: "site.edit", feature: "pagina_web" },
  ]},
];

export function AppSidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { can, signOut, user, roles } = useAuth();
  const branding = useBranding();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <img src={branding.logo} alt="" className="h-8 w-8 shrink-0 rounded-md object-contain" />
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-sm font-semibold">{branding.name}</div>
            <div className="truncate text-xs text-muted-foreground">{roles.join(", ") || "sin rol"}</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {nav.map((group) => {
          const visible = group.items.filter((i) => can(i.perm) && (!i.feature || branding.hasFeature(i.feature)));
          if (visible.length === 0) return null;
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visible.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={path === item.url}>
                        <Link to={item.url}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
        <SidebarGroup>
          <SidebarGroupLabel>Personal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {can("view.notifications") && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={path === "/app/notifications"}>
                    <Link to="/app/notifications"><Bell /><span>Notificaciones</span></Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {can("view.profile") && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={path === "/app/profile"}>
                    <Link to="/app/profile"><UserCircle /><span>Mi perfil</span></Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>

          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="px-2 pb-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden truncate">{user?.email}</div>
        <Button variant="ghost" size="sm" onClick={signOut} className="justify-start" aria-label="Cerrar sesión">
          <LogOut className="h-4 w-4" />
          <span className="group-data-[collapsible=icon]:hidden">Salir</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
