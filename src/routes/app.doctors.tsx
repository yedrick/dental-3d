import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useList } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHead, TableHeader, TableRow, TableBody, TableCell } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/app/doctors")({ component: DoctorsPage });

function DoctorsPage() {
  const { user, hasAny } = useAuth();
  const canEdit = hasAny(["ADMIN", "RECEPCION"]);
  const qc = useQueryClient();
  const { data = [], isLoading } = useList<any>("doctors");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ full_name: "", clinic_address: "", phone: "", email: "", bank_account: "", default_commission_pct: 20, status: true });

  const save = async () => {
    const payload = { ...form, created_by: user!.id };
    const { error } = await supabase.from("doctors").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Doctor registrado");
    setOpen(false);
    setForm({ full_name: "", clinic_address: "", phone: "", email: "", bank_account: "", default_commission_pct: 20, status: true });
    qc.invalidateQueries({ queryKey: ["doctors"] });
  };

  return (
    <div>
      <PageHeader
        title="Doctores remitentes"
        description="Gestión de doctores. Todo paciente debe estar vinculado a uno."
        action={canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" />Nuevo doctor</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nuevo doctor</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div><Label>Nombre completo *</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Teléfono</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                  <div><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                </div>
                <div><Label>Dirección consultorio</Label><Input value={form.clinic_address} onChange={(e) => setForm({ ...form, clinic_address: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Cuenta bancaria</Label><Input value={form.bank_account} onChange={(e) => setForm({ ...form, bank_account: e.target.value })} /></div>
                  <div><Label>% Comisión</Label><Input type="number" step="0.01" value={form.default_commission_pct} onChange={(e) => setForm({ ...form, default_commission_pct: Number(e.target.value) })} /></div>
                </div>
              </div>
              <DialogFooter><Button onClick={save} disabled={!form.full_name}>Guardar</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      />
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Nombre</TableHead><TableHead>Teléfono</TableHead><TableHead>Email</TableHead>
            <TableHead>% Comisión</TableHead><TableHead>Estado</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5}>Cargando…</TableCell></TableRow>}
            {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Sin doctores registrados.</TableCell></TableRow>}
            {data.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.full_name}</TableCell>
                <TableCell>{d.phone || "-"}</TableCell>
                <TableCell>{d.email || "-"}</TableCell>
                <TableCell>{d.default_commission_pct}%</TableCell>
                <TableCell>
                  <Switch checked={d.status} disabled={!canEdit} onCheckedChange={async (v) => {
                    await supabase.from("doctors").update({ status: v }).eq("id", d.id);
                    qc.invalidateQueries({ queryKey: ["doctors"] });
                  }} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
