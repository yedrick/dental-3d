import { translateError } from "@/lib/translate-error";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPut } from "@/lib/api";
import { STALE } from "@/lib/query-config";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth, ROLES, type AppRole } from "@/lib/auth";
import { Eye, Plus, Pencil, Trash2, DollarSign, PackageCheck, Settings2, UserCog, ShieldCheck, FileDown, Send, CheckCircle2, LogIn, type LucideIcon } from "lucide-react";

type Permission = { key: string; description: string | null; category: string | null };
type RolesResponse = { roles: AppRole[]; permissions: Permission[]; matrix: Record<string, string[]> };

const MODULE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  doctors: "Doctores",
  patients: "Pacientes",
  studies: "Estudios y tarifas",
  attention: "Atención",
  appointments: "Agenda de citas",
  delivery: "Entregas y cobros",
  cashbox: "Caja chica",
  deposits: "Depósitos bancarios",
  third_party: "Pagos a terceros",
  commissions: "Comisiones",
  reports: "Reportes",
  audit: "Auditoría",
  users: "Usuarios",
  roles: "Roles y permisos",
  params: "Parámetros del sistema",
  notifications: "Notificaciones",
  profile: "Perfil personal",
};

const MODULE_ORDER = [
  "dashboard", "attention", "delivery", "appointments", "patients", "doctors", "studies",
  "cashbox", "deposits", "third_party", "commissions", "reports",
  "notifications", "profile",
  "users", "roles", "params", "audit",
];

const ACTION_META: Record<string, { label: string; icon: LucideIcon; order: number }> = {
  view: { label: "Ver", icon: Eye, order: 1 },
  create: { label: "Crear", icon: Plus, order: 2 },
  edit: { label: "Editar", icon: Pencil, order: 3 },
  delete: { label: "Eliminar", icon: Trash2, order: 4 },
  charge: { label: "Cobrar", icon: DollarSign, order: 5 },
  deliver: { label: "Entregar", icon: PackageCheck, order: 6 },
  export: { label: "Exportar PDF", icon: FileDown, order: 7 },
  send: { label: "Enviar", icon: Send, order: 8 },
  approve: { label: "Aprobar", icon: CheckCircle2, order: 9 },
  impersonate: { label: "Iniciar sesión como", icon: LogIn, order: 10 },
  manage_roles: { label: "Asignar roles", icon: UserCog, order: 11 },
  manage_permissions: { label: "Gestionar permisos", icon: ShieldCheck, order: 12 },
};
const defaultAction = (a: string) => ({ label: a, icon: Settings2, order: 99 });


function parseKey(key: string): { module: string; action: string } {
  // view.<module>  → module=<module>, action=view
  if (key.startsWith("view.")) return { module: key.slice(5), action: "view" };
  const [mod, ...rest] = key.split(".");
  return { module: mod, action: rest.join(".") || "view" };
}

export const Route = createFileRoute("/app/roles")({ component: RolesPage });

function RolesPage() {
  const { can, reloadPermissions } = useAuth();
  const canEdit = can("roles.manage_permissions");
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["roles-matrix"],
    queryFn: () => apiGet<RolesResponse>("/api/roles"),
    staleTime: STALE.catalog,
  });
  const permissions = data?.permissions ?? [];
  const roles: readonly AppRole[] = data?.roles ?? ROLES;

  const has = (role: AppRole, key: string) => data?.matrix[role]?.includes(key) ?? false;

  const toggle = async (role: AppRole, key: string, on: boolean) => {
    if (!canEdit) return toast.error("Sin permiso");
    if (role === "ADMIN") return toast.error("ADMIN siempre tiene todos los permisos");
    const path = `/api/roles/${role}/permissions/${encodeURIComponent(key)}`;
    try {
      if (on) await apiPut(path);
      else await apiDelete(path);
    } catch (e) {
      return toast.error(translateError(e));
    }
    qc.invalidateQueries({ queryKey: ["roles-matrix"] });
    await reloadPermissions();
  };

  // Group by module
  const byModule = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
    const { module } = parseKey(p.key);
    (acc[module] ||= []).push(p);
    return acc;
  }, {});

  const modules = Object.keys(byModule).sort((a, b) => {
    const ia = MODULE_ORDER.indexOf(a); const ib = MODULE_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  return (
    <div>
      <PageHeader title="Roles y permisos" description="Agrupado por módulo. Cada fila es una acción (ver, crear, editar, eliminar, etc.). ADMIN siempre tiene todo." />
      {!canEdit && <div className="mb-3 text-sm text-muted-foreground">Solo lectura — necesitas el permiso <code>roles.manage_permissions</code>.</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {modules.map((mod) => {
          const perms = byModule[mod]
            .map((p) => ({ ...p, ...parseKey(p.key) }))
            .sort((a, b) => (ACTION_META[a.action] ?? defaultAction(a.action)).order - (ACTION_META[b.action] ?? defaultAction(b.action)).order);
          return (
            <Card key={mod} className="overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/40">
                <div className="font-semibold text-sm">{MODULE_LABELS[mod] ?? mod}</div>
                <Badge variant="outline" className="text-[10px] font-mono">{mod}</Badge>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[45%]">Acción</TableHead>
                    {roles.map((r) => (
                      <TableHead key={r} className="text-center px-1 text-[10px] font-medium">{r.slice(0, 3)}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perms.map((p) => {
                    const meta = ACTION_META[p.action] ?? defaultAction(p.action);
                    const Icon = meta.icon;
                    return (
                      <TableRow key={p.key}>
                        <TableCell className="py-2">
                          <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <div className="text-sm leading-tight">{meta.label}</div>
                              <div className="text-[10px] text-muted-foreground truncate" title={p.description ?? ""}>{p.description}</div>
                            </div>
                          </div>
                        </TableCell>
                        {roles.map((r) => (
                          <TableCell key={r} className="text-center px-1 py-2">
                            <Checkbox
                              aria-label={`${r}: ${MODULE_LABELS[mod] ?? mod} — ${meta.label}`}
                              checked={r === "ADMIN" ? true : has(r, p.key)}
                              disabled={!canEdit || r === "ADMIN"}
                              onCheckedChange={(v) => toggle(r, p.key, !!v)}
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 text-xs text-muted-foreground">
        <span className="font-medium">Leyenda:</span> las columnas son roles (ADM=ADMIN, REC=RECEPCION, CAJ=CAJA, CON=CONTABILIDAD, DOC=DOCTOR, AUD=AUDITOR).
      </div>
    </div>
  );
}
