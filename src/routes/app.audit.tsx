import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
};

const PAGE_SIZE = 50;

function AuditPage() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [action, setAction] = useState<string>("__all__");
  const [table, setTable] = useState<string>("__all__");
  const [userId, setUserId] = useState<string>("__all__");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<any | null>(null);

  const { data: logs = [] } = useQuery({
    queryKey: ["audit_logs", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .gte("timestamp", `${from}T00:00:00`)
        .lte("timestamp", `${to}T23:59:59`)
        .order("timestamp", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ["profiles-mini"],
    queryFn: async () => (await supabase.from("profiles").select("id,full_name,username")).data ?? [],
  });
  const userMap = useMemo(() => new Map(users.map((u: any) => [u.id, u.full_name || u.username])), [users]);

  const tables = useMemo(() => Array.from(new Set(logs.map((l: any) => l.table_name).filter(Boolean))).sort(), [logs]);
  const actions = useMemo(() => Array.from(new Set(logs.map((l: any) => l.action).filter(Boolean))).sort(), [logs]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return logs.filter((l: any) => {
      if (action !== "__all__" && l.action !== action) return false;
      if (table !== "__all__" && l.table_name !== table) return false;
      if (userId !== "__all__" && l.user_id !== userId) return false;
      if (term) {
        const hay = `${l.record_id ?? ""} ${JSON.stringify(l.data ?? {})} ${userMap.get(l.user_id) ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [logs, action, table, userId, q, userMap]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const reset = () => {
    setAction("__all__"); setTable("__all__"); setUserId("__all__"); setQ(""); setPage(0);
    setFrom(weekAgo); setTo(today);
  };

  const describe = (l: any): string => {
    const d = l.data ?? {};
    if (l.action === "CHARGE" || l.action === "CHARGE_ALL") return `${d.patient_name ?? "—"} · Bs ${d.amount_charged ?? 0}`;
    if (l.action === "DELIVER") return `${d.patient_name ?? "—"} · ${d.delivered_count ?? 1} estudio(s)`;
    if (l.action === "ATTENTION_CREATE") return `${d.patient_name ?? "—"} · ${d.items_count ?? 0} estudio(s) · Bs ${d.total ?? 0}`;
    if (l.action?.startsWith("APPOINTMENT")) return `${d.patient_name ?? "—"} ${d.starts_at ? "· " + new Date(d.starts_at).toLocaleString() : ""}`;
    if (l.action?.startsWith("USER_")) return d.email ?? d.username ?? d.full_name ?? "";
    return "";
  };

  return (
    <div>
      <PageHeader title="Auditoría" description="Registro de cobros, entregas, atenciones, citas y cambios de datos." />

      {/* Filters */}
      <Card className="mb-3">
        <CardContent className="grid gap-2 pt-4 md:grid-cols-6">
          <div>
            <Label className="text-xs">Desde</Label>
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">Hasta</Label>
            <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">Acción</Label>
            <Select value={action} onValueChange={(v) => { setAction(v); setPage(0); }}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas</SelectItem>
                {actions.map((a: any) => <SelectItem key={a} value={a}>{ACTION_META[a]?.label ?? a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Tabla</Label>
            <Select value={table} onValueChange={(v) => { setTable(v); setPage(0); }}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas</SelectItem>
                {tables.map((t: any) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Usuario</Label>
            <Select value={userId} onValueChange={(v) => { setUserId(v); setPage(0); }}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                {users.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.full_name || u.username}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Buscar</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Paciente, id, monto…" className="h-9 pl-7" />
            </div>
          </div>
          <div className="md:col-span-6 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{filtered.length}</span> registros
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
            {paged.map((r: any) => {
              const meta = ACTION_META[r.action] ?? { label: r.action, variant: "outline" as const };
              return (
                <TableRow key={r.id} className="hover:bg-muted/40 cursor-pointer" onClick={() => setDetail(r)}>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">{new Date(r.timestamp).toLocaleString()}</TableCell>
                  <TableCell><Badge variant={meta.variant} className={meta.className}>{meta.label}</Badge></TableCell>
                  <TableCell className="text-xs font-mono">{r.table_name}</TableCell>
                  <TableCell className="text-xs">{describe(r)}</TableCell>
                  <TableCell className="text-xs">{userMap.get(r.user_id) ?? <span className="text-muted-foreground">—</span>}</TableCell>
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
                <Field label="Fecha" value={new Date(detail.timestamp).toLocaleString()} />
                <Field label="Acción" value={ACTION_META[detail.action]?.label ?? detail.action} />
                <Field label="Tabla" value={detail.table_name} />
                <Field label="Registro" value={detail.record_id} mono />
                <Field label="Usuario" value={userMap.get(detail.user_id) ?? detail.user_id} />
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
