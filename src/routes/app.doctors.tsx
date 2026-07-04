import { translateError } from "@/lib/translate-error";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useList } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/doctors")({ component: DoctorsPage });

type DForm = { id?: string; full_name: string; clinic_address: string; phone: string; email: string; bank_account: string; use_percentage: boolean; default_commission_pct: number; agreement_discount_pct: number; status: boolean };
const empty: DForm = { full_name: "", clinic_address: "", phone: "", email: "", bank_account: "", use_percentage: false, default_commission_pct: 0, agreement_discount_pct: 0, status: true };

function DoctorsPage() {
  const { user, hasAny, can } = useAuth();
  const canCreate = hasAny(["ADMIN", "RECEPCION"]);
  const canEdit = can("doctors.edit") || hasAny(["ADMIN"]);
  const canDelete = can("doctors.delete") || hasAny(["ADMIN"]);
  const qc = useQueryClient();
  const { data = [], isLoading } = useList<any>("doctors");
  const [q, setQ] = useState("");
  const [form, setForm] = useState<DForm>(empty);
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data;
    return (data as any[]).filter((d) => d.full_name?.toLowerCase().includes(s) || d.phone?.includes(s) || d.email?.toLowerCase().includes(s));
  }, [data, q]);

  const openNew = () => { setForm(empty); setOpen(true); };
  const openEdit = (d: any) => {
    setForm({ id: d.id, full_name: d.full_name, clinic_address: d.clinic_address || "", phone: d.phone || "", email: d.email || "", bank_account: d.bank_account || "", use_percentage: !!d.use_percentage, default_commission_pct: Number(d.default_commission_pct ?? 0), agreement_discount_pct: Number(d.agreement_discount_pct ?? 0), status: d.status });
    setOpen(true);
  };

  const save = async () => {
    if (!form.full_name) return toast.error("Nombre requerido");
    const payload: any = { ...form };
    delete payload.id;
    if (form.id) {
      const { error } = await supabase.from("doctors").update(payload).eq("id", form.id);
      if (error) return toast.error(translateError(error));
      toast.success("Doctor actualizado");
    } else {
      payload.created_by = user!.id;
      const { error } = await supabase.from("doctors").insert(payload);
      if (error) return toast.error(translateError(error));
      toast.success("Doctor registrado");
    }
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["doctors"] });
  };

  const del = async (d: any) => {
    if (!confirm(`¿Eliminar doctor "${d.full_name}"? Los pacientes vinculados quedarán sin doctor y podría fallar si tiene registros históricos.`)) return;
    const { error } = await supabase.from("doctors").delete().eq("id", d.id);
    if (error) return toast.error("No se puede eliminar: " + translateError(error));
    toast.success("Doctor eliminado");
    qc.invalidateQueries({ queryKey: ["doctors"] });
  };

  const toggle = async (d: any, v: boolean) => {
    await supabase.from("doctors").update({ status: v }).eq("id", d.id);
    qc.invalidateQueries({ queryKey: ["doctors"] });
  };

  return (
    <div>
      <PageHeader
        title="Doctores remitentes"
        description="Gestión completa: editar, activar/desactivar, eliminar."
        action={canCreate && <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" />Nuevo doctor</Button>}
      />

      <div className="mb-3 relative max-w-md">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Buscar por nombre, teléfono o email…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Nombre</TableHead><TableHead>Teléfono</TableHead><TableHead>Email</TableHead>
            <TableHead>Comisión</TableHead><TableHead>% Desc. convenio</TableHead><TableHead>Estado</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7}>Cargando…</TableCell></TableRow>}
            {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-muted-foreground">Sin resultados.</TableCell></TableRow>}
            {filtered.map((d: any) => (
              <TableRow key={d.id} className={!d.status ? "opacity-60" : ""}>
                <TableCell className="font-medium">
                  {d.full_name}
                  {d.clinic_address && <div className="text-[11px] text-muted-foreground">{d.clinic_address}</div>}
                </TableCell>
                <TableCell className="text-sm">{d.phone || "—"}</TableCell>
                <TableCell className="text-sm">{d.email || "—"}</TableCell>
                <TableCell className="text-sm">{d.use_percentage ? `${Number(d.default_commission_pct ?? 0)}%` : <span className="text-muted-foreground">Fija por estudio</span>}</TableCell>
                <TableCell className="text-sm">{Number(d.agreement_discount_pct ?? 0)}%</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch checked={d.status} disabled={!canEdit} onCheckedChange={(v) => toggle(d, v)} />
                    <Badge variant={d.status ? "secondary" : "outline"} className="text-[10px]">{d.status ? "Activo" : "Inactivo"}</Badge>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    {canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(d)} title="Editar"><Pencil className="h-4 w-4" /></Button>}
                    {canDelete && <Button size="sm" variant="ghost" onClick={() => del(d)} title="Eliminar" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{form.id ? "Editar doctor" : "Nuevo doctor"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Nombre completo *</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Teléfono</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <div><Label>Dirección consultorio</Label><Input value={form.clinic_address} onChange={(e) => setForm({ ...form, clinic_address: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Cuenta bancaria</Label><Input value={form.bank_account} onChange={(e) => setForm({ ...form, bank_account: e.target.value })} /></div>
              <div>
                <Label>% Descuento convenio</Label>
                <Input type="number" step="0.01" min="0" max="100" value={form.agreement_discount_pct} onChange={(e) => setForm({ ...form, agreement_discount_pct: Number(e.target.value) })} />
                <p className="text-[10px] text-muted-foreground mt-1">Se aplica automático al paciente en cada estudio.</p>
              </div>
            </div>
            <div className="rounded-md border p-3 bg-muted/30">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <Label className="text-sm font-semibold">Comisión por porcentaje</Label>
                  <p className="text-[11px] text-muted-foreground">Si está apagado, se usa la comisión fija definida en cada estudio.</p>
                </div>
                <Switch checked={form.use_percentage} onCheckedChange={(v) => setForm({ ...form, use_percentage: v })} />
              </div>
              {form.use_percentage && (
                <div className="mt-3">
                  <Label>% Comisión (máx. 20%)</Label>
                  <Input type="number" step="0.01" min="0" max="20" value={form.default_commission_pct}
                    onChange={(e) => {
                      const v = Math.min(20, Math.max(0, Number(e.target.value) || 0));
                      setForm({ ...form, default_commission_pct: v });
                    }} />
                </div>
              )}
            </div>
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
