import { createFileRoute } from "@tanstack/react-router";
import { useId, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate, formatDateTime, todayLocal } from "@/lib/data";
import { STALE } from "@/lib/query-config";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, RotateCcw, Eye } from "lucide-react";

export const Route = createFileRoute("/app/audit")({ component: AuditPage });

const ACTION_META: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className?: string }> = {
  INSERT: { label: "Alta", variant: "default" },
  UPDATE: { label: "Cambio", variant: "secondary" },
  DELETE: { label: "Baja", variant: "destructive" },
  CHARGE: { label: "Cobro", variant: "default", className: "bg-emerald-600 hover:bg-emerald-600" },
  CHARGE_ALL: { label: "Cobro total", variant: "default", className: "bg-emerald-700 hover:bg-emerald-700" },
  DELIVER: { label: "Entrega", variant: "default", className: "bg-sky-600 hover:bg-sky-600" },
  ATTENTION_CREATE: { label: "Atención", variant: "default", className: "bg-indigo-600 hover:bg-indigo-600" },
  APPOINTMENT_CREATE: { label: "Cita creada", variant: "outline" },
  APPOINTMENT_UPDATE: { label: "Cita editada", variant: "outline" },
  APPOINTMENT_STATUS: { label: "Estado cita", variant: "outline" },
  APPOINTMENT_DELETE: { label: "Cita eliminada", variant: "destructive" },
  USER_CREATE: { label: "Usuario creado", variant: "default" },
  USER_UPDATE: { label: "Usuario editado", variant: "secondary" },
  USER_DELETE: { label: "Usuario eliminado", variant: "destructive" },
  USER_APPROVE: { label: "Usuario aprobado", variant: "default" },
  USER_UNAPPROVE: { label: "Usuario deshabilitado", variant: "destructive" },
  USER_ROLES: { label: "Roles de usuario", variant: "secondary" },
  IMPERSONATE_START: { label: "Inicio como otro usuario", variant: "outline" },
  PERMISSION_GRANT: { label: "Permiso otorgado", variant: "secondary" },
  PERMISSION_REVOKE: { label: "Permiso quitado", variant: "destructive" },
  USER_REGISTER: { label: "Usuario registrado", variant: "outline" },
  USER_CREATE_PLATFORM: { label: "Usuario creado (plataforma)", variant: "default" },
  ADMIN_CREATE_CLI: { label: "Administrador creado", variant: "default" },
  DEFAULT_ADMIN_CREATE: { label: "Administrador inicial", variant: "default" },
  ACCOUNT_SETUP: { label: "Cuenta activada", variant: "default" },
  IMPERSONATE_PLATFORM: { label: "Ingreso desde la plataforma", variant: "outline" },
  PASSWORD_CHANGE: { label: "Contraseña cambiada", variant: "secondary" },
  PASSWORD_RESET: { label: "Contraseña recuperada", variant: "secondary" },
  PASSWORD_RESET_REQUEST: { label: "Pidió recuperar contraseña", variant: "outline" },
  PROFILE_UPDATE: { label: "Perfil editado", variant: "secondary" },
  NOTIFICATION_SEND: { label: "Notificación enviada", variant: "outline" },
  BRANDING_UPDATE: { label: "Marca editada", variant: "secondary" },
  LOGO_UPDATE: { label: "Logo cambiado", variant: "secondary" },
  LOGO_DELETE: { label: "Logo quitado", variant: "destructive" },
  SITE_UPDATE: { label: "Página web editada", variant: "secondary" },
  SITE_RESET: { label: "Página web restablecida", variant: "destructive" },
  SITE_IMAGE_UPLOAD: { label: "Imagen de la página web", variant: "outline" },
  STUDIES_IMPORT: { label: "Estudios importados (Excel)", variant: "default" },
  IMPORT_SUPABASE: { label: "Datos importados", variant: "outline" },
};

/** Nombre en español de cada tabla registrada en la auditoría. */
const TABLE_LABELS: Record<string, string> = {
  appointments: "Citas",
  app_params: "Parámetros",
  bank_deposits: "Depósitos",
  cashbox: "Caja",
  commissions: "Comisiones",
  doctors: "Doctores",
  notifications: "Notificaciones",
  patients: "Pacientes",
  patient_studies: "Atenciones",
  payments: "Pagos",
  role_permissions: "Permisos",
  site_content: "Página web",
  studies: "Estudios",
  study_prices: "Tarifas",
  tenancy: "Sucursal",
  tenancy_tenants: "Sucursal",
  third_party_payments: "Pagos a terceros",
  users: "Usuarios",
};

type AuditRow = {
  id: number | string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  table_name: string | null;
  record_id: string | null;
  data: Record<string, any> | null;
  timestamp: string;
};

const PAGE_SIZE = 50;

const tableLabel = (t: string | null) => (t ? TABLE_LABELS[t] ?? t : "—");

function AuditPage() {
  const uid = useId(); // ids para unir cada etiqueta con su campo
  const { can } = useAuth();
  const today = todayLocal();
  const weekAgo = formatDate(new Date(Date.now() - 7 * 86400000).toISOString());

  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [action, setAction] = useState<string>("__all__");
  const [table, setTable] = useState<string>("__all__");
  const [userId, setUserId] = useState<string>("__all__");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<AuditRow | null>(null);

  // Filtros y paginación en el servidor
  const filters = {
    from: from || undefined,
    to: to || undefined,
    action: action === "__all__" ? undefined : action,
    table_name: table === "__all__" ? undefined : table,
    user_id: userId === "__all__" ? undefined : userId,
    page: page + 1,
    limit: PAGE_SIZE,
  };
  const { data: result } = useQuery({
    queryKey: ["audit_logs", filters],
    queryFn: () => apiGet<Paged<AuditRow>>("/api/audit", filters),
    staleTime: STALE.ops,
    placeholderData: keepPreviousData,
  });
  const logs = useMemo(() => result?.data ?? [], [result]);
  const total = result?.total ?? 0;

  const { data: facets } = useQuery({
    queryKey: ["audit_facets"],
    queryFn: () => apiGet<{ tables: string[]; actions: string[] }>("/api/audit/facets"),
    staleTime: STALE.catalog,
  });
  const tables = (facets?.tables ?? []).filter(Boolean);
  const actions = (facets?.actions ?? []).filter(Boolean);

  // Lista de usuarios para el filtro: de la API si se tiene permiso; si no, los que aparecen en la página
  const canViewUsers = can("view.users");
  const { data: apiUsers = [] } = useQuery({
    queryKey: ["users_admin", "mini"],
    queryFn: () => apiGet<{ id: string; full_name: string; username: string }[]>("/api/users"),
    staleTime: STALE.master,
    enabled: canViewUsers,
  });
  const users = useMemo(() => {
    if (canViewUsers) return apiUsers.map((u) => ({ id: u.id, name: u.full_name || u.username }));
    const m = new Map<string, string>();
    logs.forEach((l) => { if (l.user_id) m.set(l.user_id, l.user_name ?? l.user_id); });
    return Array.from(m, ([id, name]) => ({ id, name }));
  }, [canViewUsers, apiUsers, logs]);

  const userName = (l: AuditRow) => l.user_name ?? (l.user_id ? users.find((u) => u.id === l.user_id)?.name : undefined);

  // La búsqueda libre filtra la página cargada
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return logs;
    return logs.filter((l) => {
      const hay = `${l.record_id ?? ""} ${JSON.stringify(l.data ?? {})} ${l.user_name ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
  }, [logs, q]);

  const pageCount = Math.max(1, result?.pages ?? 1);
  const paged = filtered;

  const reset = () => {
    setAction("__all__"); setTable("__all__"); setUserId("__all__"); setQ(""); setPage(0);
    setFrom(weekAgo); setTo(today);
  };

  const describe = (l: AuditRow): string => {
    const d = l.data ?? {};
    if (l.action === "CHARGE" || l.action === "CHARGE_ALL") return `${d.patient_name ?? "—"} · Bs ${d.amount_charged ?? 0}`;
    if (l.action === "DELIVER") return `${d.patient_name ?? "—"} · ${d.delivered_count ?? 1} estudio(s)`;
    if (l.action === "ATTENTION_CREATE") return `${d.patient_name ?? "—"} · ${d.items_count ?? 0} estudio(s) · Bs ${d.total ?? 0}`;
    if (l.action?.startsWith("APPOINTMENT")) return `${d.patient_name ?? "—"} ${d.starts_at ? "· " + formatDateTime(d.starts_at) : ""}`;
    if (l.action?.startsWith("USER_")) return d.email ?? d.username ?? d.full_name ?? d.target ?? d.profile?.email ?? "";
    if (l.action?.startsWith("PERMISSION_")) return `${d.role ?? ""} · ${d.key ?? ""}`;
    if (l.action === "IMPERSONATE_START") return d.target ?? "";
    return "";
  };

  return (
    <div>
      <PageHeader title="Auditoría" description="Registro de cobros, entregas, atenciones, citas y cambios de datos." />

      {/* Filters */}
      <Card className="mb-3">
        <CardContent className="grid gap-2 pt-4 md:grid-cols-6">
          <div>
            <Label htmlFor={`${uid}-from`} className="text-xs">Desde</Label>
            <Input id={`${uid}-from`} type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className="h-9" />
          </div>
          <div>
            <Label htmlFor={`${uid}-to`} className="text-xs">Hasta</Label>
            <Input id={`${uid}-to`} type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} className="h-9" />
          </div>
          <div>
            <Label htmlFor={`${uid}-action`} className="text-xs">Acción</Label>
            <Select value={action} onValueChange={(v) => { setAction(v); setPage(0); }}>
              <SelectTrigger id={`${uid}-action`} className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas</SelectItem>
                {actions.map((a) => <SelectItem key={a} value={a}>{ACTION_META[a]?.label ?? a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${uid}-table`} className="text-xs">Tabla</Label>
            <Select value={table} onValueChange={(v) => { setTable(v); setPage(0); }}>
              <SelectTrigger id={`${uid}-table`} className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas</SelectItem>
                {tables.map((t) => <SelectItem key={t} value={t}>{tableLabel(t)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${uid}-user`} className="text-xs">Usuario</Label>
            <Select value={userId} onValueChange={(v) => { setUserId(v); setPage(0); }}>
              <SelectTrigger id={`${uid}-user`} className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${uid}-q`} className="text-xs">Buscar</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input id={`${uid}-q`} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="En esta página: paciente, id, monto…" className="h-9 pl-7" />
            </div>
          </div>
          <div className="md:col-span-6 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{total}</span> registros
            </div>
            <Button variant="outline" size="sm" onClick={reset}><RotateCcw className="h-3.5 w-3.5 mr-1" />Limpiar</Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[160px]">Fecha</TableHead>
              <TableHead className="w-[140px]">Acción</TableHead>
              <TableHead>Tabla</TableHead>
              <TableHead>Detalle</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((r) => {
              const meta = ACTION_META[r.action] ?? { label: r.action, variant: "outline" as const };
              return (
                <TableRow key={r.id} className="hover:bg-muted/40 cursor-pointer" onClick={() => setDetail(r)}>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{formatDateTime(r.timestamp)}</TableCell>
                  <TableCell><Badge variant={meta.variant} className={meta.className}>{meta.label}</Badge></TableCell>
                  <TableCell className="text-xs">{tableLabel(r.table_name)}</TableCell>
                  <TableCell className="text-xs">{describe(r)}</TableCell>
                  <TableCell className="text-xs">
                    {userName(r) ?? <span className="text-muted-foreground">—</span>}
                    {r.data?._impersonated_by && <Badge variant="outline" className="ml-1 text-[10px]">suplantado</Badge>}
                  </TableCell>
                  <TableCell><Eye className="h-3.5 w-3.5 text-muted-foreground" /></TableCell>
                </TableRow>
              );
            })}
            {paged.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">Sin registros para los filtros aplicados.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        {pageCount > 1 && (
          <div className="flex items-center justify-between p-3 border-t">
            <div className="text-xs text-muted-foreground">Página {page + 1} de {pageCount}</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>Siguiente</Button>
            </div>
          </div>
        )}
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Detalle del evento</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Fecha" value={formatDateTime(detail.timestamp)} />
                <Field label="Acción" value={ACTION_META[detail.action]?.label ?? detail.action} />
                <Field label="Tabla" value={tableLabel(detail.table_name)} />
                <Field label="Registro" value={detail.record_id} mono />
                <Field label="Usuario" value={userName(detail) ?? detail.user_id} />
                {detail.data?._impersonated_by && (
                  <Field
                    label="Suplantado por"
                    value={users.find((u) => u.id === detail.data?._impersonated_by)?.name ?? detail.data._impersonated_by}
                    mono={!users.some((u) => u.id === detail.data?._impersonated_by)}
                  />
                )}
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Datos</div>
                <pre className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-80">{JSON.stringify(detail.data, null, 2)}</pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div className="rounded border p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm ${mono ? "font-mono" : ""}`}>{value ?? "—"}</div>
    </div>
  );
}
