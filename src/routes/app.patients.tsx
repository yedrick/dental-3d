import { translateError } from "@/lib/translate-error";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useList, calcAge, formatDate } from "@/lib/data";
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
import { Plus, Pencil, Trash2, Eye, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/patients")({ component: PatientsPage });

type PForm = { id?: string; doctor_id: string; full_name: string; birth_date: string; phone: string; email: string; notes: string; status: boolean };
const empty: PForm = { doctor_id: "", full_name: "", birth_date: "", phone: "", email: "", notes: "", status: true };

function PatientsPage() {
  const { user, hasAny, can } = useAuth();
  const canCreate = hasAny(["ADMIN", "RECEPCION"]);
  const canEdit = can("patients.edit") || hasAny(["ADMIN", "RECEPCION"]);
  const canDelete = can("patients.delete") || hasAny(["ADMIN"]);
  const qc = useQueryClient();
  const { data = [], isLoading } = useList<any>("patients");
  const { data: doctors = [] } = useList<any>("doctors", "full_name", true);
  const activeDoctors = doctors.filter((d: any) => d.status);
  const doctorMap = useMemo(() => new Map(doctors.map((d: any) => [d.id, d.full_name])), [doctors]);

  const [q, setQ] = useState("");
  const [form, setForm] = useState<PForm>(empty);
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data;
    return (data as any[]).filter((p) =>
      p.full_name?.toLowerCase().includes(s) || p.phone?.includes(s) || p.email?.toLowerCase().includes(s));
  }, [data, q]);

  const openNew = () => { setForm(empty); setOpen(true); };
  const openEdit = (p: any) => {
    setForm({ id: p.id, doctor_id: p.doctor_id, full_name: p.full_name, birth_date: p.birth_date || "", phone: p.phone || "", email: p.email || "", notes: p.notes || "", status: p.status ?? true });
    setOpen(true);
  };

  const save = async () => {
    if (!form.doctor_id || !form.full_name) return toast.error("Doctor y nombre requeridos");
    const payload: any = {
      doctor_id: form.doctor_id,
      full_name: form.full_name,
      birth_date: form.birth_date || null,
      phone: form.phone || null,
      email: form.email || null,
      notes: form.notes || null,
      status: form.status,
    };
    if (form.id) {
      const { error } = await supabase.from("patients").update(payload).eq("id", form.id);
      if (error) return toast.error(translateError(error));
      toast.success("Paciente actualizado");
    } else {
      payload.created_by = user!.id;
      const { error } = await supabase.from("patients").insert(payload);
      if (error) return toast.error(translateError(error));
      toast.success("Paciente registrado");
    }
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["patients"] });
  };

  const toggleStatus = async (p: any, v: boolean) => {
    await supabase.from("patients").update({ status: v }).eq("id", p.id);
    qc.invalidateQueries({ queryKey: ["patients"] });
  };

  const del = async (p: any) => {
    if (!confirm(`¿Eliminar paciente "${p.full_name}"? Esta acción también elimina su historial.`)) return;
    const { error } = await supabase.from("patients").delete().eq("id", p.id);
    if (error) return toast.error(translateError(error));
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
            {isLoading && <TableRow><TableCell colSpan={7}>Cargando…</TableCell></TableRow>}
            {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-muted-foreground">Sin resultados.</TableCell></TableRow>}
            {filtered.map((p: any) => (
              <TableRow key={p.id} className={!p.status ? "opacity-60" : ""}>
                <TableCell className="font-medium">
                  {p.full_name}
                  {p.email && <div className="text-[11px] text-muted-foreground">{p.email}</div>}
                </TableCell>
                <TableCell className="text-sm">{doctorMap.get(p.doctor_id) || "—"}</TableCell>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{form.id ? "Editar paciente" : "Nuevo paciente"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Doctor remitente *</Label>
              <Select value={form.doctor_id} onValueChange={(v) => setForm({ ...form, doctor_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecciona un doctor" /></SelectTrigger>
                <SelectContent>
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
