import { translateError } from "@/lib/translate-error";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost, type Paged } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { calcAge, formatDate } from "@/lib/data";
import { STALE } from "@/lib/query-config";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Eye, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { TableSkeletonRows } from "@/components/table-skeleton";

export const Route = createFileRoute("/app/patients")({ component: PatientsPage });

type PForm = { id?: string; doctor_id: string; full_name: string; birth_date: string; phone: string; email: string; notes: string; status: boolean };
// Radix Select no admite "" como valor: "none" representa "sin doctor"
const NO_DOCTOR = "none";
const empty: PForm = { doctor_id: "", full_name: "", birth_date: "", phone: "", email: "", notes: "", status: true };
const PAGE_SIZE = 50;

function PatientsPage() {
  const { can } = useAuth();
  // Los permisos los controla la API; aquí solo se ocultan los botones
  const canCreate = can("patients.create");
  const canEdit = can("patients.edit");
  const canDelete = can("patients.delete");
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<PForm>(empty);
  const [open, setOpen] = useState(false);

  // Búsqueda en el servidor (nombre, teléfono o email), con una pequeña espera al escribir
  useEffect(() => {
    const t = setTimeout(() => { setSearch(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data: res, isLoading } = useQuery({
    queryKey: ["patients", { q: search, page }],
    queryFn: () => apiGet<Paged<any>>("/api/patients", { q: search, page, limit: PAGE_SIZE, sort: "recent" }),
    staleTime: STALE.master,
    placeholderData: keepPreviousData,
  });
  const filtered = res?.data ?? [];
  const pages = res?.pages ?? 1;
  const total = res?.total ?? 0;

  const { data: doctors = [] } = useQuery({
    queryKey: ["doctors"],
    queryFn: () => apiGet<any[]>("/api/doctors"),
    staleTime: STALE.master,
  });
  const activeDoctors = doctors.filter((d: any) => d.status);

  const openNew = () => { setForm(empty); setOpen(true); };
  const openEdit = (p: any) => {
    setForm({ id: p.id, doctor_id: p.doctor_id ?? "", full_name: p.full_name, birth_date: p.birth_date || "", phone: p.phone || "", email: p.email || "", notes: p.notes || "", status: p.status ?? true });
    setOpen(true);
  };

  const save = async () => {
    if (!form.full_name.trim()) return toast.error("El nombre es obligatorio");
    const payload: any = {
      doctor_id: form.doctor_id || null, // opcional: sin doctor, sus atenciones van sin comisión
      full_name: form.full_name,
      birth_date: form.birth_date || null,
      phone: form.phone || null,
      email: form.email || null,
      notes: form.notes || null,
      status: form.status,
    };
    try {
      if (form.id) {
        await apiPatch(`/api/patients/${form.id}`, payload);
        toast.success("Paciente actualizado");
      } else {
        // created_by lo pone la API con el usuario de la sesión
        await apiPost("/api/patients", payload);
        toast.success("Paciente registrado");
      }
    } catch (e) {
      return toast.error(translateError(e));
    }
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["patients"] });
  };

  const toggleStatus = async (p: any, v: boolean) => {
    try {
      await apiPatch(`/api/patients/${p.id}`, { status: v });
    } catch (e) {
      toast.error(translateError(e));
    }
    qc.invalidateQueries({ queryKey: ["patients"] });
  };

  const del = async (p: any) => {
    if (!confirm(`¿Eliminar paciente "${p.full_name}"? Si tiene atenciones registradas no se podrá eliminar: desactívalo en su lugar.`)) return;
    try {
      await apiDelete(`/api/patients/${p.id}`);
    } catch (e) {
      return toast.error(translateError(e));
    }
    toast.success("Paciente eliminado");
    qc.invalidateQueries({ queryKey: ["patients"] });
  };

  return (
    <div>
      <PageHeader
        title="Pacientes"
        description="Gestión completa: editar, activar/desactivar, ver historial."
        action={canCreate && <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" />Nuevo paciente</Button>}
      />

      <div className="mb-3 relative max-w-md">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Buscar por nombre, teléfono o email…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Paciente</TableHead><TableHead>Doctor</TableHead>
            <TableHead>Edad</TableHead><TableHead>Teléfono</TableHead>
            <TableHead>Estado</TableHead><TableHead>Registrado</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableSkeletonRows cols={7} />}
            {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-muted-foreground">Sin resultados.</TableCell></TableRow>}
            {filtered.map((p: any) => (
              <TableRow key={p.id} className={!p.status ? "opacity-60" : ""}>
                <TableCell className="font-medium">
                  {p.full_name}
                  {p.email && <div className="text-[11px] text-muted-foreground">{p.email}</div>}
                </TableCell>
                <TableCell className="text-sm">{p.doctor_name || <span className="text-muted-foreground">Sin doctor</span>}</TableCell>
                <TableCell className="text-sm">{p.birth_date ? `${calcAge(p.birth_date)}a` : "—"}</TableCell>
                <TableCell className="text-sm">{p.phone || "—"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch checked={p.status} disabled={!canEdit} onCheckedChange={(v) => toggleStatus(p, v)} />
                    <Badge variant={p.status ? "secondary" : "outline"} className="text-[10px]">{p.status ? "Activo" : "Inactivo"}</Badge>
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDate(p.created_at)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button asChild size="sm" variant="ghost" title="Ver historial" aria-label="Ver historial del paciente">
                      <Link to="/app/patients/$id" params={{ id: p.id }}><Eye className="h-4 w-4" /></Link>
                    </Button>
                    {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(p)} title="Editar" aria-label="Editar paciente"><Pencil className="h-4 w-4" /></Button>}
                    {canDelete && <Button size="sm" variant="ghost" onClick={() => del(p)} title="Eliminar" aria-label="Eliminar paciente" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <span>{total} pacientes · Página {page} de {pages}</span>
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Página siguiente"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{form.id ? "Editar paciente" : "Nuevo paciente"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Doctor remitente (opcional)</Label>
              <Select value={form.doctor_id || NO_DOCTOR} onValueChange={(v) => setForm({ ...form, doctor_id: v === NO_DOCTOR ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Sin doctor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DOCTOR}>Sin doctor (llegó por su cuenta)</SelectItem>
                  {activeDoctors.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Nombre completo *</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Fecha nacimiento</Label><Input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} /></div>
              <div><Label>Teléfono</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Notas</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            {form.id && (
              <div className="flex items-center gap-2"><Switch checked={form.status} onCheckedChange={(v) => setForm({ ...form, status: v })} /><span className="text-sm">Activo</span></div>
            )}
          </div>
          <DialogFooter><Button onClick={save}>{form.id ? "Actualizar" : "Guardar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
